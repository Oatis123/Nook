import uuid

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.task_list import TaskListCreate, TaskListOut, TaskListUpdate
from app.services import task_lists as task_lists_service

router = APIRouter(prefix="/task-lists", tags=["task-lists"])
Csrf = Depends(require_csrf)


@router.get("", response_model=list[TaskListOut])
async def list_task_lists(user: CurrentUser, session: DbSession) -> list[TaskListOut]:
    lists = await task_lists_service.list_task_lists(session, user.id)
    return [TaskListOut.model_validate(item) for item in lists]


@router.post("", response_model=TaskListOut, dependencies=[Csrf])
async def create_task_list(
    body: TaskListCreate, user: CurrentUser, session: DbSession
) -> TaskListOut:
    task_list = await task_lists_service.create_task_list(
        session, user.id, body.name, body.color, body.icon
    )
    return TaskListOut.model_validate(task_list)


@router.patch("/{list_id}", response_model=TaskListOut, dependencies=[Csrf])
async def update_task_list(
    list_id: uuid.UUID, body: TaskListUpdate, user: CurrentUser, session: DbSession
) -> TaskListOut:
    task_list = await task_lists_service.update_task_list(session, user.id, list_id, body)
    return TaskListOut.model_validate(task_list)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def delete_task_list(
    list_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    delete_tasks: bool = False,
) -> None:
    await task_lists_service.delete_task_list(session, user.id, list_id, delete_tasks)
