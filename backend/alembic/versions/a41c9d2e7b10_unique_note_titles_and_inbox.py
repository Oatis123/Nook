"""unique active note titles and one inbox per user

Revision ID: a41c9d2e7b10
Revises: 79c1667a7e2f
Create Date: 2026-09-25 04:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a41c9d2e7b10"
down_revision: str | None = "79c1667a7e2f"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Title uniqueness used to be check-then-insert only, so concurrent requests could
    # leave duplicates behind. Rename every duplicate but the oldest (the id suffix makes
    # the new title unique) so the index below can be created without losing anything.
    op.execute(
        """
        UPDATE notes SET title = left(n.title, 230) || ' (' || left(n.id::text, 8) || ')'
        FROM (
            SELECT id, title, row_number() OVER (
                PARTITION BY user_id, folder_id, title ORDER BY created_at, id
            ) AS rn
            FROM notes WHERE deleted_at IS NULL
        ) AS n
        WHERE notes.id = n.id AND n.rn > 1
        """
    )
    op.create_index(
        "uq_notes_active_title",
        "notes",
        ["user_id", "folder_id", "title"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        postgresql_nulls_not_distinct=True,
    )

    # Extra Inboxes (same race) become ordinary lists; their tasks stay where they are.
    op.execute(
        """
        UPDATE task_lists SET is_inbox = false
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY user_id ORDER BY position, id
            ) AS rn
            FROM task_lists WHERE is_inbox
        ) AS t
        WHERE task_lists.id = t.id AND t.rn > 1
        """
    )
    op.create_index(
        "uq_task_lists_one_inbox",
        "task_lists",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_inbox"),
    )


def downgrade() -> None:
    op.drop_index("uq_task_lists_one_inbox", table_name="task_lists")
    op.drop_index("uq_notes_active_title", table_name="notes")
