from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_reminder import ReminderKind, ReminderStatus, ScheduledReminder
from app.models.task import Task, TaskStatus
from app.models.task_list import TaskList
from app.models.user import User
from app.services import recurrence as recurrence_service

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

REMINDER_KIND_LABEL: dict[ReminderKind, str] = {
    ReminderKind.day_before: "Tomorrow:",
    ReminderKind.hour_before: "In 1 hour:",
    ReminderKind.occurrence: "Now:",
}

_PRIORITY_LABEL: dict[str, str] = {
    "none": "No priority",
    "low": "Low",
    "medium": "Medium",
    "high": "High",
}


def _local_to_utc(local_dt: datetime, tz: ZoneInfo) -> datetime:
    return local_dt.replace(tzinfo=tz).astimezone(UTC)


def compute_desired_reminders(
    task: Task, user: User, *, now: datetime | None = None
) -> list[tuple[datetime, datetime, ReminderKind]]:
    """The reminders `task` should have *right now*, per spec §8.2 — empty if the task is
    deleted, done, has reminders turned off, or has no due date. Entries whose remind_at
    would already be in the past are dropped (never returned), matching the "no catch-up
    messages at compute time" rule; `recompute_reminders_for_task` relies on that to also
    cancel a previously-scheduled reminder that a profile/task edit pushed into the past."""
    if task.deleted_at is not None or task.status == TaskStatus.done or not task.reminders_enabled:
        return []
    if task.due_date is None:
        return []

    now = now or datetime.now(UTC)
    tz = ZoneInfo(user.timezone)
    occurrence_at = datetime.combine(task.due_date, task.due_time or time(0, 0))

    results: list[tuple[datetime, datetime, ReminderKind]] = []

    if task.is_recurring and task.rrule and task.dtstart_local:
        remind_at = _local_to_utc(occurrence_at, tz)
        results.append((occurrence_at, remind_at, ReminderKind.occurrence))
    else:
        day_before_local = datetime.combine(
            task.due_date - timedelta(days=1), user.daily_reminder_time
        )
        results.append(
            (occurrence_at, _local_to_utc(day_before_local, tz), ReminderKind.day_before)
        )
        if task.due_time is not None:
            hour_before = _local_to_utc(occurrence_at, tz) - timedelta(hours=1)
            results.append((occurrence_at, hour_before, ReminderKind.hour_before))

    return [
        (occ, remind_at, kind)
        for occ, remind_at, kind in results
        if remind_at > now - PAST_REMINDER_GRACE
    ]


async def recompute_reminders_for_task(
    session: AsyncSession, task: Task, *, now: datetime | None = None
) -> None:
    """Reconciles `scheduled_reminders` for one task against what it should have right now
    (spec §8.2/§8.4). Called after any task mutation that could affect its reminders —
    due date/time, recurrence, reminders_enabled, status, or soft-delete — so every call
    site just calls this unconditionally rather than tracking which fields changed."""
    now = now or datetime.now(UTC)
    user = await session.get(User, task.user_id)
    assert user is not None

    desired = compute_desired_reminders(task, user, now=now)
    desired_by_key = {(occ, kind): remind_at for occ, remind_at, kind in desired}

    # The unique (task_id, occurrence_at, kind) index spans every status, not just
    # pending — a previously cancelled/sent/failed row for the same key still occupies
    # that slot, so it must be looked up (and possibly reused) rather than re-inserted.
    existing = list(
        await session.scalars(select(ScheduledReminder).where(ScheduledReminder.task_id == task.id))
    )
    existing_by_key = {(r.occurrence_at, r.kind): r for r in existing}

    for key, row in existing_by_key.items():
        if row.status == ReminderStatus.pending and key not in desired_by_key:
            row.status = ReminderStatus.cancelled

    for (occurrence_at, kind), remind_at in desired_by_key.items():
        existing_row = existing_by_key.get((occurrence_at, kind))
        if existing_row is None:
            session.add(
                ScheduledReminder(
                    task_id=task.id, occurrence_at=occurrence_at, remind_at=remind_at, kind=kind
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


def format_reminder_text(kind: ReminderKind, task: Task, task_list: TaskList) -> str:
    lines = [f"{REMINDER_KIND_LABEL[kind]} {task.title}", f"List: {task_list.name}"]

    if task.due_date is not None:
        due = f"Due: {task.due_date:%b %d, %Y}"
        if task.due_time is not None:
            due += f", {task.due_time:%I:%M %p}".replace(" 0", " ")
        lines.append(due)

    if task.priority != "none":
        lines.append(f"Priority: {_PRIORITY_LABEL[task.priority]}")

    return "\n".join(lines)


def reminder_task_url(public_url: str, task: Task) -> str:
    return f"{public_url.rstrip('/')}/tasks/list/{task.list_id}"


async def schedule_next_occurrence_reminder(
    session: AsyncSession,
    task: Task,
    sent_occurrence_at: datetime,
    *,
    not_before: datetime | None = None,
) -> None:
    """After a recurring task's "occurrence" reminder is resolved (sent, or given up on),
    spec §8.4 says the table should immediately hold the *next* occurrence's reminder —
    independent of whether the user ever completes/skips the current one (that path
    recomputes via recompute_reminders_for_task on its own, through the normal update
    flow). `not_before` (UTC) skips occurrences already in the past, so a reminder
    missed during a long outage continues with the next *future* occurrence instead of
    walking through every missed one."""
    if not (task.is_recurring and task.rrule and task.dtstart_local):
        return

    user = await session.get(User, task.user_id)
    if user is None:
        return
    tz = ZoneInfo(user.timezone)

    after = sent_occurrence_at
    if not_before is not None:
        after = max(after, not_before.astimezone(tz).replace(tzinfo=None))
    # sent_occurrence_at is itself an occurrence: expand from there, not from dtstart.
    next_occ = recurrence_service.next_occurrence(
        task.rrule, task.dtstart_local, after, anchor=sent_occurrence_at
    )
    if next_occ is None:
        return
    remind_at = _local_to_utc(next_occ, tz)

    existing_row = await session.scalar(
        select(ScheduledReminder).where(
            ScheduledReminder.task_id == task.id,
            ScheduledReminder.occurrence_at == next_occ,
            ScheduledReminder.kind == ReminderKind.occurrence,
        )
    )
    if existing_row is None:
        session.add(
            ScheduledReminder(
                task_id=task.id,
                occurrence_at=next_occ,
                remind_at=remind_at,
                kind=ReminderKind.occurrence,
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
