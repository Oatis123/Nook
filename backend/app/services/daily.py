"""Daily notes: one Markdown note per day, titled with its date ("2026-10-27") in a "Дневник"
folder, that the Telegram bot appends the day's entries to, each under its time. Both the
folder and the day's note are created with the first entry; they're ordinary notes, so they
can be edited, moved or deleted like any other (the next entry just makes new ones)."""

import uuid
from collections.abc import Callable
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CodedHTTPException
from app.models.folder import Folder
from app.models.note import Note
from app.schemas.note import NoteUpdate
from app.services import folders as folders_service
from app.services import notes as notes_service
from app.services.ideas import APPEND_ATTEMPTS, hard_breaks

DAILY_FOLDER_NAME = "Дневник"


def daily_title(day: date) -> str:
    return day.isoformat()


async def _get_or_create_folder(session: AsyncSession, user_id: uuid.UUID) -> Folder:
    folder = await session.scalar(
        select(Folder)
        .where(
            Folder.user_id == user_id,
            Folder.parent_id.is_(None),
            Folder.name == DAILY_FOLDER_NAME,
            Folder.deleted_at.is_(None),
        )
        .order_by(Folder.position)
        .limit(1)
    )
    if folder is not None:
        return folder
    return await folders_service.create_folder(session, user_id, DAILY_FOLDER_NAME, None)


async def _get_note(
    session: AsyncSession, user_id: uuid.UUID, folder_id: uuid.UUID, title: str
) -> Note | None:
    return await session.scalar(
        select(Note).where(
            Note.user_id == user_id,
            Note.folder_id == folder_id,
            Note.title == title,
            Note.deleted_at.is_(None),
        )
    )


async def get_daily_note(session: AsyncSession, user_id: uuid.UUID, day: date) -> Note | None:
    folder = await session.scalar(
        select(Folder.id).where(
            Folder.user_id == user_id,
            Folder.parent_id.is_(None),
            Folder.name == DAILY_FOLDER_NAME,
            Folder.deleted_at.is_(None),
        )
    )
    if folder is None:
        return None
    return await _get_note(session, user_id, folder, daily_title(day))


async def get_or_create_daily_note(session: AsyncSession, user_id: uuid.UUID, day: date) -> Note:
    folder = await _get_or_create_folder(session, user_id)
    title = daily_title(day)
    note = await _get_note(session, user_id, folder.id, title)
    if note is not None:
        return note
    try:
        return await notes_service.create_note(session, user_id, title, folder.id, "")
    except CodedHTTPException as exc:
        # Another request created the day's note first: use that one.
        if exc.code != "duplicate_title":
            raise
        existing = await _get_note(session, user_id, folder.id, title)
        assert existing is not None
        return existing


def entry_block(text: str, at: datetime) -> str:
    """'**14:32**' on its own line, then the entry."""
    return f"**{at:%H:%M}**  \n{hard_breaks(text)}"


async def _rewrite(
    session: AsyncSession,
    user_id: uuid.UUID,
    day: date,
    change: Callable[[str], str | None],
) -> Note | None:
    """Applies `change` to the day's note content and saves it, retrying on a version
    conflict (the web editor's autosave bumps the version too). `change` returns None to
    leave the note as it is."""
    for attempt in range(1, APPEND_ATTEMPTS + 1):
        note = await get_or_create_daily_note(session, user_id, day)
        await session.refresh(note)
        new_content = change(note.content)
        if new_content is None:
            return None
        try:
            return await notes_service.update_note(
                session, user_id, note.id, NoteUpdate(version=note.version, content=new_content)
            )
        except CodedHTTPException as exc:
            if exc.code != "version_conflict" or attempt == APPEND_ATTEMPTS:
                raise
            await session.rollback()
    raise AssertionError("unreachable")


async def append_entry(
    session: AsyncSession, user_id: uuid.UUID, text: str, at: datetime
) -> tuple[Note, str]:
    """Appends the entry at the end of `at`'s day note, creating the folder and the note if
    needed. Returns the note and the block that was added, for `remove_entry`."""
    block = entry_block(text, at)

    def add(content: str) -> str:
        existing = content.rstrip("\n")
        return f"{existing}\n\n{block}\n" if existing else f"{block}\n"

    note = await _rewrite(session, user_id, at.date(), add)
    assert note is not None
    return note, block


async def remove_entry(session: AsyncSession, user_id: uuid.UUID, day: date, block: str) -> bool:
    """Undoes an `append_entry`: removes the last occurrence of `block` from the day's note.
    False if it isn't there any more (edited or removed in the meantime)."""
    if await get_daily_note(session, user_id, day) is None:
        return False

    def remove(content: str) -> str | None:
        index = content.rfind(block)
        if index == -1:
            return None
        before = content[:index].rstrip("\n")
        after = content[index + len(block) :].strip("\n")
        joined = "\n\n".join(part for part in (before, after) if part)
        return f"{joined}\n" if joined else ""

    return await _rewrite(session, user_id, day, remove) is not None
