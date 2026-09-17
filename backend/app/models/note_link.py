import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class NoteLink(UUIDPKMixin, Base):
    __tablename__ = "note_links"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Null when the link doesn't resolve to exactly one note (not found, or ambiguous).
    target_note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=True, index=True
    )
    target_raw: Mapped[str] = mapped_column(String(255), nullable=False)
    heading: Mapped[str | None] = mapped_column(String(255), nullable=True)
