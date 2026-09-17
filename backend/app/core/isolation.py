import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession


async def get_owned_or_404[ModelT](
    session: AsyncSession, model: type[ModelT], obj_id: uuid.UUID, user_id: uuid.UUID
) -> ModelT:
    """Fetch a row the current user owns, or 404 (never 403) — spec §4: a request for
    another user's object must look identical to a request for a nonexistent one."""
    obj = await session.get(model, obj_id)
    if obj is None or getattr(obj, "user_id", None) != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return obj
