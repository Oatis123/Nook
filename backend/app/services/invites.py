import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tokens import generate_token, hash_token
from app.core.validation import ValidationError, validate_password, validate_username
from app.models.invite import Invite
from app.models.user import User
from app.schemas.invite import InviteStatus


def invite_status(invite: Invite, now: datetime | None = None) -> InviteStatus:
    now = now or datetime.now(UTC)
    if invite.revoked_at is not None:
        return InviteStatus.revoked
    if invite.used_at is not None:
        return InviteStatus.used
    if invite.expires_at < now:
        return InviteStatus.expired
    return InviteStatus.active


async def create_invite(
    session: AsyncSession, created_by: uuid.UUID, comment: str | None, expires_in_days: int | None
) -> tuple[Invite, str]:
    settings = get_settings()
    plain = generate_token()
    invite = Invite(
        token_hash=hash_token(plain),
        created_by=created_by,
        comment=comment,
        expires_at=datetime.now(UTC)
        + timedelta(days=expires_in_days or settings.invite_default_ttl_days),
    )
    session.add(invite)
    await session.commit()
    await session.refresh(invite)
    return invite, plain


async def list_invites(session: AsyncSession) -> list[Invite]:
    result = await session.scalars(
        select(Invite).options(selectinload(Invite.used_by_user)).order_by(Invite.created_at.desc())
    )
    return list(result)


async def revoke_invite(session: AsyncSession, invite_id: uuid.UUID) -> Invite:
    invite = await session.get(Invite, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    if invite.revoked_at is None:
        invite.revoked_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(invite)
    return invite


async def get_active_invite_by_token(session: AsyncSession, plain_token: str) -> Invite:
    invite = await session.scalar(
        select(Invite).where(Invite.token_hash == hash_token(plain_token))
    )
    if invite is None or invite_status(invite) != InviteStatus.active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found or no longer valid")
    return invite


async def accept_invite(
    session: AsyncSession, plain_token: str, username: str, password: str, timezone: str
) -> User:
    invite = await get_active_invite_by_token(session, plain_token)

    try:
        validate_username(username)
        validate_password(password)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    existing = await session.scalar(select(User).where(User.username == username))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username is already taken")

    user = User(
        username=username,
        password_hash=hash_password(password),
        timezone=timezone or "UTC",
    )
    session.add(user)
    await session.flush()

    invite.used_by = user.id
    invite.used_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(user)
    return user
