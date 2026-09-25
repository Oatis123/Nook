import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.isolation import get_owned_or_404
from app.models.folder import Folder
from app.models.note import Note
from app.schemas.folder import FolderUpdate


async def _validate_parent(
    session: AsyncSession, user_id: uuid.UUID, parent_id: uuid.UUID | None
) -> None:
    if parent_id is None:
        return
    parent = await session.get(Folder, parent_id)
    if parent is None or parent.user_id != user_id or parent.deleted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Parent folder not found")


async def create_folder(
    session: AsyncSession, user_id: uuid.UUID, name: str, parent_id: uuid.UUID | None
) -> Folder:
    await _validate_parent(session, user_id, parent_id)

    max_position = await session.scalar(
        select(func.max(Folder.position)).where(
            Folder.user_id == user_id,
            Folder.parent_id == parent_id,
            Folder.deleted_at.is_(None),
        )
    )
    folder = Folder(
        user_id=user_id, parent_id=parent_id, name=name, position=(max_position or 0) + 1
    )
    session.add(folder)
    await session.commit()
    await session.refresh(folder)
    return folder


async def list_folders(session: AsyncSession, user_id: uuid.UUID) -> list[Folder]:
    result = await session.scalars(
        select(Folder)
        .where(Folder.user_id == user_id, Folder.deleted_at.is_(None))
        .order_by(Folder.position)
    )
    return list(result)


async def _descendant_ids(
    session: AsyncSession, user_id: uuid.UUID, root_id: uuid.UUID
) -> set[uuid.UUID]:
    all_folders = await list_folders(session, user_id)
    children_by_parent: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for f in all_folders:
        children_by_parent.setdefault(f.parent_id, []).append(f.id)

    result: set[uuid.UUID] = {root_id}
    frontier = [root_id]
    while frontier:
        current = frontier.pop()
        for child_id in children_by_parent.get(current, []):
            if child_id not in result:
                result.add(child_id)
                frontier.append(child_id)
    return result


async def update_folder(
    session: AsyncSession, user_id: uuid.UUID, folder_id: uuid.UUID, data: FolderUpdate
) -> Folder:
    folder = await get_owned_or_404(session, Folder, folder_id, user_id)

    if data.name is not None:
        folder.name = data.name

    new_parent_id = None if data.move_to_root else data.parent_id
    if data.move_to_root or data.parent_id is not None:
        if new_parent_id is not None:
            # Lock the user's folders so two concurrent moves (A into B, B into A) can't
            # both pass the cycle check below against the same pre-move tree.
            await session.execute(
                select(Folder.id).where(Folder.user_id == user_id).with_for_update()
            )
            if new_parent_id == folder.id or new_parent_id in await _descendant_ids(
                session, user_id, folder.id
            ):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot move a folder into itself")
            await _validate_parent(session, user_id, new_parent_id)
        folder.parent_id = new_parent_id

    if data.position is not None:
        folder.position = data.position

    await session.commit()
    await session.refresh(folder)
    return folder


async def delete_folder(session: AsyncSession, user_id: uuid.UUID, folder_id: uuid.UUID) -> None:
    """Soft-deletes the folder and, cascading, every descendant folder and every note
    inside any of them — spec §11 gives folders their own `deleted_at`, so this mirrors
    note trash semantics instead of requiring an empty folder (agent's discretion)."""
    folder = await get_owned_or_404(session, Folder, folder_id, user_id)
    ids = await _descendant_ids(session, user_id, folder.id)
    now = datetime.now(UTC)

    folders_result = await session.scalars(
        select(Folder).where(Folder.id.in_(ids), Folder.deleted_at.is_(None))
    )
    for f in folders_result:
        f.deleted_at = now

    notes_result = await session.scalars(
        select(Note).where(
            Note.user_id == user_id, Note.folder_id.in_(ids), Note.deleted_at.is_(None)
        )
    )
    for n in notes_result:
        n.deleted_at = now

    await session.commit()
