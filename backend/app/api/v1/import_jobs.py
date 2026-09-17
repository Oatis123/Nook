import uuid

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.import_job import ImportJobOut
from app.services import vault_import as vault_import_service

router = APIRouter(prefix="/import", tags=["import"])
Csrf = Depends(require_csrf)


@router.post("", response_model=ImportJobOut, dependencies=[Csrf])
async def upload_import(
    user: CurrentUser, session: DbSession, file: UploadFile = File(...)
) -> ImportJobOut:
    data = await file.read()
    job = await vault_import_service.create_import_job(session, user.id, data)
    return ImportJobOut.model_validate(job)


@router.get("/{job_id}", response_model=ImportJobOut)
async def get_import_status(
    job_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ImportJobOut:
    job = await vault_import_service.get_import_job(session, user.id, job_id)
    return ImportJobOut.model_validate(job)
