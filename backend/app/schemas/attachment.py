import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AttachmentOut(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID | None = None
    filename: str
    mime: str
    size: int
    created_at: datetime
    used_by: list[str]


class AttachmentUpdate(BaseModel):
    folder_id: uuid.UUID | None = None
    filename: str | None = Field(default=None, min_length=1, max_length=255)
