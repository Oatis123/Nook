import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.task_note_link import LinkedTaskOut


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    folder_id: uuid.UUID | None = None
    content: str = ""


class NoteUpdate(BaseModel):
    version: int
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    folder_id: uuid.UUID | None = Field(default=None)
    move_to_root: bool = False
    # When renaming, also rewrite `[[OldTitle]]` to `[[NewTitle]]` in every note that
    # links to this one (spec §6.5). Preview the count via GET /notes/{id}/rename-impact.
    update_links: bool = False


class NoteSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    folder_id: uuid.UUID | None
    title: str
    version: int
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class NoteDetail(NoteSummary):
    content: str
    frontmatter: dict
    tags: list[str] = []
    aliases: list[str] = []
    linked_tasks: list[LinkedTaskOut] = []
