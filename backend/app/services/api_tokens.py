import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.isolation import get_owned_or_404
from app.core.tokens import generate_token, hash_token
from app.models.api_token import ApiToken
from app.models.user import User


async def create_api_token(
    session: AsyncSession, user_id: uuid.UUID, name: str
) -> tuple[ApiToken, str]:
    plain = generate_token()
    token = ApiToken(user_id=user_id, name=name, token_hash=hash_token(plain))
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token, plain


async def list_api_tokens(session: AsyncSession, user_id: uuid.UUID) -> list[ApiToken]:
    result = await session.scalars(
        select(ApiToken).where(ApiToken.user_id == user_id).order_by(ApiToken.created_at)
    )
    return list(result)


async def revoke_api_token(session: AsyncSession, user_id: uuid.UUID, token_id: uuid.UUID) -> None:
    token = await get_owned_or_404(session, ApiToken, token_id, user_id)
    await session.delete(token)
    await session.commit()


async def resolve_api_token(session: AsyncSession, plain: str) -> User | None:
    """Used by the MCP server's token verifier (`app/mcp/`), not the web session — a
    valid, active token resolves straight to its owning user."""
    token = await session.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(plain)))
    if token is None:
        return None

    user = await session.get(User, token.user_id)
    if user is None or not user.is_active:
        return None

    token.last_used_at = datetime.now(UTC)
    await session.commit()
    return user
