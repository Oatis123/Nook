import os
import re
import tempfile
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.attachment import Attachment
from app.models.folder import Folder
from app.models.note import Note

log = structlog.get_logger()

_UNSAFE_CHARS_RE = re.compile(r'[\\/:*?"<>|]')


def _sanitize_path_segment(name: str) -> str:
    """A note title or attachment filename can contain characters that aren't safe as a
    zip entry / filesystem path segment (Obsidian itself allows most of these in a title);
    the zip entry name is sanitized for portability, content and the real title are not
    touched."""
    cleaned = _UNSAFE_CHARS_RE.sub("-", name).strip()
    # "." / ".." as a folder name would make a path-traversing zip entry ("../x.md").
    if not cleaned or set(cleaned) == {"."}:
        return "Untitled"
    return cleaned


def _unique_name(used: set[str], name: str) -> str:
    if name not in used:
        used.add(name)
        return name
    stem, _, ext = name.rpartition(".")
    stem, ext = (stem, f".{ext}") if stem else (name, "")
    counter = 2
    while True:
        candidate = f"{stem} ({counter}){ext}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        counter += 1


async def _folder_paths(session: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID | None, str]:
    folders = list(
        await session.scalars(
            select(Folder).where(Folder.user_id == user_id, Folder.deleted_at.is_(None))
        )
    )
    by_id = {f.id: f for f in folders}

    def path_for(folder_id: uuid.UUID | None) -> str:
        # Iterative, with a visited set: a corrupted parent chain that loops back on itself
        # must not recurse forever (RecursionError → the whole export failing).
        segments: list[str] = []
        seen: set[uuid.UUID] = set()
        while folder_id is not None and folder_id not in seen:
            folder = by_id.get(folder_id)
            if folder is None:
                break
            seen.add(folder_id)
            segments.append(_sanitize_path_segment(folder.name))
            folder_id = folder.parent_id
        return "/".join(reversed(segments))

    paths: dict[uuid.UUID | None, str] = {None: ""}
    for folder in folders:
        paths[folder.id] = path_for(folder.id)
    return paths


def export_note_markdown(note: Note) -> bytes:
    """A note's stored `content` already includes its raw frontmatter block verbatim (see
    app/services/note_links.py's sync_note_from_content, which parses frontmatter out into
    its own column without stripping it from `content`) — so the exported file is just the
    content as-is, byte for byte what the editor shows."""
    return note.content.encode("utf-8")


def _write_vault_zip(
    folder_paths: dict[uuid.UUID | None, str],
    notes: list[tuple[str, uuid.UUID | None, str]],
    attachments: list[tuple[str, str]],
) -> Path:
    """Blocking part of the export (file I/O + compression), run in a worker thread.
    Streams into a temporary file — attachments are copied from disk by the zip writer,
    never read whole into memory — and returns its path; the caller deletes it."""
    fd, tmp_name = tempfile.mkstemp(prefix="nook-export-", suffix=".zip")
    try:
        with os.fdopen(fd, "wb") as out, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            used_note_paths: set[str] = set()
            for title, folder_id, content in notes:
                folder_path = folder_paths.get(folder_id, "")
                filename = _sanitize_path_segment(title) + ".md"
                entry_path = f"{folder_path}/{filename}" if folder_path else filename
                entry_path = _unique_name(used_note_paths, entry_path)
                zf.writestr(entry_path, content.encode("utf-8"))

            used_attachment_names: set[str] = set()
            for filename, storage_path in attachments:
                source = Path(storage_path)
                if not source.is_file():
                    # A missing file used to fail the whole export with a 500.
                    log.warning("export.attachment_missing", path=storage_path)
                    continue
                name = _unique_name(used_attachment_names, _sanitize_path_segment(filename))
                zf.write(source, f"attachments/{name}")
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    return Path(tmp_name)


async def build_vault_zip_file(session: AsyncSession, user_id: uuid.UUID) -> Path:
    """Spec §6.9: folder structure, .md files with frontmatter, attachments/ — built to
    open in Obsidian without edits (wikilinks and embeds are already Obsidian-native
    syntax, unchanged from how the editor stores them). Returns a temporary file the
    caller must delete."""
    folder_paths = await _folder_paths(session, user_id)
    note_rows = await session.execute(
        select(Note.title, Note.folder_id, Note.content)
        .where(Note.user_id == user_id, Note.deleted_at.is_(None))
        .order_by(Note.title)
    )
    attachment_rows = await session.execute(
        select(Attachment.filename, Attachment.storage_path).where(Attachment.user_id == user_id)
    )
    notes = [(title, folder_id, content) for title, folder_id, content in note_rows.all()]
    attachments = [(filename, path) for filename, path in attachment_rows.all()]
    return await run_in_threadpool(_write_vault_zip, folder_paths, notes, attachments)


async def build_vault_zip(session: AsyncSession, user_id: uuid.UUID) -> bytes:
    """In-memory variant for small exports and tests; the HTTP endpoint streams the file."""
    path = await build_vault_zip_file(session, user_id)
    try:
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


def export_note_filename(note: Note) -> str:
    return _sanitize_path_segment(note.title) + ".md"


def content_disposition(filename: str) -> str:
    """RFC 6266/5987: a plain `filename="..."` header must be latin-1 (Starlette encodes
    headers that way), so a Cyrillic title used to crash the response with a 500. Sends
    an ASCII fallback plus the real name percent-encoded as UTF-8 in `filename*`."""
    fallback = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    fallback = fallback.replace('"', "_").replace("\\", "_")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
