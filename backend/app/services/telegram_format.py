"""Russian wording for Telegram messages — the bot and the worker's reminders (spec §9).
The web app itself stays English-only (spec §0); this module is only for what goes out
through Telegram. Month and weekday names are spelled out here rather than taken from
the OS locale, so the output doesn't depend on which locales the container has."""

from datetime import date, time
from urllib.parse import urlparse

from app.models.task import TaskPriority

WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
WEEKDAYS_TITLE = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
# Genitive ("3 окт", "12 мая"): the form used after a day number.
MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
MONTHS = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
]

PRIORITY_LABELS: dict[TaskPriority, str] = {
    TaskPriority.none: "без приоритета",
    TaskPriority.low: "низкий",
    TaskPriority.medium: "средний",
    TaskPriority.high: "высокий",
}


def button_url_accepted(url: str) -> bool:
    """Telegram rejects inline-button URLs whose host is a single label ("localhost",
    "mypc") with 400 "Wrong HTTP URL", while IPs and dotted names (127.0.0.1, 192.168.x.x,
    nook.local) pass — so a local-only install on the default PUBLIC_URL=http://localhost:8080
    must send its messages without an Open button, or every one of them fails outright."""
    host = urlparse(url).hostname
    return host is not None and "." in host


def plural(count: int, one: str, few: str, many: str) -> str:
    """The noun form that goes with `count`: plural(1, "задача", "задачи", "задач")."""
    if count % 10 == 1 and count % 100 != 11:
        return one
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return few
    return many


def format_day(day: date) -> str:
    """'пт, 3 окт 2026'"""
    return f"{WEEKDAYS_SHORT[day.weekday()]}, {day.day} {MONTHS_SHORT[day.month - 1]} {day.year}"


def format_due(due_date: date, due_time: time | None) -> str:
    """'пт, 3 окт 2026, 18:00' — 24-hour time, as is usual in Russian."""
    text = format_day(due_date)
    if due_time is not None:
        text += f", {due_time:%H:%M}"
    return text
