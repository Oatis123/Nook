"""The week's tasks as a Telegram message — the bot's /week and the worker's Monday
summary (spec §9). Calendar weeks, Monday to Sunday. The current one is shown from today
on: open tasks from its earlier days are overdue and listed as such. Done tasks are left
out. Each button carries its week's Monday, so old messages keep working after a restart."""

import html
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import structlog
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskPriority
from app.models.user import User
from app.services import tasks as tasks_service
from app.services.reminder_dispatch import ReminderBlocked
from app.services.telegram_format import MONTHS_SHORT, WEEKDAYS_SHORT, WEEKDAYS_TITLE, plural

log = structlog.get_logger()

MAX_WEEKS_AHEAD = 520  # ten years, as far as recurring tasks are expanded anyway
MAX_OVERDUE_SHOWN = 5
MAX_AGENDA_TITLE = 100
# Telegram allows 4096 characters; what doesn't fit becomes "…и ещё N задач".
MAX_WEEK_TEXT = 3800


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def local_today(user: User, now: datetime | None = None) -> date:
    now = now or datetime.now(UTC)
    try:
        return now.astimezone(ZoneInfo(user.timezone)).date()
    except Exception:
        return now.astimezone(UTC).date()


def _day_month(day: date) -> str:
    return f"{day.day} {MONTHS_SHORT[day.month - 1]}"


def _week_heading(monday: date, today: date) -> str:
    """'📅 Следующая неделя: 12–18 окт'"""
    sunday = monday + timedelta(days=6)
    if monday.year != sunday.year:
        dates = f"{_day_month(monday)} {monday.year} – {_day_month(sunday)} {sunday.year}"
    else:
        year = f" {monday.year}" if monday.year != today.year else ""
        if monday.month == sunday.month:
            dates = f"{monday.day}–{_day_month(sunday)}{year}"
        else:
            dates = f"{_day_month(monday)} – {_day_month(sunday)}{year}"
    weeks = (monday - week_start(today)).days // 7
    if weeks == 0:
        label = "Эта неделя"
    elif weeks == 1:
        label = "Следующая неделя"
    else:
        label = f"Через {weeks} {plural(weeks, 'неделю', 'недели', 'недель')}"
    return f"📅 <b>{label}: {dates}</b>"


def _agenda_line(task: Task, due_time: time | None, suffix: str = "") -> str:
    """'• ❗ 18:00 Встреча 🔁' — high priority, time, title, repeats."""
    title = " ".join(task.title.split())
    if len(title) > MAX_AGENDA_TITLE:
        title = title[:MAX_AGENDA_TITLE].rstrip() + "…"
    parts = ["•"]
    if task.priority == TaskPriority.high:
        parts.append("❗")
    if due_time is not None:
        parts.append(f"{due_time:%H:%M}")
    parts.append(html.escape(title))
    if task.is_recurring:
        parts.append("🔁")
    return " ".join(parts) + suffix


def week_text(
    monday: date,
    today: date,
    occurrences: list[tasks_service.Occurrence],
    overdue: list[Task],
) -> str:
    """The message (Telegram HTML): overdue tasks, then each day that has tasks."""
    sections: list[list[str]] = []
    if overdue:
        lines = ["⚠️ <b>Просрочено</b>"]
        for task in overdue[:MAX_OVERDUE_SHOWN]:
            assert task.due_date is not None
            day = task.due_date
            lines.append(
                _agenda_line(task, None, f" — {WEEKDAYS_SHORT[day.weekday()]}, {_day_month(day)}")
            )
        if len(overdue) > MAX_OVERDUE_SHOWN:
            more = len(overdue) - MAX_OVERDUE_SHOWN
            lines.append(f"…и ещё {more} {plural(more, 'задача', 'задачи', 'задач')}")
        sections.append(lines)

    by_day: dict[date, list[tasks_service.Occurrence]] = {}
    for occurrence in occurrences:
        by_day.setdefault(occurrence.date, []).append(occurrence)
    for day, items in sorted(by_day.items()):
        heading = f"<b>{WEEKDAYS_TITLE[day.weekday()]}, {_day_month(day)}</b>"
        if day == today:
            heading += " · сегодня"
        elif day == today + timedelta(days=1):
            heading += " · завтра"
        # Tasks without a time first, then by time.
        items.sort(key=lambda o: (o.time is not None, o.time or time(0), o.task.title.lower()))
        sections.append([heading, *(_agenda_line(o.task, o.time) for o in items)])

    if not by_day:
        sections.append(
            ["До конца недели задач нет." if monday == week_start(today) else "Задач нет."]
        )
    text = _week_heading(monday, today)
    full, left_out = False, 0
    for lines in sections:
        for index, line in enumerate(lines):
            separator = "\n\n" if index == 0 else "\n"
            full = full or len(text) + len(separator) + len(line) > MAX_WEEK_TEXT
            if not full:
                text += separator + line
            elif line.startswith("•"):  # a task, not a heading
                left_out += 1
    if left_out:
        text += f"\n\n…и ещё {left_out} {plural(left_out, 'задача', 'задачи', 'задач')}"
    return text


def _button(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


def week_keyboard(monday: date, today: date) -> InlineKeyboardMarkup:
    current = week_start(today)
    nav = []
    if monday > current:
        nav.append(_button("‹ Пред. неделя", f"wk:{monday - timedelta(weeks=1)}"))
    if monday < current + timedelta(weeks=MAX_WEEKS_AHEAD):
        nav.append(_button("След. неделя ›", f"wk:{monday + timedelta(weeks=1)}"))
    rows = [nav]
    if monday > current + timedelta(weeks=1):
        rows.append([_button("« Эта неделя", f"wk:{current}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def week_view(
    session: AsyncSession, user: User, monday: date, today: date
) -> tuple[str, InlineKeyboardMarkup]:
    """The message and buttons for the week starting `monday` — a week that has since
    passed (an old message's button) shows the current one."""
    current = week_start(today)
    monday = min(max(week_start(monday), current), current + timedelta(weeks=MAX_WEEKS_AHEAD))
    occurrences = await tasks_service.task_occurrences(
        session, user.id, max(monday, today), monday + timedelta(days=6), open_only=True
    )
    overdue = []
    if monday == current:
        overdue = await tasks_service.overdue_tasks(session, user.id, today)
    return week_text(monday, today, occurrences, overdue), week_keyboard(monday, today)


# --- The Monday summary ---------------------------------------------------------------

DigestSender = Callable[[int, str, InlineKeyboardMarkup], Awaitable[None]]


async def send_weekly_digests(
    session: AsyncSession, send: DigestSender, *, now: datetime | None = None
) -> int:
    """Sends this week's tasks to each user whose local time is Monday, at or past their
    daily reminder time, who hasn't had this Monday's summary yet. At most once a week:
    the user is marked before sending, so a failed send isn't repeated every tick (the
    worker's sender already retries network errors). Returns how many were sent."""
    now = now or datetime.now(UTC)
    candidates = (
        await session.execute(
            select(User.id, User.timezone, User.daily_reminder_time, User.weekly_digest_sent_on)
            .where(
                User.is_active.is_(True),
                User.weekly_digest_enabled.is_(True),
                User.notifications_enabled.is_(True),
                User.telegram_chat_id.is_not(None),
            )
            .order_by(User.id)
        )
    ).all()
    sent = 0
    for user_id, timezone, reminder_time, sent_on in candidates:
        try:
            local_now = now.astimezone(ZoneInfo(timezone))
        except Exception:
            local_now = now
        today = local_now.date()
        if today.weekday() != 0 or local_now.time() < reminder_time or sent_on == today:
            continue
        # Fetched one at a time (and locked): a failure's rollback below would otherwise
        # leave the other users' rows expired mid-loop.
        user = await session.get(User, user_id, with_for_update={"skip_locked": True})
        if user is None or user.telegram_chat_id is None or user.weekly_digest_sent_on == today:
            await session.rollback()
            continue
        user.weekly_digest_sent_on = today
        chat_id = user.telegram_chat_id
        await session.commit()
        try:
            text, keyboard = await week_view(session, user, today, today)
            await send(chat_id, text, keyboard)
            sent += 1
        except ReminderBlocked:
            user.telegram_blocked = True
            await session.commit()
        except Exception:
            log.exception("week_digest.send_failed", user_id=str(user_id))
            await session.rollback()
    return sent
