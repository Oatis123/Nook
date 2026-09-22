"""expand task list colors and icons

Revision ID: 79c1667a7e2f
Revises: 62d223ebe002
Create Date: 2026-09-22 21:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "79c1667a7e2f"
down_revision: str | None = "62d223ebe002"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

NEW_COLORS = ["palette-7", "palette-8", "palette-9", "palette-10", "palette-11", "palette-12"]

NEW_ICONS = [
    "gift",
    "wallet",
    "utensils",
    "car",
    "gamepad-2",
    "palette",
    "camera",
    "wrench",
    "paw-print",
    "baby",
    "bike",
    "sparkles",
    "users",
    "lightbulb",
]


def upgrade() -> None:
    # Postgres can't add an enum value and use it in the same transaction, but adding
    # values on their own (nothing references them yet) is fine on PG12+.
    for value in NEW_COLORS:
        op.execute(f"ALTER TYPE task_list_color ADD VALUE IF NOT EXISTS '{value}'")
    for value in NEW_ICONS:
        op.execute(f"ALTER TYPE task_list_icon ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Postgres has no ALTER TYPE ... DROP VALUE -- shrinking the enum back would require
    # rebuilding the type (rename, create, migrate rows, drop), which isn't worth it for
    # a curated icon/color palette that only ever grows. Left as a no-op.
    pass
