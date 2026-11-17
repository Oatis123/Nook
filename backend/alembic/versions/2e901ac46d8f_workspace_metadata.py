"""Add workspace descriptions, pinned notes and task list membership.

Revision ID: 2e901ac46d8f
Revises: b7d2e4f6a8c1
"""

import sqlalchemy as sa

from alembic import op

revision: str = "2e901ac46d8f"
down_revision: str | None = "b7d2e4f6a8c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("folders", sa.Column("description", sa.String(2000), nullable=True))
    op.add_column("folders", sa.Column("pinned_note_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_folders_pinned_note_id",
        "folders",
        "notes",
        ["pinned_note_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("task_lists", sa.Column("workspace_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_task_lists_workspace_id",
        "task_lists",
        "folders",
        ["workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_task_lists_workspace_id", "task_lists", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_task_lists_workspace_id", table_name="task_lists")
    op.drop_constraint("fk_task_lists_workspace_id", "task_lists", type_="foreignkey")
    op.drop_column("task_lists", "workspace_id")
    op.drop_constraint("fk_folders_pinned_note_id", "folders", type_="foreignkey")
    op.drop_column("folders", "pinned_note_id")
    op.drop_column("folders", "description")
