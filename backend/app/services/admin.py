import uuid

import structlog
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.validation import ValidationError, validate_password, validate_username
from app.models.user import User, UserRole

log = structlog.get_logger()


async def create_admin(session: AsyncSession, username: str, password: str) -> User:
    validate_username(username)
    validate_password(password)

    existing = await session.scalar(select(User).where(User.username == username))
    if existing is not None:
        raise ValidationError(f"User '{username}' already exists")

    user = User(username=username, password_hash=hash_password(password), role=UserRole.admin)
    session.add(user)
    await session.commit()
    return user


async def bootstrap_admin_if_empty(session: AsyncSession, username: str, password: str) -> None:
    """Create the first admin from env vars if the users table is empty. Called at API startup."""
    if not username or not password:
        return

    count = await session.scalar(select(func.count()).select_from(User))
    if count:
        return

    try:
        await create_admin(session, username, password)
    except ValidationError as exc:
        # Surfaced in the logs instead of silently skipped: otherwise a too-weak
        # ADMIN_PASSWORD leaves a fresh install with no account and no hint why.
        log.warning("admin.bootstrap_skipped", username=username, reason=str(exc))


async def list_users(session: AsyncSession) -> list[User]:
    result = await session.scalars(select(User).order_by(User.created_at))
    return list(result)


async def _get_user_or_404(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


async def set_user_active(session: AsyncSession, user_id: uuid.UUID, active: bool) -> User:
    user = await _get_user_or_404(session, user_id)
    if not active and user.role == UserRole.admin:
        remaining = await _count_active_admins(session, exclude_user_id=user.id)
        if remaining == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cannot deactivate the last admin")
    user.is_active = active
    await session.commit()
    await session.refresh(user)
    return user


async def unlink_telegram(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await _get_user_or_404(session, user_id)
    user.telegram_user_id = None
    user.telegram_chat_id = None
    user.telegram_blocked = False
    await session.commit()
    await session.refresh(user)
    return user


async def _count_active_admins(
    session: AsyncSession, exclude_user_id: uuid.UUID | None = None
) -> int:
    query = (
        select(func.count())
        .select_from(User)
        .where(User.role == UserRole.admin, User.is_active.is_(True))
    )
    if exclude_user_id is not None:
        query = query.where(User.id != exclude_user_id)
    return await session.scalar(query) or 0


async def set_user_role(session: AsyncSession, user_id: uuid.UUID, role: UserRole) -> User:
    user = await _get_user_or_404(session, user_id)
    if user.role == UserRole.admin and role == UserRole.user:
        remaining = await _count_active_admins(session, exclude_user_id=user.id)
        if remaining == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cannot remove the last admin")
    user.role = role
    await session.commit()
    await session.refresh(user)
    return user
