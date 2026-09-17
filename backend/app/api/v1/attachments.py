import uuid

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.responses import FileResponse

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.models.attachment import Attachment
from app.schemas.attachment import AttachmentOut
from app.services import attachments as attachments_service

router = APIRouter(prefix="/attachments", tags=["attachments"])
Csrf = Depends(require_csrf)


def _to_out(attachment: Attachment, used_by: list[str]) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        filename=attachment.filename,
        mime=attachment.mime,
        size=attachment.size,
        created_at=attachment.created_at,
        used_by=used_by,
    )


@router.get("", response_model=list[AttachmentOut])
async def list_attachments(user: CurrentUser, session: DbSession) -> list[AttachmentOut]:
    pairs = await attachments_service.list_attachments_with_usage(session, user.id)
    return [_to_out(a, used_by) for a, used_by in pairs]


@router.post("", response_model=AttachmentOut, dependencies=[Csrf])
async def upload_attachment(
    user: CurrentUser, session: DbSession, file: UploadFile = File(...)
) -> AttachmentOut:
    data = await file.read()
    attachment = await attachments_service.save_attachment(
        session, user.id, file.filename or "file", data
    )
    return _to_out(attachment, [])


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
