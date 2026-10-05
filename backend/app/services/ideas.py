"""The Ideas note: one Markdown note per user that quick ideas sent to the Telegram bot are
appended to, each under its date and time. It's created with the first idea, can't be
deleted (the notes service refuses; deleting its folder moves it to the top level instead)
and can be hidden from the notes list (User.ideas_note_hidden)."""

import uuid
from collections.abc import Callable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CodedHTTPException
from app.models.note import Note
from app.schemas.note import NoteUpdate
from app.services import notes as notes_service
from app.services.telegram_format import format_due

IDEAS_NOTE_TITLE = "Идеи"
# Appending races the web editor's autosave (both bump the note's version): reload and
# try again a few times rather than failing the idea.
APPEND_ATTEMPTS = 3


async def free_root_title(
    session: AsyncSession, user_id: uuid.UUID, title: str, exclude_note_id: uuid.UUID | None
) -> str:
    """`title`, or `title (2)`, `title (3)`… — the first not taken by another active
    top-level note (titles are unique per folder)."""
    query = select(Note.title).where(
        Note.user_id == user_id, Note.folder_id.is_(None), Note.deleted_at.is_(None)
    )
    if exclude_note_id is not None:
        query = query.where(Note.id != exclude_note_id)
    taken = set(await session.scalars(query))
    candidate, n = title, 1
    while candidate in taken:
        n += 1
        candidate = f"{title} ({n})"
    return candidate


async def get_ideas_note(session: AsyncSession, user_id: uuid.UUID) -> Note | None:
    return await session.scalar(select(Note).where(Note.user_id == user_id, Note.is_ideas))


async def get_or_create_ideas_note(session: AsyncSession, user_id: uuid.UUID) -> Note:
    note = await get_ideas_note(session, user_id)
    if note is not None:
        return note
    title = await free_root_title(session, user_id, IDEAS_NOTE_TITLE, None)
    note = await notes_service.create_note(session, user_id, title, None, "")
    note.is_ideas = True
    try:
        await session.commit()
    except IntegrityError:
        # Another request created it first (one Ideas note per user is a unique index):
        # use that one and drop ours.
        await session.rollback()
        await notes_service.hard_delete_note(session, user_id, note.id)
        existing = await get_ideas_note(session, user_id)
        assert existing is not None
        return existing
    return note


def _hard_breaks(text: str) -> str:
    """Keeps the message's line breaks in the rendered note: in Markdown a lone newline is
    just a space, a line ending in two spaces is a line break."""
    lines = [line.rstrip() for line in text.strip().splitlines()]
    return "\n".join(
        f"{line}  " if line and i + 1 < len(lines) and lines[i + 1] else line
        for i, line in enumerate(lines)
    )


def idea_block(text: str, at: datetime) -> str:
    """'**пн, 5 окт 2026, 14:32**' on its own line, then the idea."""
    when = format_due(at.date(), at.time().replace(second=0, microsecond=0))
    return f"**{when}**  \n{_hard_breaks(text)}"


async def _rewrite(
    session: AsyncSession, user_id: uuid.UUID, change: Callable[[str], str | None]
) -> Note | None:
    """Applies `change` to the Ideas note's content and saves it, retrying on a version
    conflict. `change` returns None to leave the note as it is."""
    for attempt in range(1, APPEND_ATTEMPTS + 1):
        note = await get_or_create_ideas_note(session, user_id)
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


async def append_idea(session: AsyncSession, user_id: uuid.UUID, text: str, at: datetime) -> str:
    """Appends the idea at the end of the Ideas note, creating the note if needed. Returns
    the block that was added, for `remove_idea`."""
    block = idea_block(text, at)

    def add(content: str) -> str:
        existing = content.rstrip("\n")
        return f"{existing}\n\n{block}\n" if existing else f"{block}\n"

    await _rewrite(session, user_id, add)
    return block


async def remove_idea(session: AsyncSession, user_id: uuid.UUID, block: str) -> bool:
    """Undoes an `append_idea`: removes the last occurrence of `block`. False if it isn't
    there any more (edited or removed in the meantime)."""

    def remove(content: str) -> str | None:
        index = content.rfind(block)
        if index == -1:
            return None
        before = content[:index].rstrip("\n")
        after = content[index + len(block) :].strip("\n")
        joined = "\n\n".join(part for part in (before, after) if part)
        return f"{joined}\n" if joined else ""

    return await _rewrite(session, user_id, remove) is not None
