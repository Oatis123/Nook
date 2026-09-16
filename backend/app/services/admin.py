from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.validation import ValidationError, validate_password, validate_username
from app.models.user import User, UserRole


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
    except ValidationError:
        return
