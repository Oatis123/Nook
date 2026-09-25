"""partial index for pending reminders

Revision ID: c3d5e8f1a2b4
Revises: a41c9d2e7b10
Create Date: 2026-09-25 05:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d5e8f1a2b4"
down_revision: str | None = "a41c9d2e7b10"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_scheduled_reminders_remind_at", table_name="scheduled_reminders")
    op.create_index(
        "ix_scheduled_reminders_pending_remind_at",
        "scheduled_reminders",
        ["remind_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("ix_scheduled_reminders_pending_remind_at", table_name="scheduled_reminders")
    op.create_index(
        "ix_scheduled_reminders_remind_at", "scheduled_reminders", ["remind_at"], unique=False
    )
