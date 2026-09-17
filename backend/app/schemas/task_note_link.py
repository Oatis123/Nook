import uuid

from pydantic import BaseModel

from app.models.task import TaskStatus


class LinkedNoteOut(BaseModel):
    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None


class LinkedTaskOut(BaseModel):
    id: uuid.UUID
    title: str
    status: TaskStatus
    list_id: uuid.UUID


class LinkNoteRequest(BaseModel):
    note_id: uuid.UUID


class NewTaskFromNoteRequest(BaseModel):
    title: str
