from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession
from app.models.tag import NoteTag, Tag
from app.schemas.tag import TagOut

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
async def list_tags(user: CurrentUser, session: DbSession) -> list[TagOut]:
    result = await session.execute(
        select(Tag.name, func.count(NoteTag.note_id))
        .join(NoteTag, NoteTag.tag_id == Tag.id)
        .where(Tag.user_id == user.id)
        .group_by(Tag.name)
        .order_by(Tag.name)
    )
    return [TagOut(name=name, note_count=count) for name, count in result.all()]
