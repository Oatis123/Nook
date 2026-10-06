"""weekly digest

Revision ID: a3c5e7f9b1d4
Revises: f1b6d3a9c2e7
Create Date: 2026-10-06 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c5e7f9b1d4"
down_revision: str | None = "f1b6d3a9c2e7"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "weekly_digest_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    op.add_column("users", sa.Column("weekly_digest_sent_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "weekly_digest_sent_on")
    op.drop_column("users", "weekly_digest_enabled")
