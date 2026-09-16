import enum
from datetime import datetime, time

from sqlalchemy import Boolean, DateTime, Enum, String, Time, func
from sqlalchemy.dialects.postgresql import BIGINT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class UserRole(enum.StrEnum):
    admin = "admin"
    user = "user"


class Theme(enum.StrEnum):
    light = "light"
    dark = "dark"
    system = "system"


class User(UUIDPKMixin, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), nullable=False, default=UserRole.user
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    daily_reminder_time: Mapped[time] = mapped_column(Time, nullable=False, default=time(9, 0))
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    theme: Mapped[Theme] = mapped_column(
        Enum(Theme, name="theme"), nullable=False, default=Theme.system
    )
    editor_preview_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    telegram_user_id: Mapped[int | None] = mapped_column(BIGINT, unique=True, nullable=True)
    telegram_chat_id: Mapped[int | None] = mapped_column(BIGINT, nullable=True)
    telegram_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
