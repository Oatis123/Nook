"""fix hyphenated task list enum labels

Revision ID: e4a8c1f3b9d2
Revises: d7e2b9c4f6a1
Create Date: 2026-09-28 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a8c1f3b9d2"
down_revision: str | None = "d7e2b9c4f6a1"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# SQLAlchemy's Enum stores member NAMES (palette_7), as 8925399efd7d did, but 79c1667a7e2f
# added these using the member VALUES (palette-7), so writing any of them failed with
# "invalid input value for enum". Values without a hyphen were unaffected (name == value).
RENAMES: dict[str, list[tuple[str, str]]] = {
    "task_list_color": [(f"palette-{n}", f"palette_{n}") for n in range(7, 13)],
    "task_list_icon": [("gamepad-2", "gamepad_2"), ("paw-print", "paw_print")],
}


def _rename_value(type_name: str, old: str, new: str) -> None:
    # Guarded so it's a no-op when the label is already right (e.g. a database whose
    # enum was created from the models) and never collides with an existing label.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumtypid = '{type_name}'::regtype AND enumlabel = '{old}'
            ) AND NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumtypid = '{type_name}'::regtype AND enumlabel = '{new}'
            ) THEN
                ALTER TYPE {type_name} RENAME VALUE '{old}' TO '{new}';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    for type_name, renames in RENAMES.items():
        for hyphenated, underscored in renames:
            _rename_value(type_name, hyphenated, underscored)


def downgrade() -> None:
    for type_name, renames in RENAMES.items():
        for hyphenated, underscored in renames:
            _rename_value(type_name, underscored, hyphenated)
