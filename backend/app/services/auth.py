import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.rate_limit import is_rate_limited, record_attempt, reset_attempts
from app.core.security import verify_password
from app.core.tokens import generate_token, hash_token
from app.models.refresh_token import RefreshToken
from app.models.user import User


async def authenticate(session: AsyncSession, username: str, password: str, ip: str) -> User:
    if is_rate_limited(username, ip):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts, try again later"
        )

    user = await session.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        record_attempt(username, ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")

    reset_attempts(username, ip)
    user.last_login_at = datetime.now(UTC)
    await session.commit()
    return user


async def issue_refresh_token(
    session: AsyncSession, user_id: uuid.UUID, user_agent: str | None, ip: str | None
) -> str:
    settings = get_settings()
    plain = generate_token()
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_token(plain),
            user_agent=user_agent,
            ip=ip,
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days),
        )
    )
    await session.commit()
    return plain


async def rotate_refresh_token(
    session: AsyncSession, plain: str, user_agent: str | None, ip: str | None
) -> tuple[User, str]:
    """Validates and revokes the given refresh token, issuing a new one. Spec §5.4:
    refresh tokens rotate on every use."""
    token_hash = hash_token(plain)
    token = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    now = datetime.now(UTC)
    if token is None or token.revoked_at is not None or token.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")

    user = await session.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")

    token.revoked_at = now
    new_plain = await issue_refresh_token(session, user.id, user_agent, ip)
    return user, new_plain


async def revoke_refresh_token(session: AsyncSession, plain: str) -> None:
    token_hash = hash_token(plain)
    token = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if token is not None and token.revoked_at is None:
        token.revoked_at = datetime.now(UTC)
        await session.commit()


async def revoke_all_sessions(
    session: AsyncSession, user_id: uuid.UUID, except_token_hash: str | None = None
) -> None:
    now = datetime.now(UTC)
    result = await session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
        )
    )
    for token in result:
        if except_token_hash is not None and token.token_hash == except_token_hash:
            continue
        token.revoked_at = now
    await session.commit()


async def list_sessions(session: AsyncSession, user_id: uuid.UUID) -> list[RefreshToken]:
    now = datetime.now(UTC)
    result = await session.scalars(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
        .order_by(RefreshToken.created_at.desc())
    )
    return list(result)
