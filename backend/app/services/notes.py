import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.isolation import get_owned_or_404
from app.models.folder import Folder
from app.models.note import Note
from app.schemas.note import NoteUpdate

TRASH_RETENTION_DAYS = 30


async def _validate_folder(
    session: AsyncSession, user_id: uuid.UUID, folder_id: uuid.UUID | None
) -> None:
    if folder_id is None:
        return
    folder = await session.get(Folder, folder_id)
    if folder is None or folder.user_id != user_id or folder.deleted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Folder not found")


async def _check_title_unique(
    session: AsyncSession,
    user_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    title: str,
    exclude_note_id: uuid.UUID | None,
) -> None:
    query = select(Note.id).where(
        Note.user_id == user_id,
        Note.folder_id == folder_id,
        Note.title == title,
        Note.deleted_at.is_(None),
    )
    if exclude_note_id is not None:
        query = query.where(Note.id != exclude_note_id)
    existing = await session.scalar(query)
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A note with this title already exists in this folder"
        )


async def purge_old_trash(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Lazily hard-deletes notes trashed more than 30 days ago (spec §6.1), called at the
    start of note-listing operations rather than via a dedicated scheduled job."""
    cutoff = datetime.now(UTC) - timedelta(days=TRASH_RETENTION_DAYS)
    old = await session.scalars(
        select(Note).where(
            Note.user_id == user_id, Note.deleted_at.is_not(None), Note.deleted_at < cutoff
        )
    )
    for note in old:
        await session.delete(note)
    await session.commit()


async def create_note(
    session: AsyncSession, user_id: uuid.UUID, title: str, folder_id: uuid.UUID | None, content: str
) -> Note:
    await _validate_folder(session, user_id, folder_id)
    await _check_title_unique(session, user_id, folder_id, title, exclude_note_id=None)

    note = Note(user_id=user_id, folder_id=folder_id, title=title, content=content)
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


async def list_notes(
    session: AsyncSession,
    user_id: uuid.UUID,
    folder_id: uuid.UUID | None = None,
    folder_filter: bool = False,
    deleted: bool = False,
) -> list[Note]:
    await purge_old_trash(session, user_id)

    conditions = [Note.user_id == user_id]
    conditions.append(Note.deleted_at.is_not(None) if deleted else Note.deleted_at.is_(None))
    if folder_filter:
        conditions.append(Note.folder_id == folder_id)

    result = await session.scalars(select(Note).where(and_(*conditions)).order_by(Note.title))
    return list(result)


async def get_note(session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> Note:
    return await get_owned_or_404(session, Note, note_id, user_id)


async def update_note(
    session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID, data: NoteUpdate
) -> Note:
    note = await get_owned_or_404(session, Note, note_id, user_id)
    if note.deleted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Note is in trash")

    if data.version != note.version:
        raise HTTPException(status.HTTP_409_CONFLICT, "This note was changed elsewhere")

    new_folder_id = None if data.move_to_root else (data.folder_id or note.folder_id)
    folder_changing = data.move_to_root or data.folder_id is not None
    new_title = data.title if data.title is not None else note.title

    if folder_changing:
        await _validate_folder(session, user_id, new_folder_id)
    if folder_changing or (data.title is not None and data.title != note.title):
        await _check_title_unique(
            session, user_id, new_folder_id, new_title, exclude_note_id=note.id
        )

    if data.title is not None:
        note.title = data.title
    if data.content is not None:
        note.content = data.content
    if folder_changing:
        note.folder_id = new_folder_id
    note.version += 1

    await session.commit()
    await session.refresh(note)
    return note


async def soft_delete_note(session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    note = await get_owned_or_404(session, Note, note_id, user_id)
    note.deleted_at = datetime.now(UTC)
    await session.commit()


async def restore_note(session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> Note:
    note = await get_owned_or_404(session, Note, note_id, user_id)
    if note.deleted_at is None:
        return note

    if note.folder_id is not None:
        folder = await session.get(Folder, note.folder_id)
        if folder is None or folder.deleted_at is not None:
            note.folder_id = None

    try:
        await _check_title_unique(
            session, user_id, note.folder_id, note.title, exclude_note_id=note.id
        )
    except HTTPException:
        note.title = f"{note.title} (restored)"

    note.deleted_at = None
    await session.commit()
    await session.refresh(note)
    return note


async def hard_delete_note(session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    note = await get_owned_or_404(session, Note, note_id, user_id)
    await session.delete(note)
    await session.commit()


async def empty_trash(session: AsyncSession, user_id: uuid.UUID) -> int:
    notes = await session.scalars(
        select(Note).where(Note.user_id == user_id, Note.deleted_at.is_not(None))
    )
    count = 0
    for note in notes:
        await session.delete(note)
        count += 1
    await session.commit()
    return count
