import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class ReminderKind(enum.StrEnum):
    day_before = "day_before"
    hour_before = "hour_before"
    occurrence = "occurrence"


class ReminderStatus(enum.StrEnum):
    pending = "pending"
    sent = "sent"
    cancelled = "cancelled"
    failed = "failed"


class ScheduledReminder(UUIDPKMixin, Base):
    __tablename__ = "scheduled_reminders"
    __table_args__ = (
        UniqueConstraint(
            "task_id", "occurrence_at", "kind", name="uq_reminder_task_occurrence_kind"
        ),
        # The worker polls only pending rows every 30s; a partial index stays small no
        # matter how much sent/cancelled history accumulates.
        Index(
            "ix_scheduled_reminders_pending_remind_at",
            "remind_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Naive, in the task's own local due date/time — identifies which due instance (or
    # recurrence occurrence) this reminder is about; the (task_id, occurrence_at, kind)
    # triple is what the unique constraint keys idempotency on (spec §8.4).
    occurrence_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[ReminderKind] = mapped_column(
        Enum(ReminderKind, name="reminder_kind"), nullable=False
    )
    status: Mapped[ReminderStatus] = mapped_column(
        Enum(ReminderStatus, name="reminder_status"), nullable=False, default=ReminderStatus.pending
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
