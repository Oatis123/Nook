import enum
import uuid
from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class TaskPriority(enum.StrEnum):
    none = "none"
    low = "low"
    medium = "medium"
    high = "high"


class TaskStatus(enum.StrEnum):
    open = "open"
    done = "done"


class Task(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "tasks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # One level of nesting only (spec §7.3) — enforced in app/services/tasks.py, not here.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[TaskPriority] = mapped_column(
        Enum(TaskPriority, name="task_priority"), nullable=False, default=TaskPriority.none
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    # Recurrence columns exist from Stage 8's migration (one `tasks` table, per the spec's
    # data model) but aren't yet settable through the API — expansion, `task_completions`,
    # and the quick-add/bot "every ..." parsing land in Stage 9 (agent's discretion, see
    # DECISIONS.md).
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rrule: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dtstart_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    recurrence_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    reminders_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status"), nullable=False, default=TaskStatus.open
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
