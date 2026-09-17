import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field

from app.models.task import TaskPriority, TaskStatus


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    list_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    priority: TaskPriority = TaskPriority.none
    due_date: date | None = None
    due_time: time | None = None
    reminders_enabled: bool = True


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
    created_at: datetime
    updated_at: datetime


class TaskDetailOut(TaskOut):
    description: str | None
    subtasks: list[TaskOut]
