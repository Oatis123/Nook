import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.task_note_link import LinkedTaskOut

# Generous for a text note, but bounded: Postgres' generated full-text columns fail on
# enormous documents, and every save re-parses the whole content.
MAX_NOTE_CONTENT_CHARS = 500_000


def _strip_nul(value: str | None) -> str | None:
    """Postgres text can't hold NUL characters (the save failed with a 500, and the
    editor retried forever); they're never meaningful in a note."""
    return value.replace("\x00", "") if value is not None else None


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    folder_id: uuid.UUID | None = None
    content: str = Field(default="", max_length=MAX_NOTE_CONTENT_CHARS)

    _no_nul = field_validator("title", "content", mode="before")(_strip_nul)


class NoteUpdate(BaseModel):
    version: int
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, max_length=MAX_NOTE_CONTENT_CHARS)
    folder_id: uuid.UUID | None = Field(default=None)
    move_to_root: bool = False
    # When renaming, also rewrite `[[OldTitle]]` to `[[NewTitle]]` in every note that
    # links to this one (spec §6.5). Preview the count via GET /notes/{id}/rename-impact.
    update_links: bool = False

    _no_nul = field_validator("title", "content", mode="before")(_strip_nul)


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
