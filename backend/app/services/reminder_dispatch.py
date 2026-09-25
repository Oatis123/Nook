import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import structlog
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
log = structlog.get_logger()


# Raised by a sender to signal the recipient has blocked the bot — the real Telegram sender
# (worker/bot.py) translates aiogram's TelegramForbiddenError into this so this module has
# no dependency on aiogram, and tests can raise it directly with a fake sender.
class ReminderBlocked(Exception):
    pass


Sender = Callable[[int, str, str], Awaitable[None]]


# Upper bound on rows handled per call, so one tick can't run unbounded after downtime.
MAX_REMINDERS_PER_TICK = 500


async def dispatch_due_reminders(
    session: AsyncSession, send: Sender, *, now: datetime | None = None
) -> int:
    """Resolves every `pending` reminder due by `now`, one row per transaction: send,
    cancel (stale past the catch-up window), or leave pending for a later tick. Returns
    how many rows it looked at.

    Each row is locked (FOR UPDATE SKIP LOCKED, so multiple worker instances never
    double-send it) and committed right after it's handled — a crash or send failure
    midway through a batch used to roll back the rows already sent, and the next tick
    sent them again. Takes `send` as a parameter rather than importing a Bot directly so
    the dispatch/backoff/catch-up logic can be tested without a live Telegram connection."""
    now = now or datetime.now(UTC)
    seen: list[uuid.UUID] = []
    while len(seen) < MAX_REMINDERS_PER_TICK:
        query = (
            select(ScheduledReminder)
            .where(
                ScheduledReminder.status == ReminderStatus.pending,
                ScheduledReminder.remind_at <= now,
            )
            .order_by(ScheduledReminder.remind_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if seen:
            # Rows left pending on purpose (not deliverable right now) aren't retried
            # within the same tick.
            query = query.where(ScheduledReminder.id.not_in(seen))
        row = await session.scalar(query)
        if row is None:
            break
        seen.append(row.id)
        row_id = row.id
        try:
            await _dispatch_one(session, row, send, now)
            await session.commit()
        except Exception:
            # One broken row must not stall everyone's reminders: it would be picked
            # first again on every tick. Park it as failed and carry on.
            log.exception("reminders.dispatch_failed", reminder_id=str(row_id))
            await session.rollback()
            await _mark_failed(session, row_id)
    await session.commit()
    return len(seen)


async def _mark_failed(session: AsyncSession, row_id: uuid.UUID) -> None:
    try:
        failed = await session.get(ScheduledReminder, row_id)
        if failed is not None and failed.status == ReminderStatus.pending:
            failed.status = ReminderStatus.failed
            failed.attempts += 1
            failed.last_error = "internal error while dispatching"
        await session.commit()
    except Exception:
        log.exception("reminders.mark_failed_failed", reminder_id=str(row_id))
        await session.rollback()


async def _dispatch_one(
    session: AsyncSession, row: ScheduledReminder, send: Sender, now: datetime
) -> None:
    task = await session.get(Task, row.task_id)
    if task is None or task.deleted_at is not None:
        row.status = ReminderStatus.cancelled
        return

    if now - row.remind_at > WORKER_CATCHUP_WINDOW:
        row.status = ReminderStatus.cancelled
        # A recurring task's chain of "occurrence" reminders is only ever extended from
        # here — without this, one missed reminder (downtime, notifications off) ended
        # the task's reminders for good.
        await schedule_next_occurrence_reminder(session, task, row.occurrence_at, not_before=now)
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
        await schedule_next_occurrence_reminder(session, task, row.occurrence_at, not_before=now)
        return
    except Exception as exc:  # noqa: BLE001 — any send failure feeds the same retry/backoff path
        row.attempts += 1
        row.last_error = str(exc)[:500]
        if row.attempts >= MAX_ATTEMPTS:
            row.status = ReminderStatus.failed
            await schedule_next_occurrence_reminder(
                session, task, row.occurrence_at, not_before=now
            )
        else:
            row.remind_at = now + timedelta(minutes=RETRY_BACKOFF_MINUTES[row.attempts - 1])
        return

    row.status = ReminderStatus.sent
    user.telegram_blocked = False
    # Record the send before anything else can fail: otherwise an error in scheduling the
    # next occurrence would roll back "sent" and the message would go out again.
    await session.commit()
    await schedule_next_occurrence_reminder(session, task, row.occurrence_at)
