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


class TelegramReauth(BaseModel):
    """Current password, required to unlink Telegram or to start linking a different
    account while one is linked — otherwise a hijacked session (a few minutes on someone
    else's computer) could attach the attacker's Telegram, and with it permanent
    "log in with Telegram" access that survives a password change."""

    current_password: str | None = None
