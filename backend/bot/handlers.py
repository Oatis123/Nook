import base64
import calendar
import contextlib
import re
import time as monotonic_clock
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import dateparser
import structlog
from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    CallbackQuery,
    ErrorEvent,
    InaccessibleMessage,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.models.task import Task, TaskPriority
from app.models.task_list import TaskList
from app.models.user import User
from app.schemas.task import TaskCreate, TaskUpdate
from app.services import admin as admin_service
from app.services import ideas as ideas_service
from app.services import task_lists as task_lists_service
from app.services import tasks as tasks_service
from app.services import telegram_link as telegram_link_service
from app.services import week_agenda
from app.services.telegram_format import (
    MONTHS,
    PRIORITY_LABELS,
    WEEKDAYS_TITLE,
    format_day,
    format_due,
)
from app.services.week_agenda import week_start

router = Router()
settings = get_settings()
log = structlog.get_logger()

NOT_LINKED_TEXT = (
    "Этот бот работает только с привязанным аккаунтом.\n"
    f"Откройте {settings.public_url} и подключите Telegram в настройках."
)


@router.message(CommandStart(deep_link=True))
async def handle_start_deep_link(message: Message, command: CommandObject) -> None:
    if message.from_user is None:
        return
    payload = command.args or ""
    if payload.startswith("link_"):
        await _handle_link(message, message.from_user.id, payload.removeprefix("link_"))
    elif payload.startswith("login_"):
        await _handle_login(message, message.from_user.id, payload.removeprefix("login_"))
    else:
        await message.answer(f"Добро пожаловать в {settings.app_name}.\n\n{NOT_LINKED_TEXT}")


@router.message(CommandStart())
async def handle_start_plain(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(f"Добро пожаловать в {settings.app_name}.\n\n{NOT_LINKED_TEXT}")
    else:
        await message.answer(
            f"С возвращением, {user.username}.\n\n"
            "Чтобы создать задачу, просто напишите её текст. Задачи на неделю — /week, "
            "справка — /help."
        )


async def _handle_link(message: Message, telegram_user_id: int, plain_token: str) -> None:
    async with async_session_factory() as session:
        previous_chat_id = await telegram_link_service.chat_linked_before(session, plain_token)
        user = await telegram_link_service.consume_link_token(
            session, plain_token, telegram_user_id, message.chat.id
        )
    if user is None:
        await message.answer(
            "Ссылка недействительна или устарела, либо этот Telegram уже привязан "
            "к другому аккаунту."
        )
        return
    log.info("bot.telegram_linked", user_id=str(user.id))
    await message.answer(f"Telegram привязан к {settings.app_name} как «{user.username}».")
    if previous_chat_id is not None and previous_chat_id != message.chat.id:
        # The account moved to another Telegram: tell the old one, which can no longer
        # log in with Telegram — if that wasn't its owner's doing, they need to know.
        try:
            await message.bot.send_message(  # type: ignore[union-attr]
                previous_chat_id,
                f"Ваш аккаунт {settings.app_name} «{user.username}» только что привязали "
                "к другому Telegram, поэтому сюда больше не будут приходить напоминания и "
                "запросы на вход. Если это были не вы, смените пароль и заново подключите "
                "Telegram в настройках.",
            )
        except Exception:
            log.warning("bot.relink_notice_failed", user_id=str(user.id))


async def _handle_login(message: Message, telegram_user_id: int, plain_token: str) -> None:
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, telegram_user_id)
        if user is None:
            await message.answer(NOT_LINKED_TEXT)
            return

        token = await telegram_link_service.find_login_token_by_plain(session, plain_token)
        if token is None or token.used_at is not None:
            await message.answer("Ссылка для входа недействительна или устарела.")
            return

        await telegram_link_service.attach_login_requester(session, token, user.id)
        meta = token.meta or {}
        token_id = token.id

    device = meta.get("user_agent") or "неизвестное устройство"
    ip = meta.get("ip") or "неизвестный адрес"
    code = meta.get("code")
    if code:
        # The user must pick the code their browser shows; see new_confirm_code().
        choices = telegram_link_service.confirm_code_choices(code)
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text=c, callback_data=f"tglogin:code:{token_id}:{c}")
                    for c in choices
                ],
                [InlineKeyboardButton(text="Отклонить", callback_data=f"tglogin:deny:{token_id}")],
            ]
        )
        prompt = (
            "Чтобы подтвердить, нажмите код, который показан в браузере. Если вы не начинали "
            "этот вход сами только что — например, кто-то прислал вам эту ссылку, — "
            "нажмите «Отклонить»."
        )
    else:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="Подтвердить вход", callback_data=f"tglogin:confirm:{token_id}"
                    ),
                    InlineKeyboardButton(
                        text="Отклонить", callback_data=f"tglogin:deny:{token_id}"
                    ),
                ]
            ]
        )
        prompt = (
            "Подтверждайте, только если вы сами начали этот вход только что. Если кто-то "
            "прислал вам эту ссылку, нажмите «Отклонить» — подтверждение даст ему доступ "
            "к вашему аккаунту."
        )
    await message.answer(
        f"Кто-то входит в {settings.app_name} как «{user.username}»:\n{device}\n{ip}\n\n{prompt}",
        reply_markup=keyboard,
    )


@router.callback_query(F.data.startswith("tglogin:"))
async def handle_login_callback(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.message is None
        or isinstance(callback.message, InaccessibleMessage)
        or callback.from_user is None
    ):
        return
    parts = callback.data.split(":")
    action = parts[1] if len(parts) > 1 else ""
    picked_code = parts[3] if action == "code" and len(parts) > 3 else None
    try:
        token_id = uuid.UUID(parts[2])
    except (ValueError, IndexError):
        await callback.answer("Этот запрос больше недействителен.", show_alert=True)
        return

    async with async_session_factory() as session:
        token = await telegram_link_service.find_login_token_by_id(session, token_id)
        if token is None or token.user_id is None:
            await callback.answer("Этот запрос больше недействителен.", show_alert=True)
            return

        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None or user.id != token.user_id:
            await callback.answer("Это не ваш запрос на вход.", show_alert=True)
            return

        expected_code = (token.meta or {}).get("code")
        if expected_code:
            # Code-protected login: only picking the right code confirms it.
            confirmed = action == "code" and picked_code == expected_code
        else:
            confirmed = action == "confirm"
        await telegram_link_service.set_login_status(
            session, token, "confirmed" if confirmed else "denied"
        )
        log.info("bot.telegram_login_answered", user_id=str(user.id), confirmed=confirmed)

    if confirmed:
        text = "Вход подтверждён. Можно вернуться в браузер."
    elif action == "code":
        text = (
            "Код не совпадает, поэтому вход отклонён. Если вы не начинали этот вход, "
            "возможно, кто-то пытается попасть в ваш аккаунт — смените пароль."
        )
    else:
        text = "Вход отклонён."
    await callback.message.edit_text(text)
    await callback.answer()


@router.message(Command("help"))
async def handle_help(message: Message) -> None:
    await message.answer(
        "Чтобы создать задачу, просто напишите её текст — бот спросит описание, дату и "
        "время. Задачи из бота получают средний приоритет.\n\n"
        "/new <текст> — то же самое\n"
        "/idea <текст> — записать идею в заметку «Идеи» (или кнопка «💡 Это идея» "
        "после текста)\n"
        "/cancel — отменить создание задачи\n"
        "/week — задачи на эту неделю; кнопками можно листать дальше, а /week 2 "
        "или /week 20.10 сразу откроет нужную неделю\n"
        "/lists — ваши списки\n"
        "/help — эта справка\n"
        "/unlink — отвязать Telegram от аккаунта"
    )


@router.message(Command("lists"))
async def handle_lists(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
        if user is None:
            await message.answer(NOT_LINKED_TEXT)
            return
        lists = await task_lists_service.list_task_lists(session, user.id)

    if not lists:
        await message.answer("У вас пока нет списков.")
        return
    await message.answer("Ваши списки:\n" + "\n".join(f"• {task_list.name}" for task_list in lists))


# --- New task: text → description → date → time -------------------------------------
#
# The task's text arrives as a plain message; the bot then asks for an optional
# description, a date (buttons, a month calendar, or typed) and a time (buttons or typed),
# and creates the task with medium priority. The draft lives in memory, keyed by Telegram
# user id: a bot restart mid-conversation just drops it, which the user notices right away.

DRAFT_TTL_SECONDS = 30 * 60
TIME_PRESETS = [time(9, 0), time(12, 0), time(18, 0)]
BOT_TASK_PRIORITY = TaskPriority.medium
MAX_TITLE_LENGTH = 500  # TaskCreate.title's limit

Step = Literal["description", "date", "time", "idea"]


@dataclass
class _Draft:
    title: str
    step: Step = "description"
    description: str | None = None
    due_date: date | None = None
    # The message whose buttons drive the current step: its keyboard is removed when the
    # step is answered by typing instead, so stale buttons don't linger in the chat.
    prompt: Message | None = None
    started: float = field(default_factory=lambda: monotonic_clock.monotonic())


_drafts: dict[int, _Draft] = {}


def _get_draft(telegram_user_id: int) -> _Draft | None:
    """The user's draft, unless it was abandoned long enough ago that their next message
    is far more likely a new task than the answer to an old question."""
    draft = _drafts.get(telegram_user_id)
    if draft is not None and monotonic_clock.monotonic() - draft.started > DRAFT_TTL_SECONDS:
        del _drafts[telegram_user_id]
        return None
    return draft


def _local_now(user: User) -> datetime:
    return datetime.now(ZoneInfo(user.timezone)).replace(tzinfo=None)


def _button(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


CANCEL_BUTTON = _button("Отмена", "nt:cancel")

DESCRIPTION_PROMPT = (
    "📝 Добавить описание?\nНапишите его следующим сообщением или нажмите «Пропустить»."
)
DESCRIPTION_KEYBOARD = InlineKeyboardMarkup(
    inline_keyboard=[
        [_button("Пропустить", "nt:skip"), _button("💡 Это идея", "nt:idea")],
        [CANCEL_BUTTON],
    ]
)

DATE_PROMPT = "📅 Когда?\nВыберите день или напишите его, например «пятница» или «12.10»."
DATE_KEYBOARD = InlineKeyboardMarkup(
    inline_keyboard=[
        [_button("Сегодня", "nt:today"), _button("Завтра", "nt:tomorrow")],
        [_button("📆 Выбрать дату", "nt:calendar"), _button("Без срока", "nt:nodate")],
        [CANCEL_BUTTON],
    ]
)

_DAY_MONTH_RE = re.compile(r"^\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\s*$")
_TIME_RE = re.compile(r"^\s*(?:в\s+)?(\d{1,2})(?:\s*[:.\s]\s*(\d{2}))?\s*$")


def parse_day(text: str, today: date) -> date | None:
    """A typed date: "12.10", "12.10.2027", or words dateparser understands ("завтра",
    "в пятницу", "12 октября"). DD.MM is handled here because dateparser reads "12.10" as
    the time 12:10. A day-and-month already past this year means next year's."""
    match = _DAY_MONTH_RE.match(text)
    if match:
        day, month, year_raw = match.groups()
        if year_raw is None:
            year = today.year
        elif len(year_raw) == 2:
            year = 2000 + int(year_raw)  # "12.10.27"
        else:
            year = int(year_raw)
        try:
            parsed = date(year, int(month), int(day))
        except ValueError:
            return None
        if year_raw is None and parsed < today:
            with contextlib.suppress(ValueError):
                parsed = parsed.replace(year=today.year + 1)
        return parsed

    parsed_dt = dateparser.parse(
        text,
        languages=["ru", "en"],
        settings={
            "RELATIVE_BASE": datetime.combine(today, time(12, 0)),
            "PREFER_DATES_FROM": "future",
            "DATE_ORDER": "DMY",
            "RETURN_AS_TIMEZONE_AWARE": False,
        },
    )
    return parsed_dt.date() if parsed_dt is not None else None


def parse_time(text: str) -> time | None:
    """A typed time: "19:30", "19.30", "19 30", "9", "в 9"."""
    match = _TIME_RE.match(text)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2) or 0)
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def _calendar_keyboard(year: int, month: int, today: date) -> InlineKeyboardMarkup:
    """A month grid: days before today can't be picked; ‹ › page through months."""
    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    next_year, next_month = (year, month + 1) if month < 12 else (year + 1, 1)
    can_go_back = (year, month) > (today.year, today.month)
    rows = [
        [
            _button("‹", f"nt:cal:{prev_year}-{prev_month:02d}")
            if can_go_back
            else _button(" ", "nt:noop"),
            _button(f"{MONTHS[month - 1]} {year}", "nt:noop"),
            _button("›", f"nt:cal:{next_year}-{next_month:02d}"),
        ],
        [_button(name, "nt:noop") for name in WEEKDAYS_TITLE],
    ]
    for week in calendar.monthcalendar(year, month):
        row = []
        for day in week:
            if day == 0:
                row.append(_button(" ", "nt:noop"))
                continue
            current = date(year, month, day)
            if current < today:
                row.append(_button("·", "nt:noop"))
            else:
                label = f"•{day}•" if current == today else str(day)
                row.append(_button(label, f"nt:day:{current.isoformat()}"))
        rows.append(row)
    rows.append([_button("« Назад", "nt:back"), CANCEL_BUTTON])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _time_prompt(draft: _Draft) -> str:
    assert draft.due_date is not None
    return (
        f"🕒 Во сколько? ({format_day(draft.due_date)})\n"
        "Выберите время или напишите его, например «19:30»."
    )


def _time_keyboard(draft: _Draft, now: datetime) -> InlineKeyboardMarkup:
    # For today, only times still ahead are offered.
    presets = [
        preset
        for preset in TIME_PRESETS
        if draft.due_date != now.date() or datetime.combine(now.date(), preset) > now
    ]
    rows = []
    if presets:
        rows.append([_button(f"{preset:%H:%M}", f"nt:time:{preset:%H%M}") for preset in presets])
    rows.append([_button("Без времени", "nt:notime"), CANCEL_BUTTON])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _summary_text(task: Task, list_name: str) -> str:
    lines = [f"✅ Задача создана: {task.title}", f"Список: {list_name}"]
    if task.due_date is not None:
        lines.append(f"Срок: {format_due(task.due_date, task.due_time)}")
    else:
        lines.append("Срок: без срока")
    lines.append(f"Приоритет: {PRIORITY_LABELS[task.priority]}")
    if task.description:
        description = task.description
        if len(description) > 300:
            description = description[:300].rstrip() + "…"
        lines.append(f"Описание: {description}")
    return "\n".join(lines)


def _result_keyboard(task_id: uuid.UUID) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                _button("Сменить список", f"qa:list:{task_id}"),
                _button("Удалить", f"qa:undo:{task_id}"),
            ]
        ]
    )


async def _linked_user(telegram_user_id: int) -> User | None:
    async with async_session_factory() as session:
        return await telegram_link_service.get_user_by_telegram_id(session, telegram_user_id)


async def _drop_prompt_buttons(draft: _Draft) -> None:
    """The step was answered by typing: take the buttons off the previous prompt."""
    if draft.prompt is not None:
        with contextlib.suppress(Exception):
            await draft.prompt.edit_reply_markup(reply_markup=None)


async def _prompt_by_reply(
    message: Message, draft: _Draft, text: str, keyboard: InlineKeyboardMarkup
) -> None:
    await _drop_prompt_buttons(draft)
    draft.prompt = await message.answer(text, reply_markup=keyboard)


async def _prompt_by_edit(
    callback_message: Message, draft: _Draft, text: str, keyboard: InlineKeyboardMarkup
) -> None:
    await callback_message.edit_text(text, reply_markup=keyboard)
    draft.prompt = callback_message


async def _start_draft(message: Message, telegram_user_id: int, text: str) -> None:
    title = text.strip()
    if not title:
        await message.answer("Напишите текст задачи.")
        return
    if len(title) > MAX_TITLE_LENGTH:
        await message.answer(
            f"Слишком длинно для названия задачи — максимум {MAX_TITLE_LENGTH} символов. "
            "Подробности можно будет добавить в описание на следующем шаге."
        )
        return
    draft = _Draft(title=title)
    _drafts[telegram_user_id] = draft
    draft.prompt = await message.answer(DESCRIPTION_PROMPT, reply_markup=DESCRIPTION_KEYBOARD)


async def _create_task(user: User, draft: _Draft, due_time: time | None) -> tuple[Task, str]:
    async with async_session_factory() as session:
        task = await tasks_service.create_task(
            session,
            user.id,
            TaskCreate(
                title=draft.title,
                description=draft.description,
                priority=BOT_TASK_PRIORITY,
                due_date=draft.due_date,
                due_time=due_time if draft.due_date is not None else None,
            ),
        )
        task_list = await session.get(TaskList, task.list_id)
    return task, task_list.name if task_list is not None else "Inbox"


async def _finish(
    telegram_user_id: int,
    user: User,
    draft: _Draft,
    due_time: time | None,
    *,
    reply_to: Message | None = None,
    edit: Message | None = None,
) -> None:
    """Creates the task and shows its summary — by editing the prompt when a button
    finished the draft, or as a new message when it was typed."""
    try:
        task, list_name = await _create_task(user, draft, due_time)
    except (ValidationError, HTTPException):
        log.warning("bot.task_create_failed", user_id=str(user.id))
        text = "Не получилось создать задачу. Попробуйте ещё раз."
        _drafts.pop(telegram_user_id, None)
        if edit is not None:
            await edit.edit_text(text)
        elif reply_to is not None:
            await _drop_prompt_buttons(draft)
            await reply_to.answer(text)
        return

    _drafts.pop(telegram_user_id, None)
    summary, keyboard = _summary_text(task, list_name), _result_keyboard(task.id)
    if edit is not None:
        await edit.edit_text(summary, reply_markup=keyboard)
    elif reply_to is not None:
        await _drop_prompt_buttons(draft)
        await reply_to.answer(summary, reply_markup=keyboard)


async def _answer_typed_step(message: Message, user: User, draft: _Draft, text: str) -> None:
    assert message.from_user is not None
    if draft.step == "idea":
        _drafts.pop(message.from_user.id, None)
        await _drop_prompt_buttons(draft)
        await _save_idea_and_reply(message, message.from_user.id, user, text)
    elif draft.step == "description":
        draft.description = text.strip() or None
        draft.step = "date"
        await _prompt_by_reply(message, draft, DATE_PROMPT, DATE_KEYBOARD)
    elif draft.step == "date":
        now = _local_now(user)
        day = parse_day(text, now.date())
        if day is None:
            await message.answer(
                "Не понял дату. Выберите её кнопкой или напишите, например, «завтра», "
                "«в пятницу» или «12.10»."
            )
            return
        draft.due_date = day
        draft.step = "time"
        await _prompt_by_reply(message, draft, _time_prompt(draft), _time_keyboard(draft, now))
    else:
        parsed = parse_time(text)
        if parsed is None:
            await message.answer(
                "Не понял время. Выберите его кнопкой или напишите, например, «19:30»."
            )
            return
        await _finish(message.from_user.id, user, draft, parsed, reply_to=message)


@router.message(Command("new"))
async def handle_new_command(message: Message, command: CommandObject) -> None:
    if message.from_user is None:
        return
    if await _linked_user(message.from_user.id) is None:
        await message.answer(NOT_LINKED_TEXT)
        return
    text = (command.args or "").strip()
    if not text:
        await message.answer("Напишите текст задачи одним сообщением.")
        return
    old = _drafts.pop(message.from_user.id, None)
    if old is not None:
        await _drop_prompt_buttons(old)
    await _start_draft(message, message.from_user.id, text)


@router.message(Command("cancel"))
async def handle_cancel_command(message: Message) -> None:
    if message.from_user is None:
        return
    draft = _drafts.pop(message.from_user.id, None)
    if draft is None:
        await message.answer("Сейчас нечего отменять.")
        return
    await _drop_prompt_buttons(draft)
    await message.answer("Создание задачи отменено.")


@router.callback_query(F.data.startswith("nt:"))
async def handle_new_task_callback(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.from_user is None
        or not isinstance(callback.message, Message)
    ):
        return
    action, _, arg = callback.data.removeprefix("nt:").partition(":")
    if action == "noop":
        await callback.answer()
        return

    telegram_user_id = callback.from_user.id
    draft = _get_draft(telegram_user_id)
    if (
        draft is None
        or draft.prompt is None
        or draft.prompt.message_id != callback.message.message_id
    ):
        await callback.answer("Эта задача уже создана или отменена.", show_alert=True)
        with contextlib.suppress(Exception):
            await callback.message.edit_reply_markup(reply_markup=None)
        return

    if action == "cancel":
        _drafts.pop(telegram_user_id, None)
        await callback.message.edit_text(
            "Отменено." if draft.step == "idea" else "Создание задачи отменено."
        )
        await callback.answer()
        return

    user = await _linked_user(telegram_user_id)
    if user is None:
        _drafts.pop(telegram_user_id, None)
        await callback.answer()
        return
    now = _local_now(user)

    if draft.step == "description" and action == "idea":
        _drafts.pop(telegram_user_id, None)
        block = await _save_idea(user, draft.title)
        await callback.message.edit_text(
            _idea_saved_text(draft.title), reply_markup=IDEA_UNDO_KEYBOARD
        )
        _remember_idea(telegram_user_id, callback.message.message_id, block)
    elif draft.step == "description" and action == "skip":
        draft.step = "date"
        await _prompt_by_edit(callback.message, draft, DATE_PROMPT, DATE_KEYBOARD)
    elif draft.step == "date" and action in ("today", "tomorrow", "day"):
        if action == "day":
            try:
                draft.due_date = date.fromisoformat(arg)
            except ValueError:
                await callback.answer()
                return
        else:
            draft.due_date = now.date() + timedelta(days=1 if action == "tomorrow" else 0)
        draft.step = "time"
        await _prompt_by_edit(
            callback.message, draft, _time_prompt(draft), _time_keyboard(draft, now)
        )
    elif draft.step == "date" and action in ("calendar", "cal"):
        year, month = now.year, now.month
        if action == "cal":
            try:
                year, month = (int(part) for part in arg.split("-"))
            except ValueError:
                await callback.answer()
                return
        await _prompt_by_edit(
            callback.message,
            draft,
            "📆 Выберите дату:",
            _calendar_keyboard(year, month, now.date()),
        )
    elif draft.step == "date" and action == "back":
        await _prompt_by_edit(callback.message, draft, DATE_PROMPT, DATE_KEYBOARD)
    elif draft.step == "date" and action == "nodate":
        await _finish(telegram_user_id, user, draft, None, edit=callback.message)
    elif draft.step == "time" and action in ("time", "notime"):
        chosen = time(int(arg[:2]), int(arg[2:])) if action == "time" else None
        await _finish(telegram_user_id, user, draft, chosen, edit=callback.message)
    await callback.answer()


def _short_id(value: uuid.UUID) -> str:
    """A UUID in 22 characters instead of 36. Telegram rejects a keyboard whose
    callback_data exceeds 64 bytes (BUTTON_DATA_INVALID), and the list picker's buttons
    carry two ids — written out in full they took 84 bytes, so the picker never appeared."""
    return base64.urlsafe_b64encode(value.bytes).rstrip(b"=").decode()


def _from_short_id(value: str) -> uuid.UUID:
    return uuid.UUID(bytes=base64.urlsafe_b64decode(value + "=="))


# --- Quick ideas: appended to the user's Ideas note (app/services/ideas.py) ------------

IDEA_PROMPT = "💡 Напишите идею одним сообщением."
IDEA_PROMPT_KEYBOARD = InlineKeyboardMarkup(inline_keyboard=[[CANCEL_BUTTON]])
IDEA_UNDO_KEYBOARD = InlineKeyboardMarkup(inline_keyboard=[[_button("Отменить", "idea:undo")]])
MAX_UNDOABLE_IDEAS = 200

# (Telegram user id, confirmation message id) -> the block appended, for its Undo button.
# In memory like drafts: after a bot restart, undoing means editing the note itself.
_idea_blocks: dict[tuple[int, int], str] = {}


def _idea_saved_text(text: str) -> str:
    shown = text.strip()
    if len(shown) > 300:
        shown = shown[:300].rstrip() + "…"
    return f"💡 Записал в «Идеи»:\n{shown}"


async def _save_idea(user: User, text: str) -> str:
    async with async_session_factory() as session:
        return await ideas_service.append_idea(session, user.id, text, _local_now(user))


def _remember_idea(telegram_user_id: int, message_id: int, block: str) -> None:
    _idea_blocks[(telegram_user_id, message_id)] = block
    while len(_idea_blocks) > MAX_UNDOABLE_IDEAS:
        del _idea_blocks[next(iter(_idea_blocks))]


async def _save_idea_and_reply(
    message: Message, telegram_user_id: int, user: User, text: str
) -> None:
    block = await _save_idea(user, text)
    sent = await message.answer(_idea_saved_text(text), reply_markup=IDEA_UNDO_KEYBOARD)
    _remember_idea(telegram_user_id, sent.message_id, block)


@router.message(Command("idea"))
async def handle_idea_command(message: Message, command: CommandObject) -> None:
    if message.from_user is None:
        return
    user = await _linked_user(message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return
    old = _drafts.pop(message.from_user.id, None)
    if old is not None:
        await _drop_prompt_buttons(old)
    text = (command.args or "").strip()
    if text:
        await _save_idea_and_reply(message, message.from_user.id, user, text)
        return
    # "/idea" alone: the next message is the idea.
    draft = _Draft(title="", step="idea")
    _drafts[message.from_user.id] = draft
    draft.prompt = await message.answer(IDEA_PROMPT, reply_markup=IDEA_PROMPT_KEYBOARD)


@router.callback_query(F.data == "idea:undo")
async def handle_idea_undo(callback: CallbackQuery) -> None:
    if callback.from_user is None or not isinstance(callback.message, Message):
        return
    key = (callback.from_user.id, callback.message.message_id)
    block = _idea_blocks.get(key)
    user = await _linked_user(callback.from_user.id) if block is not None else None
    if block is None or user is None:
        await callback.answer(
            "Отменить отсюда уже не получится — удалите идею в заметке «Идеи».", show_alert=True
        )
        return
    async with async_session_factory() as session:
        removed = await ideas_service.remove_idea(session, user.id, block)
    _idea_blocks.pop(key, None)
    if removed:
        await callback.message.edit_text("Идея удалена.")
        await callback.answer()
    else:
        await callback.message.edit_reply_markup(reply_markup=None)
        await callback.answer(
            "Не нашёл эту идею в заметке — похоже, её уже изменили.", show_alert=True
        )


@router.callback_query(F.data.startswith("qa:list:"))
async def handle_change_list(callback: CallbackQuery) -> None:
    if callback.data is None or callback.from_user is None:
        return
    _, _, task_id_raw = callback.data.split(":", 2)
    try:
        task_id = uuid.UUID(task_id_raw)
    except ValueError:
        await callback.answer("Эта кнопка больше не работает.", show_alert=True)
        return

    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None:
            await callback.answer()
            return
        lists = await task_lists_service.list_task_lists(session, user.id)

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                _button(
                    task_list.name,
                    f"qa:setlist:{_short_id(task_id)}:{_short_id(task_list.id)}",
                )
            ]
            for task_list in lists
        ]
        # Keeping the list is a choice too: back to the summary's own buttons.
        + [[_button("« Назад", f"qa:back:{task_id}")]]
    )
    if isinstance(callback.message, Message):
        await callback.message.edit_reply_markup(reply_markup=keyboard)
    await callback.answer()


@router.callback_query(F.data.startswith("qa:back:"))
async def handle_list_picker_back(callback: CallbackQuery) -> None:
    if callback.data is None or not isinstance(callback.message, Message):
        return
    try:
        task_id = uuid.UUID(callback.data.removeprefix("qa:back:"))
    except ValueError:
        await callback.answer()
        return
    await callback.message.edit_reply_markup(reply_markup=_result_keyboard(task_id))
    await callback.answer()


@router.callback_query(F.data.startswith("qa:setlist:"))
async def handle_set_list(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.from_user is None
        or callback.message is None
        or isinstance(callback.message, InaccessibleMessage)
    ):
        return
    try:
        _, _, task_id_raw, list_id_raw = callback.data.split(":", 3)
        task_id, list_id = _from_short_id(task_id_raw), _from_short_id(list_id_raw)
    except ValueError:
        await callback.answer("Эта кнопка больше не работает.", show_alert=True)
        return

    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None:
            await callback.answer()
            return
        try:
            task = await tasks_service.update_task(
                session, user.id, task_id, TaskUpdate(list_id=list_id)
            )
        except HTTPException:
            await callback.answer("Задача не найдена.", show_alert=True)
            return
        task_list = await session.get(TaskList, task.list_id)

    await callback.message.edit_text(
        _summary_text(task, task_list.name if task_list is not None else "Inbox"),
        reply_markup=_result_keyboard(task.id),
    )
    await callback.answer("Список изменён.")


@router.callback_query(F.data.startswith("qa:undo:"))
async def handle_undo(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.from_user is None
        or callback.message is None
        or isinstance(callback.message, InaccessibleMessage)
    ):
        return
    _, _, task_id_raw = callback.data.split(":", 2)

    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None:
            await callback.answer()
            return
        try:
            await tasks_service.delete_task(session, user.id, uuid.UUID(task_id_raw))
        except HTTPException:
            await callback.answer("Задача не найдена.", show_alert=True)
            return

    await callback.message.edit_text("Задача удалена.")
    await callback.answer()


# --- The week's tasks: /week, with buttons to page through the weeks ahead ----------------
# The message itself is built in app/services/week_agenda.py, shared with the worker's
# Monday summary.

_WEEKS_AHEAD_RE = re.compile(r"^\+?(\d{1,3})$")

WEEK_USAGE = (
    "Не понял, какую неделю показать. Например: /week 2 — через две недели, "
    "/week 20.10 — неделя с этой датой."
)


def parse_week(text: str, today: date) -> date | None:
    """The Monday of the week a /week argument names: weeks from now ("1", "+2"),
    "следующая", or any date parse_day reads ("20.10", "пятница", "через 2 недели")."""
    text = text.strip().lower()
    match = _WEEKS_AHEAD_RE.match(text)
    if match:
        return week_start(today) + timedelta(weeks=int(match.group(1)))
    if text.startswith("след"):  # dateparser doesn't read "следующая неделя"
        return week_start(today) + timedelta(weeks=1)
    day = parse_day(text, today)
    return week_start(day) if day is not None else None


async def _week_view(user: User, monday: date) -> tuple[str, InlineKeyboardMarkup]:
    async with async_session_factory() as session:
        return await week_agenda.week_view(session, user, monday, _local_now(user).date())


@router.message(Command("week"))
async def handle_week_command(message: Message, command: CommandObject) -> None:
    if message.from_user is None:
        return
    user = await _linked_user(message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return
    today = _local_now(user).date()
    monday = week_start(today)
    if command.args and command.args.strip():
        parsed = parse_week(command.args, today)
        if parsed is None:
            await message.answer(WEEK_USAGE)
            return
        if parsed < monday:
            await message.answer("Эта неделя уже прошла — можно посмотреть текущую и будущие.")
            return
        if parsed > monday + timedelta(weeks=week_agenda.MAX_WEEKS_AHEAD):
            await message.answer("Так далеко не заглядываю: не больше чем на 10 лет вперёд.")
            return
        monday = parsed
    text, keyboard = await _week_view(user, monday)
    await message.answer(text, reply_markup=keyboard, parse_mode="HTML")


@router.callback_query(F.data.startswith("wk:"))
async def handle_week_callback(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.from_user is None
        or not isinstance(callback.message, Message)
    ):
        return
    try:
        monday = date.fromisoformat(callback.data.removeprefix("wk:"))
    except ValueError:
        await callback.answer("Эта кнопка больше не работает.", show_alert=True)
        return
    user = await _linked_user(callback.from_user.id)
    if user is None:
        await callback.answer(NOT_LINKED_TEXT, show_alert=True)
        return
    text, keyboard = await _week_view(user, monday)
    try:
        await callback.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
    except TelegramBadRequest as error:
        # A stale button that lands on the week already shown.
        if "message is not modified" not in error.message:
            raise
    await callback.answer()


@router.message(Command("unlink"))
async def handle_unlink(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Да, отвязать", callback_data=f"unlink:confirm:{user.id}"
                ),
                InlineKeyboardButton(text="Отмена", callback_data="unlink:cancel"),
            ]
        ]
    )
    await message.answer("Отвязать Telegram от вашего аккаунта?", reply_markup=keyboard)


@router.callback_query(F.data.startswith("unlink:"))
async def handle_unlink_callback(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.message is None
        or isinstance(callback.message, InaccessibleMessage)
        or callback.from_user is None
    ):
        return
    if callback.data == "unlink:cancel":
        await callback.message.edit_text("Отменено.")
        await callback.answer()
        return

    _, _, user_id = callback.data.split(":", 2)
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None or str(user.id) != user_id:
            await callback.answer("Это не ваш аккаунт.", show_alert=True)
            return
        await admin_service.unlink_telegram(session, user.id)
        log.info("bot.telegram_unlinked", user_id=str(user.id))

    await callback.message.edit_text("Telegram отвязан.")
    await callback.answer()


@router.errors()
async def handle_error(event: ErrorEvent) -> bool:
    """Any handler failure (a Telegram API error, a bug): log it and tell the user,
    instead of leaving a button tap spinning or a message unanswered."""
    log.error("bot.handler_failed", exc_info=event.exception)
    text = "Что-то пошло не так. Попробуйте ещё раз."
    with contextlib.suppress(Exception):
        if event.update.callback_query is not None:
            await event.update.callback_query.answer(text, show_alert=True)
        elif event.update.message is not None:
            await event.update.message.answer(text)
    return True


@router.callback_query()
async def handle_stale_callback(callback: CallbackQuery) -> None:
    """Buttons from older bot versions (e.g. the previous quick-add time picker) — answer
    so the client stops spinning instead of leaving the tap hanging."""
    await callback.answer("Эта кнопка больше не работает.", show_alert=True)


@router.message()
async def handle_plain_message(message: Message) -> None:
    if message.from_user is None or message.text is None:
        return
    user = await _linked_user(message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return

    draft = _get_draft(message.from_user.id)
    if draft is not None:
        await _answer_typed_step(message, user, draft, message.text)
        return
    await _start_draft(message, message.from_user.id, message.text)
