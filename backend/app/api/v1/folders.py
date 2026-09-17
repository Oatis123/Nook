import uuid

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.folder import FolderCreate, FolderOut, FolderUpdate
from app.services import folders as folders_service

router = APIRouter(prefix="/folders", tags=["folders"])
Csrf = Depends(require_csrf)


@router.get("", response_model=list[FolderOut])
async def list_folders(user: CurrentUser, session: DbSession) -> list[FolderOut]:
    folders = await folders_service.list_folders(session, user.id)
    return [FolderOut.model_validate(f) for f in folders]


@router.post("", response_model=FolderOut, dependencies=[Csrf])
async def create_folder(body: FolderCreate, user: CurrentUser, session: DbSession) -> FolderOut:
    folder = await folders_service.create_folder(session, user.id, body.name, body.parent_id)
    return FolderOut.model_validate(folder)


@router.patch("/{folder_id}", response_model=FolderOut, dependencies=[Csrf])
async def update_folder(
    folder_id: uuid.UUID, body: FolderUpdate, user: CurrentUser, session: DbSession
) -> FolderOut:
    folder = await folders_service.update_folder(session, user.id, folder_id, body)
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def delete_folder(folder_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await folders_service.delete_folder(session, user.id, folder_id)
