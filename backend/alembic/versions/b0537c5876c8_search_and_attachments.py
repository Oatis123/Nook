"""full-text search vectors, trigram index, attachments

Revision ID: b0537c5876c8
Revises: 3b2f51e17d43
Create Date: 2026-09-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b0537c5876c8"
down_revision: str | None = "3b2f51e17d43"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Two generated columns (english + russian configs) rather than one 'simple' vector,
    # queried with OR — correct stemming for both languages (see docs/DECISIONS.md).
    op.execute(
        """
        ALTER TABLE notes ADD COLUMN search_vector_en tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'B')
        ) STORED
        """
    )
    op.execute(
        """
        ALTER TABLE notes ADD COLUMN search_vector_ru tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('russian', coalesce(content, '')), 'B')
        ) STORED
        """
    )
    op.execute("CREATE INDEX ix_notes_search_vector_en ON notes USING gin (search_vector_en)")
    op.execute("CREATE INDEX ix_notes_search_vector_ru ON notes USING gin (search_vector_ru)")
    op.execute("CREATE INDEX ix_notes_title_trgm ON notes USING gin (title gin_trgm_ops)")

    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime", sa.String(length=255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_attachments_user_id", "attachments", ["user_id"])

    op.create_table(
        "note_attachments",
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "attachment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("attachments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("note_attachments")
    op.drop_index("ix_attachments_user_id", table_name="attachments")
    op.drop_table("attachments")

    op.execute("DROP INDEX IF EXISTS ix_notes_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_notes_search_vector_ru")
    op.execute("DROP INDEX IF EXISTS ix_notes_search_vector_en")
    op.execute("ALTER TABLE notes DROP COLUMN search_vector_ru")
    op.execute("ALTER TABLE notes DROP COLUMN search_vector_en")
