import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.isolation import get_owned_or_404
from app.models.task import Task
from app.models.task_list import TaskList, TaskListColor, TaskListIcon
from app.schemas.task_list import TaskListUpdate


async def get_or_create_inbox(session: AsyncSession, user_id: uuid.UUID) -> TaskList:
    inbox = await session.scalar(
        select(TaskList).where(TaskList.user_id == user_id, TaskList.is_inbox.is_(True))
    )
    if inbox is not None:
        return inbox
    inbox = TaskList(
        user_id=user_id,
        name="Inbox",
        color=TaskListColor.palette_1,
        icon=TaskListIcon.inbox,
        position=0,
        is_inbox=True,
    )
    session.add(inbox)
    await session.commit()
    await session.refresh(inbox)
    return inbox


async def create_task_list(
    session: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    color: TaskListColor,
    icon: TaskListIcon,
) -> TaskList:
    max_position = await session.scalar(
        select(func.max(TaskList.position)).where(TaskList.user_id == user_id)
    )
    task_list = TaskList(
        user_id=user_id, name=name, color=color, icon=icon, position=(max_position or 0) + 1
    )
    session.add(task_list)
    await session.commit()
    await session.refresh(task_list)
    return task_list


async def list_task_lists(session: AsyncSession, user_id: uuid.UUID) -> list[TaskList]:
    await get_or_create_inbox(session, user_id)
    result = await session.scalars(
        select(TaskList).where(TaskList.user_id == user_id).order_by(TaskList.position)
    )
    return list(result)


async def update_task_list(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, data: TaskListUpdate
) -> TaskList:
    task_list = await get_owned_or_404(session, TaskList, list_id, user_id)

    if data.name is not None:
        task_list.name = data.name
    if data.color is not None:
        task_list.color = data.color
    if data.icon is not None:
        task_list.icon = data.icon
    if data.position is not None:
        task_list.position = data.position
    if data.archived is not None:
        if task_list.is_inbox and data.archived:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Inbox can't be archived")
        task_list.archived_at = datetime.now(UTC) if data.archived else None

    await session.commit()
    await session.refresh(task_list)
    return task_list


async def delete_task_list(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, delete_tasks: bool
) -> None:
    task_list = await get_owned_or_404(session, TaskList, list_id, user_id)
    if task_list.is_inbox:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Inbox can't be deleted")

    if delete_tasks:
        now = datetime.now(UTC)
        tasks_result = await session.scalars(
            select(Task).where(
                Task.user_id == user_id, Task.list_id == list_id, Task.deleted_at.is_(None)
            )
        )
        for task in tasks_result:
            task.deleted_at = now
    else:
        inbox = await get_or_create_inbox(session, user_id)
        tasks_result = await session.scalars(
            select(Task).where(Task.user_id == user_id, Task.list_id == list_id)
        )
        for task in tasks_result:
            task.list_id = inbox.id

    await session.delete(task_list)
    await session.commit()
