"""task tags and per-task reminder offsets

Revision ID: b7d2e4f6a8c1
Revises: a3c5e7f9b1d4
Create Date: 2026-10-11 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2e4f6a8c1"
down_revision: str | None = "a3c5e7f9b1d4"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Adding a value on its own (nothing uses it in this migration) is fine on PG12+.
    op.execute("ALTER TYPE reminder_kind ADD VALUE IF NOT EXISTS 'before'")
    op.add_column(
        "tasks", sa.Column("reminder_offsets", postgresql.ARRAY(sa.Integer()), nullable=True)
    )
    op.add_column(
        "tasks",
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String(length=255)),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.add_column(
        "scheduled_reminders",
        sa.Column("offset_minutes", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.drop_constraint("uq_reminder_task_occurrence_kind", "scheduled_reminders", type_="unique")
    op.create_unique_constraint(
        "uq_reminder_task_occurrence_kind",
        "scheduled_reminders",
        ["task_id", "occurrence_at", "kind", "offset_minutes"],
    )


def downgrade() -> None:
    op.execute("DELETE FROM scheduled_reminders WHERE kind = 'before'")
    op.drop_constraint("uq_reminder_task_occurrence_kind", "scheduled_reminders", type_="unique")
    op.create_unique_constraint(
        "uq_reminder_task_occurrence_kind",
        "scheduled_reminders",
        ["task_id", "occurrence_at", "kind"],
    )
    op.drop_column("scheduled_reminders", "offset_minutes")
    op.drop_column("tasks", "tags")
    op.drop_column("tasks", "reminder_offsets")
