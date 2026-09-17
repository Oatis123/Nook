"""tags, note aliases, note links

Revision ID: 3b2f51e17d43
Revises: df2e67e52023
Create Date: 2026-09-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3b2f51e17d43"
down_revision: str | None = "df2e67e52023"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
    )
    op.create_index("ix_tags_user_id", "tags", ["user_id"])
    op.create_unique_constraint("uq_tags_user_id_name", "tags", ["user_id", "name"])

    op.create_table(
        "note_tags",
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "note_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("alias", sa.String(length=255), nullable=False),
    )
    op.create_index("ix_note_aliases_note_id", "note_aliases", ["note_id"])

    op.create_table(
        "note_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("target_raw", sa.String(length=255), nullable=False),
        sa.Column("heading", sa.String(length=255), nullable=True),
    )
    op.create_index("ix_note_links_user_id", "note_links", ["user_id"])
    op.create_index("ix_note_links_source_note_id", "note_links", ["source_note_id"])
    op.create_index("ix_note_links_target_note_id", "note_links", ["target_note_id"])


def downgrade() -> None:
    op.drop_index("ix_note_links_target_note_id", table_name="note_links")
    op.drop_index("ix_note_links_source_note_id", table_name="note_links")
    op.drop_index("ix_note_links_user_id", table_name="note_links")
    op.drop_table("note_links")

    op.drop_index("ix_note_aliases_note_id", table_name="note_aliases")
    op.drop_table("note_aliases")

    op.drop_table("note_tags")

    op.drop_constraint("uq_tags_user_id_name", "tags", type_="unique")
    op.drop_index("ix_tags_user_id", table_name="tags")
    op.drop_table("tags")
