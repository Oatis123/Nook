from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_reminder import ReminderKind, ReminderStatus, ScheduledReminder
from app.models.task import Task, TaskStatus
from app.models.task_list import TaskList
from app.models.user import User
from app.services import recurrence as recurrence_service
from app.services.telegram_format import PRIORITY_LABELS, format_due, plural

# spec §8.2: a newly computed reminder whose remind_at is already at-or-before "now" is
# dropped rather than scheduled (no catch-up messages at task/profile change time) — kept
# as a named constant, per the spec's own instruction, so the threshold is easy to change.
PAST_REMINDER_GRACE = timedelta(0)

# spec §8.4: after downtime, only reminders overdue by at most this much are still sent;
# older ones are cancelled instead.
WORKER_CATCHUP_WINDOW = timedelta(minutes=15)

MAX_ATTEMPTS = 3
# Delay before retrying after the Nth failed attempt (exponential backoff, spec §8.4).
RETRY_BACKOFF_MINUTES = [1, 2, 4]

MINUTES_PER_DAY = 24 * 60
# Bounds for Task.reminder_offsets (validated in app/schemas/task.py).
MAX_REMINDER_OFFSET_MINUTES = 30 * MINUTES_PER_DAY
MAX_REMINDERS_PER_TASK = 10

# Reminders go out through the bot, which speaks Russian (spec §8.3, §9).
REMINDER_KIND_LABEL: dict[ReminderKind, str] = {
    ReminderKind.day_before: "Завтра:",
    ReminderKind.hour_before: "Через час:",
    ReminderKind.occurrence: "Сейчас:",
}


@dataclass(frozen=True)
class DesiredReminder:
    occurrence_at: datetime
    remind_at: datetime
    kind: ReminderKind
    offset_minutes: int = 0

    @property
    def key(self) -> tuple[datetime, ReminderKind, int]:
        return (self.occurrence_at, self.kind, self.offset_minutes)


def _local_to_utc(local_dt: datetime, tz: ZoneInfo) -> datetime:
    return local_dt.replace(tzinfo=tz).astimezone(UTC)


def _is_recurring(task: Task) -> bool:
    return bool(task.is_recurring and task.rrule and task.dtstart_local)


def _occurrence_reminder(
    task: Task, tz: ZoneInfo, now: datetime, kind: ReminderKind, offset: int
) -> DesiredReminder | None:
    """A reminder `offset` minutes before the task's due moment. For a recurring task
    whose current occurrence is already too close (or past) for it, the reminder moves on
    to the first later occurrence it still fits before — so an edit to an overdue
    recurring task no longer silences it until it's ticked off."""
    assert task.due_date is not None
    before = timedelta(minutes=offset)
    occurrence_at = datetime.combine(task.due_date, task.due_time or time(0, 0))
    remind_at = _local_to_utc(occurrence_at, tz) - before
    if remind_at <= now - PAST_REMINDER_GRACE and _is_recurring(task):
        assert task.rrule and task.dtstart_local
        now_local = now.astimezone(tz).replace(tzinfo=None)
        next_occ = recurrence_service.next_occurrence(
            task.rrule,
            task.dtstart_local,
            max(occurrence_at, now_local + before),
            anchor=occurrence_at,
        )
        if next_occ is None:
            return None
        occurrence_at = next_occ
        remind_at = _local_to_utc(occurrence_at, tz) - before
    return DesiredReminder(occurrence_at, remind_at, kind, offset)


def _custom_reminders(
    task: Task, user: User, tz: ZoneInfo, now: datetime
) -> list[DesiredReminder | None]:
    """Task.reminder_offsets: one reminder per offset. A task with only a due date has no
    moment to count minutes back from, so its reminders go out at the user's daily
    reminder time, on the day `offset` (rounded down to whole days) before the due date."""
    assert task.due_date is not None and task.reminder_offsets is not None
    if task.due_time is not None:
        return [
            _occurrence_reminder(task, tz, now, ReminderKind.before, offset)
            for offset in sorted(set(task.reminder_offsets))
        ]
    occurrence_at = datetime.combine(task.due_date, time(0, 0))
    days_before = sorted({offset // MINUTES_PER_DAY for offset in task.reminder_offsets})
    return [
        DesiredReminder(
            occurrence_at,
            _local_to_utc(
                datetime.combine(task.due_date - timedelta(days=days), user.daily_reminder_time),
                tz,
            ),
            ReminderKind.before,
            days * MINUTES_PER_DAY,
        )
        for days in days_before
    ]


def compute_desired_reminders(
    task: Task, user: User, *, now: datetime | None = None
) -> list[DesiredReminder]:
    """The reminders `task` should have *right now*, per spec §8.2 — empty if the task is
    deleted, done, has reminders turned off, or has no due date. Entries whose remind_at
    would already be in the past are dropped (never returned), matching the "no catch-up
    messages at compute time" rule; `recompute_reminders_for_task` relies on that to also
    cancel a previously-scheduled reminder that a profile/task edit pushed into the past.

    A task with its own `reminder_offsets` gets exactly those. Otherwise the defaults: the
    day before (at the user's daily reminder time), an hour before and at the due moment —
    or, for a recurring task, the due moment of each occurrence."""
    if task.deleted_at is not None or task.status == TaskStatus.done or not task.reminders_enabled:
        return []
    if task.due_date is None:
        return []

    now = now or datetime.now(UTC)
    tz = ZoneInfo(user.timezone)
    occurrence_at = datetime.combine(task.due_date, task.due_time or time(0, 0))

    results: list[DesiredReminder | None] = []

    if task.reminder_offsets is not None:
        results = _custom_reminders(task, user, tz, now)
    elif _is_recurring(task):
        results.append(_occurrence_reminder(task, tz, now, ReminderKind.occurrence, 0))
    else:
        day_before_local = datetime.combine(
            task.due_date - timedelta(days=1), user.daily_reminder_time
        )
        results.append(
            DesiredReminder(
                occurrence_at, _local_to_utc(day_before_local, tz), ReminderKind.day_before
            )
        )
        if task.due_time is not None:
            due_at = _local_to_utc(occurrence_at, tz)
            results.append(
                DesiredReminder(
                    occurrence_at, due_at - timedelta(hours=1), ReminderKind.hour_before
                )
            )
            # At the due moment itself too: without it a task due in under an hour got no
            # reminder at all, since both earlier ones were already in the past. Sending
            # it never chains a next one — schedule_next_occurrence_reminder only acts on
            # recurring tasks.
            results.append(DesiredReminder(occurrence_at, due_at, ReminderKind.occurrence))

    return [r for r in results if r is not None and r.remind_at > now - PAST_REMINDER_GRACE]


async def recompute_reminders_for_task(
    session: AsyncSession, task: Task, *, now: datetime | None = None
) -> None:
    """Reconciles `scheduled_reminders` for one task against what it should have right now
    (spec §8.2/§8.4). Called after any task mutation that could affect its reminders —
    due date/time, recurrence, reminder settings, status, or soft-delete — so every call
    site just calls this unconditionally rather than tracking which fields changed."""
    now = now or datetime.now(UTC)
    user = await session.get(User, task.user_id)
    assert user is not None

    desired = compute_desired_reminders(task, user, now=now)
    desired_by_key = {r.key: r.remind_at for r in desired}

    # The unique (task_id, occurrence_at, kind, offset_minutes) index spans every status,
    # not just pending — a previously cancelled/sent/failed row for the same key still
    # occupies that slot, so it must be looked up (and possibly reused) rather than
    # re-inserted.
    existing = list(
        await session.scalars(select(ScheduledReminder).where(ScheduledReminder.task_id == task.id))
    )
    existing_by_key = {(r.occurrence_at, r.kind, r.offset_minutes): r for r in existing}

    for key, row in existing_by_key.items():
        if row.status == ReminderStatus.pending and key not in desired_by_key:
            row.status = ReminderStatus.cancelled

    for key, remind_at in desired_by_key.items():
        occurrence_at, kind, offset = key
        existing_row = existing_by_key.get(key)
        if existing_row is None:
            session.add(
                ScheduledReminder(
                    task_id=task.id,
                    occurrence_at=occurrence_at,
                    remind_at=remind_at,
                    kind=kind,
                    offset_minutes=offset,
                )
            )
        elif existing_row.status == ReminderStatus.pending:
            existing_row.remind_at = remind_at
        elif existing_row.status == ReminderStatus.cancelled:
            # Never delivered — safe to revive rather than violate the unique index
            # with a second row for the same identity (e.g. reminders_enabled was
            # toggled off then back on before this occurrence's reminder fired).
            existing_row.status = ReminderStatus.pending
            existing_row.remind_at = remind_at
            existing_row.attempts = 0
            existing_row.last_error = None
        # else: 'sent' or 'failed' — already resolved for this exact occurrence+kind;
        # leave it as history instead of resurrecting a reminder that already fired or
        # exhausted its retries for the same due instant.


async def recompute_reminders_for_user(
    session: AsyncSession, user: User, *, now: datetime | None = None
) -> None:
    """Spec §8.2: changing timezone or daily_reminder_time recomputes every affected open
    task's reminders."""
    tasks = list(
        await session.scalars(
            select(Task).where(
                Task.user_id == user.id, Task.deleted_at.is_(None), Task.due_date.is_not(None)
            )
        )
    )
    for task in tasks:
        await recompute_reminders_for_task(session, task, now=now)


def _in_days(days: int) -> str:
    return "Завтра:" if days == 1 else f"Через {days} {plural(days, 'день', 'дня', 'дней')}:"


def reminder_label(kind: ReminderKind, offset_minutes: int, *, timed: bool) -> str:
    """'Через 2 часа:', 'Через 15 минут:' — how far off the due moment a reminder is."""
    if kind != ReminderKind.before:
        return REMINDER_KIND_LABEL[kind]
    if not timed:
        days = offset_minutes // MINUTES_PER_DAY
        return "Сегодня:" if days == 0 else _in_days(days)
    if offset_minutes == 0:
        return "Сейчас:"
    if offset_minutes % MINUTES_PER_DAY == 0:
        return _in_days(offset_minutes // MINUTES_PER_DAY)
    hours, minutes = divmod(offset_minutes, 60)
    if minutes == 0:
        if hours == 1:
            return "Через час:"
        return f"Через {hours} {plural(hours, 'час', 'часа', 'часов')}:"
    if hours == 0:
        return f"Через {minutes} {plural(minutes, 'минуту', 'минуты', 'минут')}:"
    return f"Через {hours} ч {minutes} мин:"


def format_reminder_text(
    kind: ReminderKind, task: Task, task_list: TaskList, offset_minutes: int = 0
) -> str:
    label = reminder_label(kind, offset_minutes, timed=task.due_time is not None)
    lines = [f"{label} {task.title}", f"Список: {task_list.name}"]

    if task.due_date is not None:
        lines.append(f"Срок: {format_due(task.due_date, task.due_time)}")

    if task.priority != "none":
        lines.append(f"Приоритет: {PRIORITY_LABELS[task.priority]}")

    return "\n".join(lines)


def reminder_task_url(public_url: str, task: Task) -> str:
    return f"{public_url.rstrip('/')}/tasks/list/{task.list_id}"


def _chains(task: Task, kind: ReminderKind, offset_minutes: int) -> bool:
    """Whether a resolved reminder of this kind/offset is followed by the same one for the
    task's next occurrence: the default due-moment reminder, or one of the task's own
    offsets that it still has."""
    if task.reminder_offsets is None:
        return kind == ReminderKind.occurrence
    return kind == ReminderKind.before and offset_minutes in task.reminder_offsets


async def schedule_next_occurrence_reminder(
    session: AsyncSession,
    task: Task,
    sent_occurrence_at: datetime,
    *,
    kind: ReminderKind = ReminderKind.occurrence,
    offset_minutes: int = 0,
    not_before: datetime | None = None,
) -> None:
    """After a recurring task's reminder is resolved (sent, or given up on), spec §8.4
    says the table should immediately hold the same reminder for the *next* occurrence —
    independent of whether the user ever completes/skips the current one (that path
    recomputes via recompute_reminders_for_task on its own, through the normal update
    flow). `not_before` (UTC) skips occurrences whose reminder time is already past, so a
    reminder missed during a long outage continues with the next *future* occurrence
    instead of walking through every missed one."""
    if not (_is_recurring(task) and task.rrule and task.dtstart_local):
        return
    if not task.reminders_enabled or not _chains(task, kind, offset_minutes):
        return

    user = await session.get(User, task.user_id)
    if user is None:
        return
    tz = ZoneInfo(user.timezone)

    before = timedelta(minutes=offset_minutes)
    after = sent_occurrence_at
    if not_before is not None:
        after = max(after, not_before.astimezone(tz).replace(tzinfo=None) + before)
    # sent_occurrence_at is itself an occurrence: expand from there, not from dtstart.
    next_occ = recurrence_service.next_occurrence(
        task.rrule, task.dtstart_local, after, anchor=sent_occurrence_at
    )
    if next_occ is None:
        return
    remind_at = _local_to_utc(next_occ, tz) - before

    existing_row = await session.scalar(
        select(ScheduledReminder).where(
            ScheduledReminder.task_id == task.id,
            ScheduledReminder.occurrence_at == next_occ,
            ScheduledReminder.kind == kind,
            ScheduledReminder.offset_minutes == offset_minutes,
        )
    )
    if existing_row is None:
        session.add(
            ScheduledReminder(
                task_id=task.id,
                occurrence_at=next_occ,
                remind_at=remind_at,
                kind=kind,
                offset_minutes=offset_minutes,
            )
        )


# Resolved reminders are only needed while their occurrence could still be re-desired;
# compute_desired_reminders never returns a remind_at in the past, so old history rows
# can go (the table otherwise grows forever).
RESOLVED_REMINDER_RETENTION = timedelta(days=30)


async def purge_resolved_reminders(session: AsyncSession, *, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    result = await session.execute(
        delete(ScheduledReminder).where(
            ScheduledReminder.status != ReminderStatus.pending,
            ScheduledReminder.remind_at < now - RESOLVED_REMINDER_RETENTION,
        )
    )
    await session.commit()
    return getattr(result, "rowcount", 0) or 0
