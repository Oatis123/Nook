import re
import uuid
from datetime import date, datetime, time, timedelta

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.task import TaskPriority, TaskStatus
from app.schemas.task_note_link import LinkedNoteOut
from app.services.recurrence import RecurrenceInput
from app.services.reminders import MAX_REMINDER_OFFSET_MINUTES, MAX_REMINDERS_PER_TASK

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


MAX_TAGS_PER_TASK = 20
# The same shape as a note's `#tag` (app/services/note_parsing.py), without the `#`.
_TAG_RE = re.compile(r"[^\W\d_][\w-]*(?:/[^\W\d_][\w-]*)*")


def _check_tags(value: list[str] | None) -> list[str] | None:
    """Accepts `#tag` or `tag`; drops duplicates, keeping the first spelling's order."""
    if value is None:
        return None
    tags: list[str] = []
    for raw in value:
        tag = raw.strip().removeprefix("#")
        if not _TAG_RE.fullmatch(tag) or len(tag) > 255:
            raise ValueError(
                f"'{raw}' is not a valid tag (letters, digits, '-', '_' and '/' for nesting; "
                "starts with a letter)"
            )
        if tag not in tags:
            tags.append(tag)
    if len(tags) > MAX_TAGS_PER_TASK:
        raise ValueError(f"A task can have at most {MAX_TAGS_PER_TASK} tags")
    return tags


def _check_reminder_offsets(value: list[int] | None) -> list[int] | None:
    """Minutes before the due moment; sorted largest (earliest reminder) first."""
    if value is None:
        return None
    offsets = sorted(set(value), reverse=True)
    if any(not 0 <= o <= MAX_REMINDER_OFFSET_MINUTES for o in offsets):
        raise ValueError(f"Reminder offsets must be between 0 and {MAX_REMINDER_OFFSET_MINUTES}")
    if len(offsets) > MAX_REMINDERS_PER_TASK:
        raise ValueError(f"A task can have at most {MAX_REMINDERS_PER_TASK} reminders")
    return offsets


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    list_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    priority: TaskPriority = TaskPriority.none
    due_date: date | None = None
    due_time: time | None = None
    reminders_enabled: bool = True
    # None: the default reminders (see app/services/reminders.py).
    reminder_offsets: list[int] | None = None
    tags: list[str] = Field(default_factory=list)
    recurrence: RecurrenceInput | None = None

    _due_date_range = field_validator("due_date")(_check_due_date)
    _tags = field_validator("tags")(_check_tags)
    _reminder_offsets = field_validator("reminder_offsets")(_check_reminder_offsets)


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
    reminder_offsets: list[int] | None = None
    # Back to the default reminders.
    default_reminders: bool = False
    tags: list[str] | None = None
    # Makes the task a subtask of `parent_id`, or a top-level task again (`clear_parent`).
    parent_id: uuid.UUID | None = None
    clear_parent: bool = False
    position: int | None = None
    recurrence: RecurrenceInput | None = None
    clear_recurrence: bool = False

    _due_date_range = field_validator("due_date")(_check_due_date)
    _tags = field_validator("tags")(_check_tags)
    _reminder_offsets = field_validator("reminder_offsets")(_check_reminder_offsets)


class TaskReorderRequest(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


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
    reminder_offsets: list[int] | None
    tags: list[str]
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
