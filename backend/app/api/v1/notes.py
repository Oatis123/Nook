import uuid

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.note import NoteCreate, NoteDetail, NoteSummary, NoteUpdate
from app.services import notes as notes_service

router = APIRouter(prefix="/notes", tags=["notes"])
Csrf = Depends(require_csrf)


@router.get("", response_model=list[NoteSummary])
async def list_notes(
    user: CurrentUser,
    session: DbSession,
    folder_id: uuid.UUID | None = Query(default=None),
    root: bool = Query(default=False),
    deleted: bool = Query(default=False),
) -> list[NoteSummary]:
    notes = await notes_service.list_notes(
        session,
        user.id,
        folder_id=None if root else folder_id,
        folder_filter=root or folder_id is not None,
        deleted=deleted,
    )
    return [NoteSummary.model_validate(n) for n in notes]


@router.post("", response_model=NoteDetail, dependencies=[Csrf])
async def create_note(body: NoteCreate, user: CurrentUser, session: DbSession) -> NoteDetail:
    note = await notes_service.create_note(
        session, user.id, body.title, body.folder_id, body.content
    )
    return NoteDetail.model_validate(note)


@router.get("/{note_id}", response_model=NoteDetail)
async def get_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> NoteDetail:
    note = await notes_service.get_note(session, user.id, note_id)
    return NoteDetail.model_validate(note)


@router.patch("/{note_id}", response_model=NoteDetail, dependencies=[Csrf])
async def update_note(
    note_id: uuid.UUID, body: NoteUpdate, user: CurrentUser, session: DbSession
) -> NoteDetail:
    note = await notes_service.update_note(session, user.id, note_id, body)
    return NoteDetail.model_validate(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def delete_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await notes_service.soft_delete_note(session, user.id, note_id)


@router.post("/{note_id}/restore", response_model=NoteDetail, dependencies=[Csrf])
async def restore_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> NoteDetail:
    note = await notes_service.restore_note(session, user.id, note_id)
    return NoteDetail.model_validate(note)


@router.delete("/{note_id}/permanent", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def hard_delete_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await notes_service.hard_delete_note(session, user.id, note_id)


@router.post("/trash/empty", dependencies=[Csrf])
async def empty_trash(user: CurrentUser, session: DbSession) -> dict[str, int]:
    count = await notes_service.empty_trash(session, user.id)
    return {"deleted": count}
