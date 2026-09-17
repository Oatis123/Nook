import uuid
from datetime import datetime

from sqlalchemy import Computed, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin
from app.models.note_alias import NoteAlias

_SEARCH_VECTOR_EN_SQL = (
    "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(content, '')), 'B')"
)
_SEARCH_VECTOR_RU_SQL = (
    "setweight(to_tsvector('russian', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('russian', coalesce(content, '')), 'B')"
)


class Note(UUIDPKMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_search_vector_en", "search_vector_en", postgresql_using="gin"),
        Index("ix_notes_search_vector_ru", "search_vector_ru", postgresql_using="gin"),
        Index(
            "ix_notes_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    frontmatter: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Generated STORED columns (populated by Postgres, see migration b0537c5876c8) — declared
    # here only so alembic's autogenerate doesn't see them as drift; queried via raw SQL in
    # app/services/search.py, never written to from Python.
    search_vector_en: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed(_SEARCH_VECTOR_EN_SQL, persisted=True), nullable=True
    )
    search_vector_ru: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed(_SEARCH_VECTOR_RU_SQL, persisted=True), nullable=True
    )

    aliases: Mapped[list[NoteAlias]] = relationship(
        NoteAlias, primaryjoin="Note.id == NoteAlias.note_id", lazy="selectin", viewonly=True
    )
