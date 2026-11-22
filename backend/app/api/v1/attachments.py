import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import FileResponse

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.models.attachment import Attachment
from app.schemas.attachment import AttachmentOut, AttachmentUpdate
from app.services import attachments as attachments_service

router = APIRouter(prefix="/attachments", tags=["attachments"])
Csrf = Depends(require_csrf)


def _to_out(attachment: Attachment, used_by: list[str]) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        folder_id=attachment.folder_id,
        filename=attachment.filename,
        mime=attachment.mime,
        size=attachment.size,
        created_at=attachment.created_at,
        used_by=used_by,
    )


@router.get("", response_model=list[AttachmentOut])
async def list_attachments(
    user: CurrentUser,
    session: DbSession,
    folder_id: uuid.UUID | None = Query(default=None),
    root: bool = Query(default=False),
) -> list[AttachmentOut]:
    pairs = await attachments_service.list_attachments_with_usage(
        session,
        user.id,
        folder_id=None if root else folder_id,
        folder_filter=root or folder_id is not None,
    )
    return [_to_out(a, used_by) for a, used_by in pairs]


@router.post("", response_model=AttachmentOut, dependencies=[Csrf])
async def upload_attachment(
    user: CurrentUser,
    session: DbSession,
    file: UploadFile = File(...),
    folder_id: uuid.UUID | None = Query(default=None),
) -> AttachmentOut:
    # Read at most one byte past the limit: enough to reject an oversized file without
    # pulling all of it into memory.
    data = await file.read(attachments_service.max_upload_bytes() + 1)
    attachment = await attachments_service.save_attachment(
        session, user.id, file.filename or "file", data, folder_id=folder_id
    )
    return _to_out(attachment, [])


@router.patch("/{attachment_id}", response_model=AttachmentOut, dependencies=[Csrf])
async def update_attachment(
    attachment_id: uuid.UUID,
    body: AttachmentUpdate,
    user: CurrentUser,
    session: DbSession,
) -> AttachmentOut:
    attachment = await attachments_service.update_attachment(session, user.id, attachment_id, body)
    used_by = await attachments_service.get_attachment_used_by(session, user.id, attachment.id)
    return _to_out(attachment, used_by)


@router.get("/{attachment_id}/download")
async def download_attachment(
    attachment_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> FileResponse:
    attachment = await attachments_service.get_attachment(session, user.id, attachment_id)
    return FileResponse(
        attachment.storage_path, media_type=attachment.mime, filename=attachment.filename
    )


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def delete_attachment(
    attachment_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> None:
    await attachments_service.delete_attachment(session, user.id, attachment_id)


@router.post("/cleanup", dependencies=[Csrf])
async def cleanup_unused(user: CurrentUser, session: DbSession) -> dict[str, int]:
    count = await attachments_service.delete_unused_attachments(session, user.id)
    return {"deleted": count}
