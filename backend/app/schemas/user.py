import uuid
from datetime import datetime, time
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import Theme, User, UserRole


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    role: UserRole
    is_active: bool
    timezone: str
    daily_reminder_time: time
    notifications_enabled: bool
    theme: Theme
    editor_preview_enabled: bool
    telegram_linked: bool
    telegram_blocked: bool
    created_at: datetime
    last_login_at: datetime | None

    @classmethod
    def from_user(cls, user: User) -> Self:
        return cls(
            id=user.id,
            username=user.username,
            role=user.role,
            is_active=user.is_active,
            timezone=user.timezone,
            daily_reminder_time=user.daily_reminder_time,
            notifications_enabled=user.notifications_enabled,
            theme=user.theme,
            editor_preview_enabled=user.editor_preview_enabled,
            telegram_linked=user.telegram_user_id is not None,
            telegram_blocked=user.telegram_blocked,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
        )


class MeUpdate(BaseModel):
    timezone: str | None = None
    daily_reminder_time: time | None = None
    notifications_enabled: bool | None = None
    theme: Theme | None = None
    editor_preview_enabled: bool | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)


class AdminUserOut(UserPublic):
    pass
