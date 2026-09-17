import uuid
from datetime import datetime

from pydantic import BaseModel


class AttachmentOut(BaseModel):
    id: uuid.UUID
    filename: str
    mime: str
    size: int
    created_at: datetime
    used_by: list[str]
