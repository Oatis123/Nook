from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.core.tokens import hash_token
from app.core.validation import ValidationError, validate_password
from app.models.user import User
from app.schemas.user import MeUpdate
from app.services import reminders as reminders_service
from app.services.auth import revoke_all_sessions


async def update_profile(session: AsyncSession, user: User, data: MeUpdate) -> User:
    # exclude_none: an explicit null means "no change" — every one of these columns is
    # NOT NULL, so writing it through used to fail with an IntegrityError (500).
    updates = data.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in updates.items():
        setattr(user, field, value)

    # spec §8.2: a timezone or daily reminder time change recomputes every affected task's
    # reminders — the other profile fields here don't influence reminder scheduling.
    if "timezone" in updates or "daily_reminder_time" in updates:
        await reminders_service.recompute_reminders_for_user(session, user)

    await session.commit()
    await session.refresh(user)
    return user


async def change_password(
    session: AsyncSession,
    user: User,
    current_password: str,
    new_password: str,
    current_refresh_token: str | None,
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")

    try:
        validate_password(new_password)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    user.password_hash = hash_password(new_password)
    await session.commit()

    keep_hash = hash_token(current_refresh_token) if current_refresh_token else None
    await revoke_all_sessions(session, user.id, except_token_hash=keep_hash)
