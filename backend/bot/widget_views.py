"""Small, paged views for the Telegram widget's 1024-byte state."""

import json
from datetime import date, time, timedelta
from typing import Any

from app.models.task import Task, TaskPriority
from app.models.task_list import TaskList
from app.models.user import User
from app.services import tasks, week_agenda
from app.services.telegram_format import MONTHS_SHORT, WEEKDAYS_SHORT

PAGE_SIZE = 4

HELP_ROWS = [
    ("/new", "Создать задачу"),
    ("/week", "Посмотреть задачи на неделю"),
    ("/lists", "Посмотреть задачи выбранного списка"),
    ("/cancel", "Отменить черновик"),
    ("/idea", "Записать идею"),
    ("/daily", "Сделать запись в дневнике"),
    ("/note", "Найти заметку"),
    ("/unlink", "Отвязать аккаунт"),
]


def short(text: str, budget: int) -> str:
    """Keep JSON-encoded text within a UTF-8 byte budget."""
    text = " ".join(text.split()).replace("\0", "")
    size = len(json.dumps(text, ensure_ascii=False).encode()) - 2
    if size <= budget:
        return text
    text = text.encode()[: budget - 3].decode(errors="ignore")
    while len(json.dumps(text, ensure_ascii=False).encode()) - 2 > budget - 3:
        text = text[:-1]
    return text.rstrip() + "…"


def ink(task_list: TaskList) -> int:
    return (int(task_list.color.value.removeprefix("palette-")) - 1) % 5 + 1


def card(
    title: str,
    *,
    detail: str = "",
    icon: str = "list",
    theme: str = "system",
    rows: list | None = None,
    buttons: list | None = None,
) -> dict[str, Any]:
    return {
        "title": title,
        "detail": detail,
        "icon": icon,
        "theme": theme,
        "rows": rows or [],
        "buttons": buttons or [],
    }


def page_window(total: int, requested: int) -> tuple[int, int, int]:
    last = max(0, (total - 1) // PAGE_SIZE)
    page = min(max(0, requested), last)
    return page, last, page * PAGE_SIZE


def list_card(lists: list[TaskList], user: User, requested: int) -> dict[str, Any]:
    page, last, start = page_window(len(lists), requested)
    buttons = []
    if page:
        buttons.append(["‹", f"l:{page - 1}"])
    if page < last:
        buttons.append(["›", f"l:{page + 1}"])
    detail = "Выберите список"
    if last:
        detail += f" · {page + 1}/{last + 1}"
    return card(
        "Ваши списки",
        detail=detail,
        theme=user.theme,
        rows=[
            [short(item.name, 140), "", ink(item), "", False, f"tl:{item.id.hex}"]
            for item in lists[start : start + PAGE_SIZE]
        ],
        buttons=buttons,
    )


def week_card(
    monday: date,
    today: date,
    occurrences: list[tasks.Occurrence],
    overdue: list[Task],
    lists: list[TaskList],
    user: User,
    requested: int,
) -> dict[str, Any]:
    items: list[tuple[date | None, time | None, Task, bool]] = [
        (task.due_date, None, task, True) for task in overdue
    ]
    items.extend(
        (item.date, item.time, item.task, False)
        for item in sorted(
            occurrences,
            key=lambda item: (item.date, item.time is not None, item.time, item.task.title.lower()),
        )
    )
    page, last, start = page_window(len(items), requested)
    by_id = {item.id: item for item in lists}
    rows = []
    for day, due_time, task, late in items[start : start + PAGE_SIZE]:
        assert day is not None
        day_label = f"{WEEKDAYS_SHORT[day.weekday()]} {day.day}"
        when = "Просрочено" if late else "Сегодня" if day == today else ""
        task_list = by_id.get(task.list_id)
        meta = [when, due_time.strftime("%H:%M") if due_time is not None else ""]
        if task_list is not None:
            meta.append(short(task_list.name, 34))
        title = f"{task.title} ↻" if task.is_recurring else task.title
        rows.append(
            [
                short(title, 72),
                " · ".join(filter(None, meta)),
                ink(task_list) if task_list is not None else 0,
                day_label,
                late or day == today or task.priority == TaskPriority.high,
            ]
        )
    current = week_agenda.week_start(today)
    sunday = monday + timedelta(days=6)
    begin = f"{monday.day} {MONTHS_SHORT[monday.month - 1]}"
    end = f"{sunday.day} {MONTHS_SHORT[sunday.month - 1]}"
    label = "Эта неделя" if monday == current else "Задачи на неделю"
    detail = f"{begin} – {end}" + (f" {sunday.year}" if sunday.year != today.year else "")
    if last:
        detail += f" · {page + 1}/{last + 1}"
    buttons = []
    if monday > current:
        buttons.append(["‹ Неделя", f"w:{monday - timedelta(weeks=1)}:0"])
    if monday < current + timedelta(weeks=week_agenda.MAX_WEEKS_AHEAD):
        buttons.append(["Неделя ›", f"w:{monday + timedelta(weeks=1)}:0"])
    if page:
        buttons.append(["‹ Задачи", f"w:{monday}:{page - 1}"])
    if page < last:
        buttons.append(["Задачи ›", f"w:{monday}:{page + 1}"])
    state = card(
        label,
        detail=detail,
        icon="calendar",
        theme=user.theme,
        rows=rows or [["На эту неделю задач нет."]],
        buttons=buttons,
    )
    state["monday"] = monday.isoformat()
    return state


def schedule(
    title: str,
    today: date,
    due_date: date | None,
    due_time: time | None,
    selected: TaskList,
    lists: list[TaskList],
    presets: list[time],
    user: User,
    requested: int,
    revision: int,
) -> dict[str, Any]:
    page, last, start = page_window(len(lists), requested)
    return {
        "title": "Новая задача",
        "detail": short(title, 135),
        "icon": "calendar",
        "theme": user.theme,
        "schedule": True,
        "revision": revision,
        "today": today.isoformat(),
        "date": due_date.isoformat() if due_date is not None else "",
        "time": due_time.strftime("%H%M") if due_time is not None else "",
        "selected": [selected.id.hex, short(selected.name, 62), ink(selected)],
        "lists": [
            [item.id.hex, short(item.name, 62), ink(item)]
            for item in lists[start : start + PAGE_SIZE]
        ],
        "page": page,
        "last": last,
        "times": [item.strftime("%H%M") for item in presets],
    }
