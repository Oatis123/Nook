import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class TaskCompletion(UUIDPKMixin, Base):
    __tablename__ = "task_completions"

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    occurrence_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    # Timestamp of whichever action (complete or skip) produced this record — there's no
    # separate "skipped_at" column, so this doubles as that when `skipped` is true.
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    skipped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
