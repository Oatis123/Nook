import uuid

from pydantic import BaseModel


class BacklinkOut(BaseModel):
    source_note_id: uuid.UUID
    source_note_title: str
    heading: str | None


class RenameImpact(BaseModel):
    affected_notes: int
