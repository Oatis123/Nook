import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class TaskListColor(enum.StrEnum):
    """Keys into the fixed `--palette-N` design tokens (tokens.css) — spec §7.2/§10.3
    requires list colors come from a limited, muted, pre-vetted palette, not a free
    color picker."""

    palette_1 = "palette-1"
    palette_2 = "palette-2"
    palette_3 = "palette-3"
    palette_4 = "palette-4"
    palette_5 = "palette-5"
    palette_6 = "palette-6"


class TaskListIcon(enum.StrEnum):
    """A curated set of Lucide icon names the frontend maps 1:1 to components — spec
    §7.2 asks for an icon picker, not free-form icon input."""

    inbox = "inbox"
    briefcase = "briefcase"
    home = "home"
    heart = "heart"
    star = "star"
    book_open = "book-open"
    shopping_cart = "shopping-cart"
    dumbbell = "dumbbell"
    plane = "plane"
    graduation_cap = "graduation-cap"
    music = "music"
    code = "code"
    flag = "flag"
    target = "target"
    coffee = "coffee"
    folder = "folder"


class TaskList(UUIDPKMixin, Base):
    __tablename__ = "task_lists"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[TaskListColor] = mapped_column(
        Enum(TaskListColor, name="task_list_color"),
        nullable=False,
        default=TaskListColor.palette_1,
    )
    icon: Mapped[TaskListIcon] = mapped_column(
        Enum(TaskListIcon, name="task_list_icon"), nullable=False, default=TaskListIcon.folder
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_inbox: Mapped[bool] = mapped_column(nullable=False, default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
