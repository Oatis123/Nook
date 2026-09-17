import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field

from app.models.task import TaskPriority, TaskStatus
from app.services.recurrence import RecurrenceInput


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


class CalendarEntryOut(BaseModel):
    task_id: uuid.UUID
    list_id: uuid.UUID
    title: str
    priority: TaskPriority
    date: date
    time: time | None
    virtual: bool
