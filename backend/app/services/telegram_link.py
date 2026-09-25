import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.tokens import generate_token, hash_token
from app.models.auth_token import AuthToken, AuthTokenKind
from app.models.refresh_token import RefreshToken
from app.models.user import User


async def get_user_by_telegram_id(session: AsyncSession, telegram_user_id: int) -> User | None:
    return await session.scalar(select(User).where(User.telegram_user_id == telegram_user_id))


def deep_link_url(prefix: str, plain_token: str) -> str:
    settings = get_settings()
    return f"https://t.me/{settings.telegram_bot_username}?start={prefix}_{plain_token}"


async def create_link_token(session: AsyncSession, user_id: uuid.UUID) -> tuple[str, datetime]:
    settings = get_settings()
    plain = generate_token()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.telegram_link_token_ttl_minutes)
    session.add(
        AuthToken(
            user_id=user_id,
            kind=AuthTokenKind.link,
            token_hash=hash_token(plain),
            expires_at=expires_at,
        )
    )
    await session.commit()
    return plain, expires_at


async def chat_linked_before(session: AsyncSession, plain: str) -> int | None:
    """The Telegram chat the link token's user is linked to right now (before consuming
    the token), so the bot can tell that chat when the account gets relinked elsewhere."""
    token = await session.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(plain), AuthToken.kind == AuthTokenKind.link
        )
    )
    if token is None or token.user_id is None:
        return None
    user = await session.get(User, token.user_id)
    return user.telegram_chat_id if user is not None else None


async def consume_link_token(
    session: AsyncSession, plain: str, telegram_user_id: int, telegram_chat_id: int
) -> User | None:
    """Called by the bot on `/start link_<token>`. Returns the linked user, or None if
    the token is invalid/expired/used, or if this Telegram account is already linked to
    a different user (spec §5.2: one Telegram account links to exactly one user)."""
    token = await session.scalar(
        select(AuthToken)
        .where(AuthToken.token_hash == hash_token(plain), AuthToken.kind == AuthTokenKind.link)
        .with_for_update()  # single use, even under concurrent /start messages
    )
    now = datetime.now(UTC)
    if (
        token is None
        or token.used_at is not None
        or token.expires_at < now
        or token.user_id is None
    ):
        return None

    existing = await session.scalar(select(User).where(User.telegram_user_id == telegram_user_id))
    if existing is not None and existing.id != token.user_id:
        return None

    user = await session.get(User, token.user_id)
    if user is None:
        return None

    user.telegram_user_id = telegram_user_id
    user.telegram_chat_id = telegram_chat_id
    user.telegram_blocked = False
    token.used_at = now
    await session.commit()
    await session.refresh(user)
    return user


async def create_login_token(
    session: AsyncSession, user_agent: str | None, ip: str | None
) -> tuple[str, datetime]:
    settings = get_settings()
    plain = generate_token()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.telegram_link_token_ttl_minutes)
    session.add(
        AuthToken(
            user_id=None,
            kind=AuthTokenKind.login,
            token_hash=hash_token(plain),
            expires_at=expires_at,
            meta={"status": "pending", "user_agent": user_agent, "ip": ip},
        )
    )
    await session.commit()
    return plain, expires_at


async def find_login_token_by_plain(session: AsyncSession, plain: str) -> AuthToken | None:
    """Non-raising lookup, for the bot's `/start login_<token>` handler."""
    return await session.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(plain), AuthToken.kind == AuthTokenKind.login
        )
    )


async def find_login_token_by_id(session: AsyncSession, token_id: uuid.UUID) -> AuthToken | None:
    """For the bot's Confirm/Deny callback, which encodes the token's id (not the plain
    secret) in `callback_data`."""
    token = await session.get(AuthToken, token_id)
    if token is None or token.kind != AuthTokenKind.login:
        return None
    return token


async def get_login_token(session: AsyncSession, plain: str) -> AuthToken:
    token = await find_login_token_by_plain(session, plain)
    if token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Login request not found")
    return token


async def attach_login_requester(
    session: AsyncSession, token: AuthToken, user_id: uuid.UUID
) -> None:
    """Called by the bot when the linked owner of a Telegram account opens the login
    deep link, so the Confirm/Deny callback later knows who is answering."""
    if token.expires_at < datetime.now(UTC) or token.used_at is not None:
        return
    token.user_id = user_id
    await session.commit()


async def set_login_status(session: AsyncSession, token: AuthToken, status_value: str) -> None:
    meta: dict[str, Any] = dict(token.meta or {})
    meta["status"] = status_value
    token.meta = meta
    await session.commit()


async def claim_login_token(session: AsyncSession, plain: str) -> tuple[str, User | None]:
    """Polled by the frontend. Returns (status, user). Marks the token used and returns
    the user exactly once, the first time it observes status == confirmed."""
    token = await get_login_token(session, plain)
    now = datetime.now(UTC)

    if token.used_at is not None:
        return "expired", None
    if token.expires_at < now:
        return "expired", None

    meta_status = (token.meta or {}).get("status", "pending")
    if meta_status not in ("pending", "confirmed", "denied"):
        meta_status = "pending"

    if meta_status == "denied":
        token.used_at = now
        await session.commit()
        return "denied", None

    if meta_status == "confirmed" and token.user_id is not None:
        user = await session.get(User, token.user_id)
        if user is None or not user.is_active:
            return "expired", None
        token.used_at = now
        await session.commit()
        await session.refresh(user)
        return "confirmed", user

    return "pending", None


async def purge_expired_tokens(session: AsyncSession) -> int:
    """Link/login/reset tokens and refresh tokens are only useful until they expire (or
    are used/revoked). Anonymous "log in with Telegram" requests create a row each, so
    without this the table only grows. Run periodically by the worker."""
    now = datetime.now(UTC)
    grace = timedelta(days=1)
    auth_result = await session.execute(delete(AuthToken).where(AuthToken.expires_at < now - grace))
    refresh_result = await session.execute(
        delete(RefreshToken).where(
            (RefreshToken.expires_at < now - grace)
            | (RefreshToken.revoked_at < now - timedelta(days=30))
        )
    )
    await session.commit()
    return (getattr(auth_result, "rowcount", 0) or 0) + (
        getattr(refresh_result, "rowcount", 0) or 0
    )
