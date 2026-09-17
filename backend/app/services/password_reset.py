import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tokens import generate_token, hash_token
from app.core.validation import ValidationError, validate_password
from app.models.auth_token import AuthToken, AuthTokenKind
from app.models.user import User
from app.services.auth import revoke_all_sessions


async def create_reset_token(session: AsyncSession, user_id: uuid.UUID) -> str:
    settings = get_settings()
    plain = generate_token()
    session.add(
        AuthToken(
            user_id=user_id,
            kind=AuthTokenKind.password_reset,
            token_hash=hash_token(plain),
            expires_at=datetime.now(UTC) + timedelta(minutes=settings.password_reset_ttl_minutes),
        )
    )
    await session.commit()
    return plain


async def consume_reset_token(session: AsyncSession, plain: str, new_password: str) -> User:
    token = await session.scalar(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(plain),
            AuthToken.kind == AuthTokenKind.password_reset,
        )
    )
    now = datetime.now(UTC)
    if (
        token is None
        or token.used_at is not None
        or token.expires_at < now
        or token.user_id is None
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link")

    try:
        validate_password(new_password)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    user = await session.get(User, token.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link")

    user.password_hash = hash_password(new_password)
    token.used_at = now
    await session.commit()

    await revoke_all_sessions(session, user.id)
    await session.refresh(user)
    return user
