import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.isolation import get_owned_or_404
from app.models.task import Task, TaskStatus
from app.models.task_completion import TaskCompletion
from app.models.task_list import TaskList
from app.schemas.task import CalendarEntryOut, TaskCreate, TaskUpdate
from app.services import recurrence as recurrence_service
from app.services import reminders as reminders_service
from app.services.recurrence import RecurrenceInput
from app.services.task_lists import get_or_create_inbox


@dataclass(frozen=True)
class SubtaskCounts:
    done: int = 0
    total: int = 0


async def _subtask_counts(
    session: AsyncSession, parent_ids: set[uuid.UUID]
) -> dict[uuid.UUID, SubtaskCounts]:
    if not parent_ids:
        return {}
    result = await session.execute(
        select(
            Task.parent_id,
            func.count(),
            func.count().filter(Task.status == TaskStatus.done),
        )
        .where(Task.parent_id.in_(parent_ids), Task.deleted_at.is_(None))
        .group_by(Task.parent_id)
    )
    return {row[0]: SubtaskCounts(done=row[2], total=row[1]) for row in result.all()}


def _today_in(tz_name: str) -> date:
    try:
        return datetime.now(ZoneInfo(tz_name)).date()
    except Exception:
        return datetime.now(UTC).date()


async def _validate_list(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> None:
    task_list = await session.get(TaskList, list_id)
    if task_list is None or task_list.user_id != user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "List not found")


def _apply_recurrence(task: Task, rec: RecurrenceInput) -> None:
    """A recurring task's first occurrence must have both a date and a time (spec §7.4) —
    `dtstart_local` (naive, in the user's own timezone) anchors the RRULE expansion."""
    if task.due_date is None or task.due_time is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A recurring task needs both a due date and time"
        )
    dtstart = datetime.combine(task.due_date, task.due_time)
    rrule_string = recurrence_service.build_rrule(rec)
    task.is_recurring = True
    task.rrule = rrule_string
    task.dtstart_local = dtstart
    task.recurrence_end = recurrence_service.compute_recurrence_end(rrule_string, dtstart)


def _clear_recurrence(task: Task) -> None:
    task.is_recurring = False
    task.rrule = None
    task.dtstart_local = None
    task.recurrence_end = None


async def create_task(session: AsyncSession, user_id: uuid.UUID, data: TaskCreate) -> Task:
    if data.due_time is not None and data.due_date is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "due_time requires due_date")

    parent: Task | None = None
    if data.parent_id is not None:
        parent = await get_owned_or_404(session, Task, data.parent_id, user_id)
        if parent.parent_id is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Subtasks can't have their own subtasks"
            )
        list_id = parent.list_id
    elif data.list_id is not None:
        await _validate_list(session, user_id, data.list_id)
        list_id = data.list_id
    else:
        list_id = (await get_or_create_inbox(session, user_id)).id

    max_position = await session.scalar(
        select(func.max(Task.position)).where(
            Task.user_id == user_id, Task.list_id == list_id, Task.parent_id == data.parent_id
        )
    )
    task = Task(
        user_id=user_id,
        list_id=list_id,
        parent_id=data.parent_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        due_date=data.due_date,
        due_time=data.due_time,
        reminders_enabled=data.reminders_enabled,
        position=(max_position or 0) + 1,
    )
    if data.recurrence is not None:
        _apply_recurrence(task, data.recurrence)
    session.add(task)
    await session.flush()
    await reminders_service.recompute_reminders_for_task(session, task)
    await session.commit()
    await session.refresh(task)
    return task


@dataclass(frozen=True)
class TaskWithCounts:
    task: Task
    counts: SubtaskCounts = field(default_factory=SubtaskCounts)


async def _attach_counts(session: AsyncSession, tasks: list[Task]) -> list[TaskWithCounts]:
    counts_by_parent = await _subtask_counts(session, {t.id for t in tasks})
    return [
        TaskWithCounts(task=t, counts=counts_by_parent.get(t.id, SubtaskCounts())) for t in tasks
    ]


async def list_tasks(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    list_id: uuid.UUID | None = None,
    view: str | None = None,
    status_filter: str = "open",
    priority: str | None = None,
    timezone: str = "UTC",
) -> list[TaskWithCounts]:
    conditions = [Task.user_id == user_id, Task.parent_id.is_(None), Task.deleted_at.is_(None)]

    if list_id is not None:
        conditions.append(Task.list_id == list_id)

    if view == "today":
        today = _today_in(timezone)
        conditions += [
            Task.status == TaskStatus.open,
            Task.due_date.is_not(None),
            Task.due_date <= today,
        ]
    elif view == "upcoming":
        today = _today_in(timezone)
        conditions += [
            Task.status == TaskStatus.open,
            Task.due_date.is_not(None),
            Task.due_date >= today,
        ]
    elif status_filter == "open":
        conditions.append(Task.status == TaskStatus.open)
    elif status_filter == "done":
        conditions.append(Task.status == TaskStatus.done)
    # status_filter == "all": no status condition.

    if priority is not None:
        conditions.append(Task.priority == priority)

    result = await session.scalars(
        select(Task)
        .where(*conditions)
        .order_by(Task.due_date.is_(None), Task.due_date, Task.position)
    )
    return await _attach_counts(session, list(result))


async def get_task_detail(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID
) -> tuple[Task, SubtaskCounts, list[TaskWithCounts]]:
    task = await get_owned_or_404(session, Task, task_id, user_id)
    if task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")

    subtasks_result = await session.scalars(
        select(Task)
        .where(Task.parent_id == task_id, Task.deleted_at.is_(None))
        .order_by(Task.position)
    )
    subtasks = await _attach_counts(session, list(subtasks_result))
    counts = SubtaskCounts(
        done=sum(1 for s in subtasks if s.task.status == TaskStatus.done), total=len(subtasks)
    )
    return task, counts, subtasks


async def update_task(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, data: TaskUpdate
) -> Task:
    task = await get_owned_or_404(session, Task, task_id, user_id)
    if task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")

    if data.title is not None:
        task.title = data.title
    if data.description is not None:
        task.description = data.description
    if data.list_id is not None and task.parent_id is None:
        await _validate_list(session, user_id, data.list_id)
        task.list_id = data.list_id
    if data.priority is not None:
        task.priority = data.priority

    due_date = task.due_date
    due_time = task.due_time
    if data.clear_due_date:
        due_date, due_time = None, None
    elif data.due_date is not None:
        due_date = data.due_date
    if data.clear_due_time:
        due_time = None
    elif data.due_time is not None:
        due_time = data.due_time
    if due_time is not None and due_date is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "due_time requires due_date")
    task.due_date = due_date
    task.due_time = due_time

    if data.reminders_enabled is not None:
        task.reminders_enabled = data.reminders_enabled
    if data.position is not None:
        task.position = data.position

    if data.clear_recurrence:
        _clear_recurrence(task)
    elif data.recurrence is not None:
        _apply_recurrence(task, data.recurrence)

    await reminders_service.recompute_reminders_for_task(session, task)
    await session.commit()
    await session.refresh(task)
    return task


async def complete_task(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, complete_subtasks: bool
) -> Task:
    task = await get_owned_or_404(session, Task, task_id, user_id)
    if task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")

    open_subtasks = list(
        await session.scalars(
            select(Task).where(
                Task.parent_id == task_id, Task.status == TaskStatus.open, Task.deleted_at.is_(None)
            )
        )
    )
    if open_subtasks and not complete_subtasks:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Task has {len(open_subtasks)} open subtask(s)"
        )

    now = datetime.now(UTC)
    for subtask in open_subtasks:
        subtask.status = TaskStatus.done
        subtask.completed_at = now
        await reminders_service.recompute_reminders_for_task(session, subtask, now=now)

    if task.is_recurring and task.rrule and task.dtstart_local:
        _advance_recurring_task(session, task, now, skipped=False)
    else:
        task.status = TaskStatus.done
        task.completed_at = now

    await reminders_service.recompute_reminders_for_task(session, task, now=now)
    await session.commit()
    await session.refresh(task)
    return task


def _advance_recurring_task(
    session: AsyncSession, task: Task, now: datetime, *, skipped: bool
) -> None:
    assert task.rrule and task.dtstart_local and task.due_date  # narrows for mypy
    occurrence_at = datetime.combine(task.due_date, task.due_time or time(0, 0))
    session.add(
        TaskCompletion(
            task_id=task.id, occurrence_at=occurrence_at, completed_at=now, skipped=skipped
        )
    )

    next_occ = recurrence_service.next_occurrence(task.rrule, task.dtstart_local, occurrence_at)
    if next_occ is None:
        task.status = TaskStatus.done
        task.completed_at = now
    else:
        task.due_date = next_occ.date()
        task.due_time = next_occ.time()


async def skip_task_occurrence(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID
) -> Task:
    task = await get_owned_or_404(session, Task, task_id, user_id)
    if task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if not task.is_recurring or not task.rrule or not task.dtstart_local:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Task is not recurring")

    now = datetime.now(UTC)
    _advance_recurring_task(session, task, now, skipped=True)

    await reminders_service.recompute_reminders_for_task(session, task, now=now)
    await session.commit()
    await session.refresh(task)
    return task


async def reopen_task(session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    task = await get_owned_or_404(session, Task, task_id, user_id)
    if task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    task.status = TaskStatus.open
    task.completed_at = None
    await reminders_service.recompute_reminders_for_task(session, task)
    await session.commit()
    await session.refresh(task)
    return task


async def delete_task(session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    task = await get_owned_or_404(session, Task, task_id, user_id)
    now = datetime.now(UTC)
    task.deleted_at = now
    await reminders_service.recompute_reminders_for_task(session, task, now=now)

    subtasks_result = await session.scalars(
        select(Task).where(Task.parent_id == task_id, Task.deleted_at.is_(None))
    )
    for subtask in subtasks_result:
        subtask.deleted_at = now
        await reminders_service.recompute_reminders_for_task(session, subtask, now=now)

    await session.commit()


async def get_calendar_entries(
    session: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> list[CalendarEntryOut]:
    """Real tasks due within [start, end] plus, for open recurring tasks, their virtual
    future occurrences in that range (spec §7.6: computed on the fly, never stored)."""
    tasks = list(
        await session.scalars(
            select(Task).where(
                Task.user_id == user_id,
                Task.deleted_at.is_(None),
                Task.due_date.is_not(None),
                Task.due_date <= end,
                # A recurring task's current due_date can predate `start` while its future
                # occurrences still land inside [start, end] — keep those in the fetch even
                # though the plain due_date >= start check below would exclude them.
                (Task.due_date >= start) | (Task.is_recurring.is_(True)),
            )
        )
    )

    entries: list[CalendarEntryOut] = []
    range_start = datetime.combine(start, time(0, 0))
    range_end = datetime.combine(end, time(23, 59, 59))

    for task in tasks:
        if task.due_date is not None and start <= task.due_date <= end:
            entries.append(
                CalendarEntryOut(
                    task_id=task.id,
                    list_id=task.list_id,
                    title=task.title,
                    priority=task.priority,
                    date=task.due_date,
                    time=task.due_time,
                    virtual=False,
                )
            )

        if (
            task.is_recurring
            and task.status == TaskStatus.open
            and task.rrule
            and task.dtstart_local
            and task.due_date is not None
        ):
            current_occurrence = datetime.combine(task.due_date, task.due_time or time(0, 0))
            # Only ever expand from the task's current (still-pending) occurrence onward —
            # every earlier one has already been completed/skipped and advanced past, so
            # bounding the expansion here keeps already-resolved history out of the
            # calendar when browsing a past range, rather than mechanically re-deriving
            # every occurrence the RRULE would ever produce since dtstart.
            expand_from = max(range_start, current_occurrence)
            for occ in recurrence_service.occurrences_between(
                task.rrule, task.dtstart_local, expand_from, range_end
            ):
                if occ == current_occurrence:
                    continue
                entries.append(
                    CalendarEntryOut(
                        task_id=task.id,
                        list_id=task.list_id,
                        title=task.title,
                        priority=task.priority,
                        date=occ.date(),
                        time=occ.time(),
                        virtual=True,
                    )
                )

    entries.sort(key=lambda e: (e.date, e.time or time(0, 0)))
    return entries
