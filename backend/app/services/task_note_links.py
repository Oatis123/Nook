import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.isolation import get_owned_or_404
from app.models.note import Note
from app.models.task import Task
from app.models.task_note_link import TaskNoteLink
from app.schemas.task import TaskCreate
from app.services.tasks import create_task as create_task_service


async def link_note_to_task(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, note_id: uuid.UUID
) -> None:
    # Both sides must resolve under the current user — never trust a bare id pair,
    # since task_note_links itself carries no user_id to isolate on directly.
    await get_owned_or_404(session, Task, task_id, user_id)
    await get_owned_or_404(session, Note, note_id, user_id)

    existing = await session.get(TaskNoteLink, (task_id, note_id))
    if existing is None:
        session.add(TaskNoteLink(task_id=task_id, note_id=note_id))
        await session.commit()


async def unlink_note_from_task(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, note_id: uuid.UUID
) -> None:
    await get_owned_or_404(session, Task, task_id, user_id)
    link = await session.get(TaskNoteLink, (task_id, note_id))
    if link is not None:
        await session.delete(link)
        await session.commit()


async def get_linked_notes(session: AsyncSession, task_id: uuid.UUID) -> list[Note]:
    result = await session.scalars(
        select(Note)
        .join(TaskNoteLink, TaskNoteLink.note_id == Note.id)
        .where(TaskNoteLink.task_id == task_id, Note.deleted_at.is_(None))
        .order_by(Note.title)
    )
    return list(result)


async def get_linked_tasks(session: AsyncSession, note_id: uuid.UUID) -> list[Task]:
    result = await session.scalars(
        select(Task)
        .join(TaskNoteLink, TaskNoteLink.task_id == Task.id)
        .where(TaskNoteLink.note_id == note_id, Task.deleted_at.is_(None))
        .order_by(Task.position)
    )
    return list(result)


async def create_task_from_note(
    session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID, title: str
) -> Task:
    await get_owned_or_404(session, Note, note_id, user_id)
    task = await create_task_service(session, user_id, TaskCreate(title=title))
    session.add(TaskNoteLink(task_id=task.id, note_id=note_id))
    await session.commit()
    return task
