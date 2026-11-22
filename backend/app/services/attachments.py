import re
import uuid
from pathlib import Path, PurePosixPath

import filetype
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.errors import CodedHTTPException
from app.core.isolation import get_owned_or_404
from app.models.attachment import Attachment, NoteAttachment
from app.models.folder import Folder
from app.models.note import Note
from app.schemas.attachment import AttachmentUpdate
from app.services import folders as folders_service

MAX_FILENAME_LENGTH = 255  # Attachment.filename is String(255)


def _folder_condition(folder_id: uuid.UUID | None):
    return (
        Attachment.folder_id.is_(None)
        if folder_id is None
        else Attachment.folder_id == folder_id
    )


async def _validate_folder(
    session: AsyncSession, user_id: uuid.UUID, folder_id: uuid.UUID | None
) -> None:
    if folder_id is None:
        return
    folder = await get_owned_or_404(session, Folder, folder_id, user_id)
    if folder.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


async def ensure_folder_path(
    session: AsyncSession,
    user_id: uuid.UUID,
    folder_path: str,
    cache: dict[tuple[str, ...], uuid.UUID | None] | None = None,
    *,
    max_name_length: int = MAX_FILENAME_LENGTH,
) -> uuid.UUID | None:
    """Resolve a slash-separated folder path (e.g. ``"Course/images"``) to a folder ID,
    creating any missing folders along the way. Returns ``None`` for an empty/root path."""
    raw_segments = folder_path.replace("\\", "/").split("/")
    segments: list[str] = []
    for seg in raw_segments:
        cleaned = seg.strip()
        if not cleaned or cleaned == ".":
            continue
        if cleaned == "..":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid folder path")
        segments.append(cleaned)

    if not segments:
        return None

    parent_id: uuid.UUID | None = None
    prefix: list[str] = []
    for raw_part in segments:
        name = raw_part[:max_name_length]
        prefix.append(name)
        key = tuple(prefix)
        if cache is not None and key in cache:
            parent_id = cache[key]
            continue

        parent_cond = (
            Folder.parent_id.is_(None) if parent_id is None else Folder.parent_id == parent_id
        )
        existing = await session.scalar(
            select(Folder).where(
                Folder.user_id == user_id,
                parent_cond,
                Folder.name == name,
                Folder.deleted_at.is_(None),
            )
        )
        if existing is not None:
            parent_id = existing.id
        else:
            created = await folders_service.create_folder(session, user_id, name, parent_id)
            parent_id = created.id
        if cache is not None:
            cache[key] = parent_id
    return parent_id


def _sanitize_filename(filename: str) -> str:
    """Never used to build a filesystem path (attachments are stored under their id),
    but sanitized anyway so a malicious/odd name doesn't render confusingly in the UI."""
    name = PurePosixPath(filename.replace("\\", "/")).name.strip() or "file"
    if len(name) > MAX_FILENAME_LENGTH:
        path = PurePosixPath(name)
        suffix = path.suffix if len(path.suffix) <= 16 else ""
        name = path.stem[: MAX_FILENAME_LENGTH - len(suffix)] + suffix
    return name


async def _unique_filename(
    session: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    folder_id: uuid.UUID | None = None,
    *,
    exclude_attachment_id: uuid.UUID | None = None,
) -> str:
    """Uniqueness is scoped per ``(user_id, folder_id)`` (NULL = root): files in
    different folders can share a name, while duplicates in the same folder are numbered
    (`image (2).png`, `image (3).png`…) so embeds and listings remain unambiguous."""
    path = PurePosixPath(name)
    stem, suffix = path.stem, path.suffix
    stmt = select(Attachment.filename).where(
        Attachment.user_id == user_id,
        _folder_condition(folder_id),
        Attachment.filename.startswith(stem, autoescape=True),
    )
    if exclude_attachment_id is not None:
        stmt = stmt.where(Attachment.id != exclude_attachment_id)
    taken = set(await session.scalars(stmt))
    if name not in taken:
        return name
    counter = 2
    while True:
        marker = f" ({counter})"
        candidate = stem[: MAX_FILENAME_LENGTH - len(marker) - len(suffix)] + marker + suffix
        if candidate not in taken:
            return candidate
        counter += 1


def _detect_mime(data: bytes, fallback_name: str) -> str:
    kind = filetype.guess(data)
    if kind is not None:
        return kind.mime
    try:
        data.decode("utf-8")
        if fallback_name.lower().endswith((".md", ".markdown")):
            return "text/markdown"
        return "text/plain"
    except UnicodeDecodeError:
        return "application/octet-stream"


def _attachment_dir(user_id: uuid.UUID) -> Path:
    settings = get_settings()
    path = Path(settings.attachments_dir) / str(user_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def max_upload_bytes() -> int:
    return get_settings().max_upload_mb * 1024 * 1024


def file_too_large() -> HTTPException:
    limit = get_settings().max_upload_mb
    return CodedHTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE,
        "file_too_large",
        f"File exceeds the {limit} MB limit",
    )


async def _check_quota(session: AsyncSession, user_id: uuid.UUID, incoming: int) -> None:
    """Per-user cap on total attachment storage, so one account can't fill the disk
    (or build an export too large to serve)."""
    quota_mb = get_settings().max_storage_mb
    if quota_mb <= 0:
        return
    used = await session.scalar(
        select(func.coalesce(func.sum(Attachment.size), 0)).where(Attachment.user_id == user_id)
    )
    if (used or 0) + incoming > quota_mb * 1024 * 1024:
        raise CodedHTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "storage_quota_exceeded",
            f"Your attachment storage is full ({quota_mb} MB). "
            "Delete unused attachments to free up space.",
        )


async def find_identical(
    session: AsyncSession,
    user_id: uuid.UUID,
    filename: str,
    data: bytes,
    folder_id: uuid.UUID | None = None,
) -> Attachment | None:
    """An existing attachment of this user in the same folder with the same bytes, stored
    under this name or a numbered copy of it ("image (2).png" — what an earlier import of
    it was renamed to)."""
    path = PurePosixPath(_sanitize_filename(filename))
    numbered = re.compile(rf"{re.escape(path.stem)}( \(\d+\))?{re.escape(path.suffix)}")
    candidates = await session.scalars(
        select(Attachment).where(
            Attachment.user_id == user_id,
            _folder_condition(folder_id),
            Attachment.size == len(data),
            Attachment.filename.startswith(path.stem, autoescape=True),
        )
    )
    for candidate in candidates:
        if not numbered.fullmatch(candidate.filename):
            continue
        stored = Path(candidate.storage_path)
        if stored.is_file() and await run_in_threadpool(stored.read_bytes) == data:
            return candidate
    return None


async def save_attachment(
    session: AsyncSession,
    user_id: uuid.UUID,
    filename: str,
    data: bytes,
    folder_id: uuid.UUID | None = None,
) -> Attachment:
    if len(data) > max_upload_bytes():
        raise file_too_large()
    await _check_quota(session, user_id, len(data))
    await _validate_folder(session, user_id, folder_id)

    clean_name = await _unique_filename(
        session, user_id, _sanitize_filename(filename), folder_id=folder_id
    )
    mime = _detect_mime(data, clean_name)

    attachment = Attachment(
        user_id=user_id,
        folder_id=folder_id,
        filename=clean_name,
        mime=mime,
        size=len(data),
        storage_path="",
    )
    session.add(attachment)
    await session.flush()

    dest = _attachment_dir(user_id) / str(attachment.id)
    await run_in_threadpool(dest.write_bytes, data)
    attachment.storage_path = str(dest)

    await session.commit()
    await session.refresh(attachment)
    return attachment


async def update_attachment(
    session: AsyncSession,
    user_id: uuid.UUID,
    attachment_id: uuid.UUID,
    data: AttachmentUpdate,
) -> Attachment:
    attachment = await get_owned_or_404(session, Attachment, attachment_id, user_id)

    folder_changing = "folder_id" in data.model_fields_set
    target_folder_id = data.folder_id if folder_changing else attachment.folder_id
    if folder_changing:
        await _validate_folder(session, user_id, target_folder_id)

    filename_changing = "filename" in data.model_fields_set and data.filename is not None
    raw_name = data.filename if data.filename is not None else attachment.filename

    if folder_changing or filename_changing:
        clean_name = await _unique_filename(
            session,
            user_id,
            _sanitize_filename(raw_name),
            folder_id=target_folder_id,
            exclude_attachment_id=attachment.id,
        )
        attachment.folder_id = target_folder_id
        attachment.filename = clean_name
        await session.commit()
        await session.refresh(attachment)

    return attachment


async def get_attachment(
    session: AsyncSession, user_id: uuid.UUID, attachment_id: uuid.UUID
) -> Attachment:
    return await get_owned_or_404(session, Attachment, attachment_id, user_id)


async def get_attachment_used_by(
    session: AsyncSession, user_id: uuid.UUID, attachment_id: uuid.UUID
) -> list[str]:
    result = await session.scalars(
        select(Note.title)
        .join(NoteAttachment, NoteAttachment.note_id == Note.id)
        .where(
            NoteAttachment.attachment_id == attachment_id,
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
        )
    )
    return list(result)


async def list_attachments_with_usage(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    folder_id: uuid.UUID | None = None,
    folder_filter: bool = False,
) -> list[tuple[Attachment, list[str]]]:
    stmt = select(Attachment).where(Attachment.user_id == user_id)
    if folder_filter:
        stmt = stmt.where(_folder_condition(folder_id))
    attachments = list(await session.scalars(stmt.order_by(Attachment.created_at.desc())))

    result = await session.execute(
        select(NoteAttachment.attachment_id, Note.title)
        .join(Note, Note.id == NoteAttachment.note_id)
        .where(Note.user_id == user_id, Note.deleted_at.is_(None))
    )
    usage: dict[uuid.UUID, list[str]] = {}
    for attachment_id, title in result.all():
        usage.setdefault(attachment_id, []).append(title)

    return [(a, usage.get(a.id, [])) for a in attachments]


async def delete_attachment(
    session: AsyncSession, user_id: uuid.UUID, attachment_id: uuid.UUID
) -> None:
    attachment = await get_owned_or_404(session, Attachment, attachment_id, user_id)
    path = Path(attachment.storage_path)
    await session.delete(attachment)
    await session.commit()
    path.unlink(missing_ok=True)


async def delete_unused_attachments(session: AsyncSession, user_id: uuid.UUID) -> int:
    pairs = await list_attachments_with_usage(session, user_id)
    count = 0
    for attachment, used_by in pairs:
        if not used_by:
            await delete_attachment(session, user_id, attachment.id)
            count += 1
    return count
