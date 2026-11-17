import uuid

from pydantic import BaseModel, ConfigDict, Field


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=2000)


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    pinned_note_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = Field(default=None)
    position: int | None = None
    # Distinguishes "leave parent_id unchanged" from "set parent_id to null" (move to root).
    move_to_root: bool = False


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    position: int
    description: str | None = None
    pinned_note_id: uuid.UUID | None = None
