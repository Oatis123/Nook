import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.task_list import TaskListColor, TaskListIcon


class TaskListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    color: TaskListColor = TaskListColor.palette_1
    icon: TaskListIcon = TaskListIcon.folder


class TaskListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    color: TaskListColor | None = None
    icon: TaskListIcon | None = None
    position: int | None = None
    archived: bool | None = None


class TaskListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: TaskListColor
    icon: TaskListIcon
    position: int
    is_inbox: bool
    archived_at: datetime | None
