import uuid
from pathlib import Path, PurePosixPath

import filetype
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.isolation import get_owned_or_404
from app.models.attachment import Attachment, NoteAttachment
from app.models.note import Note


def _sanitize_filename(filename: str) -> str:
    """Never used to build a filesystem path (attachments are stored under their id),
    but sanitized anyway so a malicious/odd name doesn't render confusingly in the UI."""
    name = PurePosixPath(filename.replace("\\", "/")).name.strip()
    return name or "file"


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


async def save_attachment(
    session: AsyncSession, user_id: uuid.UUID, filename: str, data: bytes
) -> Attachment:
    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"File exceeds the {settings.max_upload_mb} MB limit"
        )

    clean_name = _sanitize_filename(filename)
    mime = _detect_mime(data, clean_name)

    attachment = Attachment(
        user_id=user_id, filename=clean_name, mime=mime, size=len(data), storage_path=""
    )
    session.add(attachment)
    await session.flush()

    dest = _attachment_dir(user_id) / str(attachment.id)
    dest.write_bytes(data)
    attachment.storage_path = str(dest)

    await session.commit()
    await session.refresh(attachment)
    return attachment


async def get_attachment(
    session: AsyncSession, user_id: uuid.UUID, attachment_id: uuid.UUID
) -> Attachment:
    return await get_owned_or_404(session, Attachment, attachment_id, user_id)


async def list_attachments_with_usage(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Attachment, list[str]]]:
    attachments = list(
        await session.scalars(
            select(Attachment)
            .where(Attachment.user_id == user_id)
            .order_by(Attachment.created_at.desc())
        )
    )

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
