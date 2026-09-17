from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.scheduled_reminder import ReminderKind, ReminderStatus, ScheduledReminder
from app.models.task import Task
from app.models.task_list import TaskList
from app.models.user import User
from app.services.reminders import (
    MAX_ATTEMPTS,
    RETRY_BACKOFF_MINUTES,
    WORKER_CATCHUP_WINDOW,
    format_reminder_text,
    reminder_task_url,
    schedule_next_occurrence_reminder,
)

settings = get_settings()


# Raised by a sender to signal the recipient has blocked the bot — the real Telegram sender
# (worker/bot.py) translates aiogram's TelegramForbiddenError into this so this module has
# no dependency on aiogram, and tests can raise it directly with a fake sender.
class ReminderBlocked(Exception):
    pass


Sender = Callable[[int, str, str], Awaitable[None]]


async def dispatch_due_reminders(
    session: AsyncSession, send: Sender, *, now: datetime | None = None
) -> int:
    """Selects every `pending` reminder due by `now` (FOR UPDATE SKIP LOCKED, so multiple
    worker instances never double-send the same row) and resolves each one: send, cancel
    (stale past the catch-up window), or leave pending for a later tick. Returns how many
    rows it looked at. Takes `send` as a parameter rather than importing a Bot directly so
    the dispatch/backoff/catch-up logic can be tested without a live Telegram connection."""
    now = now or datetime.now(UTC)
    rows = list(
        await session.scalars(
            select(ScheduledReminder)
            .where(
                ScheduledReminder.status == ReminderStatus.pending,
                ScheduledReminder.remind_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
    )
    for row in rows:
        await _dispatch_one(session, row, send, now)
    await session.commit()
    return len(rows)


async def _dispatch_one(
    session: AsyncSession, row: ScheduledReminder, send: Sender, now: datetime
) -> None:
    if now - row.remind_at > WORKER_CATCHUP_WINDOW:
        row.status = ReminderStatus.cancelled
        return

    task = await session.get(Task, row.task_id)
    if task is None or task.deleted_at is not None:
        row.status = ReminderStatus.cancelled
        return
    user = await session.get(User, task.user_id)
    if user is None:
        row.status = ReminderStatus.cancelled
        return

    # Not deliverable right now, but not the reminder's fault — leave it pending so the
    # next tick retries once the user re-enables notifications or links Telegram. If that
    # never happens, the catch-up-window check above eventually cancels it on its own.
    if not user.notifications_enabled or user.telegram_chat_id is None:
        return

    task_list = await session.get(TaskList, task.list_id)
    if task_list is None:
        row.status = ReminderStatus.cancelled
        return

    text = format_reminder_text(ReminderKind(row.kind), task, task_list)
    url = reminder_task_url(settings.public_url, task)

    try:
        await send(user.telegram_chat_id, text, url)
    except ReminderBlocked:
        user.telegram_blocked = True
        row.status = ReminderStatus.failed
        row.last_error = "blocked"
        return
    except Exception as exc:  # noqa: BLE001 — any send failure feeds the same retry/backoff path
        row.attempts += 1
        row.last_error = str(exc)[:500]
        if row.attempts >= MAX_ATTEMPTS:
            row.status = ReminderStatus.failed
        else:
            row.remind_at = now + timedelta(minutes=RETRY_BACKOFF_MINUTES[row.attempts - 1])
        return

    row.status = ReminderStatus.sent
    user.telegram_blocked = False
    await schedule_next_occurrence_reminder(session, task, row.occurrence_at)
