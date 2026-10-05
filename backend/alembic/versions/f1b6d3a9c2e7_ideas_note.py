"""ideas note

Revision ID: f1b6d3a9c2e7
Revises: e4a8c1f3b9d2
Create Date: 2026-10-05 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1b6d3a9c2e7"
down_revision: str | None = "e4a8c1f3b9d2"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column("is_ideas", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "uq_notes_one_ideas_note_per_user",
        "notes",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_ideas"),
    )
    op.add_column(
        "users",
        sa.Column(
            "ideas_note_hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "ideas_note_hidden")
    op.drop_index("uq_notes_one_ideas_note_per_user", table_name="notes")
    op.drop_column("notes", "is_ideas")
