import uuid
from datetime import date, datetime, time, timedelta

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.task import TaskPriority, TaskStatus
from app.schemas.task_note_link import LinkedNoteOut
from app.services.recurrence import RecurrenceInput

EARLIEST_DUE_DATE = date(2000, 1, 1)
MAX_DUE_YEARS_AHEAD = 50


def _check_due_date(value: date | None) -> date | None:
    """Bounded so a nonsense date (year 1, year 9999) can't be used to make recurrence
    expansion or the calendar do absurd amounts of work."""
    if value is None:
        return None
    latest = date.today() + timedelta(days=365 * MAX_DUE_YEARS_AHEAD)
    if not EARLIEST_DUE_DATE <= value <= latest:
        raise ValueError(f"due_date must be between {EARLIEST_DUE_DATE} and {latest}")
    return value


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    list_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    priority: TaskPriority = TaskPriority.none
    due_date: date | None = None
    due_time: time | None = None
    reminders_enabled: bool = True
    recurrence: RecurrenceInput | None = None

    _due_date_range = field_validator("due_date")(_check_due_date)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    list_id: uuid.UUID | None = None
    priority: TaskPriority | None = None
    due_date: date | None = None
    due_time: time | None = None
    clear_due_date: bool = False
    clear_due_time: bool = False
    reminders_enabled: bool | None = None
    position: int | None = None
    recurrence: RecurrenceInput | None = None
    clear_recurrence: bool = False

    _due_date_range = field_validator("due_date")(_check_due_date)


class TaskCompleteRequest(BaseModel):
    complete_subtasks: bool = False


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    list_id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    priority: TaskPriority
    due_date: date | None
    due_time: time | None
    status: TaskStatus
    completed_at: datetime | None
    reminders_enabled: bool
    position: int
    subtask_done_count: int
    subtask_total_count: int
    is_recurring: bool
    rrule: str | None
    recurrence_end: date | None
    created_at: datetime
    updated_at: datetime


class TaskDetailOut(TaskOut):
    description: str | None
    subtasks: list[TaskOut]
    linked_notes: list[LinkedNoteOut]


class CalendarEntryOut(BaseModel):
    task_id: uuid.UUID
    list_id: uuid.UUID
    title: str
    priority: TaskPriority
    date: date
    time: time | None
    virtual: bool
