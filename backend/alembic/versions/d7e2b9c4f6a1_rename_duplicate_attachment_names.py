"""rename duplicate attachment filenames

Revision ID: d7e2b9c4f6a1
Revises: c3d5e8f1a2b4
Create Date: 2026-09-25 07:00:00.000000

"""

from collections.abc import Sequence
from pathlib import PurePosixPath

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e2b9c4f6a1"
down_revision: str | None = "c3d5e8f1a2b4"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

MAX_FILENAME_LENGTH = 255


def upgrade() -> None:
    # Embeds resolve by filename and only when it's unique per user, so attachments that
    # share a name (created before uploads were numbered) never resolved at all. Keep the
    # oldest under its name — embeds now resolve to it — and number the rest the same way
    # new uploads are: "image (2).png", "image (3).png"…
    conn = op.get_bind()
    duplicates = conn.execute(
        sa.text(
            """
            SELECT id, user_id, filename FROM attachments a
            WHERE EXISTS (
                SELECT 1 FROM attachments b
                WHERE b.user_id = a.user_id AND b.filename = a.filename AND b.id <> a.id
            )
            ORDER BY user_id, filename, created_at, id
            """
        )
    ).fetchall()

    taken: dict[object, set[str]] = {}
    seen: set[tuple[object, str]] = set()
    for attachment_id, user_id, filename in duplicates:
        if user_id not in taken:
            taken[user_id] = set(
                conn.execute(
                    sa.text("SELECT filename FROM attachments WHERE user_id = :u"), {"u": user_id}
                ).scalars()
            )
        if (user_id, filename) not in seen:
            seen.add((user_id, filename))  # the oldest keeps its name
            continue
        path = PurePosixPath(filename)
        stem, suffix = path.stem, path.suffix
        counter = 2
        while True:
            marker = f" ({counter})"
            candidate = stem[: MAX_FILENAME_LENGTH - len(marker) - len(suffix)] + marker + suffix
            if candidate not in taken[user_id]:
                break
            counter += 1
        taken[user_id].add(candidate)
        conn.execute(
            sa.text("UPDATE attachments SET filename = :f WHERE id = :id"),
            {"f": candidate, "id": attachment_id},
        )


def downgrade() -> None:
    # Renames are not reverted: the old names were ambiguous duplicates.
    pass
