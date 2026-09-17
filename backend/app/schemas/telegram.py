from datetime import datetime

from pydantic import BaseModel

from app.schemas.user import UserPublic


class TelegramTokenOut(BaseModel):
    deep_link_url: str
    expires_at: datetime


class TelegramLoginStatusIn(BaseModel):
    token: str


class TelegramLoginStatusOut(BaseModel):
    status: str
    user: UserPublic | None = None
