import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.import_job import ImportJobStatus


class ImportJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: ImportJobStatus
    report: dict | None
    created_at: datetime
    finished_at: datetime | None
