"""Add folder_id to attachments.

Revision ID: a8c4e1f2d9b3
Revises: 2e901ac46d8f
Create Date: 2026-11-22

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c4e1f2d9b3"
down_revision: str | None = "2e901ac46d8f"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "attachments",
        sa.Column("folder_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_attachments_folder_id",
        "attachments",
        "folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_attachments_folder_id", "attachments", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_attachments_folder_id", table_name="attachments")
    op.drop_constraint("fk_attachments_folder_id", "attachments", type_="foreignkey")
    op.drop_column("attachments", "folder_id")
