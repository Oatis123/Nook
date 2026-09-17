import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.models.task import Task
from app.schemas.task import (
    CalendarEntryOut,
    TaskCompleteRequest,
    TaskCreate,
    TaskDetailOut,
    TaskOut,
    TaskUpdate,
)
from app.services import tasks as tasks_service
from app.services.tasks import SubtaskCounts, TaskWithCounts

router = APIRouter(prefix="/tasks", tags=["tasks"])
Csrf = Depends(require_csrf)
_DEFAULT_COMPLETE_REQUEST = TaskCompleteRequest()


def _to_out(item: TaskWithCounts) -> TaskOut:
    return TaskOut(
        id=item.task.id,
        list_id=item.task.list_id,
        parent_id=item.task.parent_id,
        title=item.task.title,
        priority=item.task.priority,
        due_date=item.task.due_date,
        due_time=item.task.due_time,
        status=item.task.status,
        completed_at=item.task.completed_at,
        reminders_enabled=item.task.reminders_enabled,
        position=item.task.position,
        subtask_done_count=item.counts.done,
        subtask_total_count=item.counts.total,
        is_recurring=item.task.is_recurring,
        rrule=item.task.rrule,
        recurrence_end=item.task.recurrence_end,
        created_at=item.task.created_at,
        updated_at=item.task.updated_at,
    )


def _to_detail_out(
    task: Task, counts: SubtaskCounts, subtasks: list[TaskWithCounts]
) -> TaskDetailOut:
    base = _to_out(TaskWithCounts(task=task, counts=counts))
    return TaskDetailOut(
        **base.model_dump(), description=task.description, subtasks=[_to_out(s) for s in subtasks]
    )


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    user: CurrentUser,
    session: DbSession,
    list_id: uuid.UUID | None = None,
    view: str | None = Query(default=None, pattern="^(today|upcoming)$"),
    status_filter: str = Query(default="open", alias="status", pattern="^(open|done|all)$"),
    priority: str | None = Query(default=None, pattern="^(none|low|medium|high)$"),
) -> list[TaskOut]:
    items = await tasks_service.list_tasks(
        session,
        user.id,
        list_id=list_id,
        view=view,
        status_filter=status_filter,
        priority=priority,
        timezone=user.timezone,
    )
    return [_to_out(item) for item in items]


@router.post("", response_model=TaskOut, dependencies=[Csrf])
async def create_task(body: TaskCreate, user: CurrentUser, session: DbSession) -> TaskOut:
    task = await tasks_service.create_task(session, user.id, body)
    return _to_out(TaskWithCounts(task=task))


@router.get("/calendar", response_model=list[CalendarEntryOut])
async def get_calendar(
    start: date, end: date, user: CurrentUser, session: DbSession
) -> list[CalendarEntryOut]:
    return await tasks_service.get_calendar_entries(session, user.id, start, end)


@router.get("/{task_id}", response_model=TaskDetailOut)
async def get_task(task_id: uuid.UUID, user: CurrentUser, session: DbSession) -> TaskDetailOut:
    task, counts, subtasks = await tasks_service.get_task_detail(session, user.id, task_id)
    return _to_detail_out(task, counts, subtasks)


@router.patch("/{task_id}", response_model=TaskOut, dependencies=[Csrf])
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, user: CurrentUser, session: DbSession
) -> TaskOut:
    task = await tasks_service.update_task(session, user.id, task_id, body)
    return _to_out(TaskWithCounts(task=task))


@router.post("/{task_id}/complete", response_model=TaskOut, dependencies=[Csrf])
async def complete_task(
    task_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    body: TaskCompleteRequest = _DEFAULT_COMPLETE_REQUEST,
) -> TaskOut:
    task = await tasks_service.complete_task(session, user.id, task_id, body.complete_subtasks)
    return _to_out(TaskWithCounts(task=task))


@router.post("/{task_id}/skip", response_model=TaskOut, dependencies=[Csrf])
async def skip_task(task_id: uuid.UUID, user: CurrentUser, session: DbSession) -> TaskOut:
    task = await tasks_service.skip_task_occurrence(session, user.id, task_id)
    return _to_out(TaskWithCounts(task=task))


@router.post("/{task_id}/reopen", response_model=TaskOut, dependencies=[Csrf])
async def reopen_task(task_id: uuid.UUID, user: CurrentUser, session: DbSession) -> TaskOut:
    task = await tasks_service.reopen_task(session, user.id, task_id)
    return _to_out(TaskWithCounts(task=task))


@router.delete("/{task_id}", status_code=204, dependencies=[Csrf])
async def delete_task(task_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await tasks_service.delete_task(session, user.id, task_id)
