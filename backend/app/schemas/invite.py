import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator

from app.core.validation import validate_timezone


class InviteStatus(StrEnum):
    active = "active"
    used = "used"
    expired = "expired"
    revoked = "revoked"


class InviteCreate(BaseModel):
    comment: str | None = Field(default=None, max_length=255)
    expires_in_days: int | None = Field(default=None, gt=0, le=365)


class InviteOut(BaseModel):
    id: uuid.UUID
    comment: str | None
    status: InviteStatus
    expires_at: datetime
    used_by_username: str | None
    used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class InviteCreateOut(InviteOut):
    invite_url: str


class InviteAcceptRequest(BaseModel):
    token: str
    username: str
    password: str
    timezone: str

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str) -> str:
        # Empty means "not detected" and falls back to UTC in the service.
        return validate_timezone(value) if value else value


class InvitePreview(BaseModel):
    comment: str | None
    expires_at: datetime
