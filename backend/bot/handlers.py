import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import dateparser
import structlog
from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    CallbackQuery,
    InaccessibleMessage,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.models.task import Task, TaskPriority
from app.models.task_list import TaskList
from app.models.user import User
from app.schemas.task import TaskCreate, TaskUpdate
from app.services import admin as admin_service
from app.services import task_lists as task_lists_service
from app.services import tasks as tasks_service
from app.services import telegram_link as telegram_link_service
from app.services.quick_add import (
    DEFAULT_LANGUAGES,
    ParsedQuickAdd,
    default_recurrence_start_date,
    parse_quick_add,
)
from app.services.recurrence import RecurrenceInput

router = Router()
settings = get_settings()
log = structlog.get_logger()

NOT_LINKED_TEXT = (
    "This bot works only with a linked account.\n"
    f"Open {settings.public_url} and connect Telegram from Settings first."
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
        await message.answer(f"Welcome to {settings.app_name}.\n\n{NOT_LINKED_TEXT}")


@router.message(CommandStart())
async def handle_start_plain(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(f"Welcome to {settings.app_name}.\n\n{NOT_LINKED_TEXT}")
    else:
        await message.answer(f"Welcome back, {user.username}.")


async def _handle_link(message: Message, telegram_user_id: int, plain_token: str) -> None:
    async with async_session_factory() as session:
        previous_chat_id = await telegram_link_service.chat_linked_before(session, plain_token)
        user = await telegram_link_service.consume_link_token(
            session, plain_token, telegram_user_id, message.chat.id
        )
    if user is None:
        await message.answer(
            "This link is invalid, expired, or this Telegram account is already linked "
            "to a different account."
        )
        return
    log.info("bot.telegram_linked", user_id=str(user.id))
    await message.answer(
        f"Your Telegram is now linked to {settings.app_name} as '{user.username}'."
    )
    if previous_chat_id is not None and previous_chat_id != message.chat.id:
        # The account moved to another Telegram: tell the old one, which can no longer
        # log in with Telegram — if that wasn't its owner's doing, they need to know.
        try:
            await message.bot.send_message(  # type: ignore[union-attr]
                previous_chat_id,
                f"Your {settings.app_name} account '{user.username}' was just linked to a "
                "different Telegram account, so this chat will no longer get reminders or "
                "login requests. If you didn't do this, change your password and reconnect "
                "Telegram in Settings.",
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
            await message.answer("This login link is invalid or has expired.")
            return

        await telegram_link_service.attach_login_requester(session, token, user.id)
        meta = token.meta or {}
        token_id = token.id

    device = meta.get("user_agent") or "an unknown device"
    ip = meta.get("ip") or "an unknown location"
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
                [InlineKeyboardButton(text="Deny", callback_data=f"tglogin:deny:{token_id}")],
            ]
        )
        prompt = (
            "To confirm, tap the code shown in your browser. If you didn't start this "
            "login yourself just now — for example, someone sent you this link — press Deny."
        )
    else:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="Confirm login", callback_data=f"tglogin:confirm:{token_id}"
                    ),
                    InlineKeyboardButton(text="Deny", callback_data=f"tglogin:deny:{token_id}"),
                ]
            ]
        )
        prompt = (
            "Only confirm if you started this login yourself, just now. If someone sent you "
            "this link, press Deny — confirming would give them access to your account."
        )
    await message.answer(
        f"Someone is trying to log in to {settings.app_name} as '{user.username}' from:\n"
        f"{device}\n{ip}\n\n{prompt}",
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
        await callback.answer("This request is no longer valid.", show_alert=True)
        return

    async with async_session_factory() as session:
        token = await telegram_link_service.find_login_token_by_id(session, token_id)
        if token is None or token.user_id is None:
            await callback.answer("This request is no longer valid.", show_alert=True)
            return

        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None or user.id != token.user_id:
            await callback.answer("This isn't your login request.", show_alert=True)
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
        text = "Login confirmed. You can return to the browser."
    elif action == "code":
        text = (
            "That code doesn't match, so the login was denied. If you didn't start this "
            "login, someone may be trying to get into your account — change your password."
        )
    else:
        text = "Login denied."
    await callback.message.edit_text(text)
    await callback.answer()


@router.message(Command("help"))
async def handle_help(message: Message) -> None:
    await message.answer(
        f"{settings.app_name} bot commands:\n\n"
        "/new <text> — create a task (or just send text with no command)\n"
        "/lists — show your task lists\n"
        "/help — this message\n"
        "/unlink — disconnect your Telegram from your account\n\n"
        "Task text understands the same syntax as quick add on the web: a date/time "
        '("tomorrow 6pm", or in Russian, "завтра в 18:00"), !low/!medium/!high for '
        'priority, #ListName to file it into a list, and "every ..." for a repeat '
        '(e.g. "every monday", "every 3 days", "daily").'
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
        await message.answer("You have no lists yet.")
        return
    await message.answer("Your lists:\n" + "\n".join(f"• {task_list.name}" for task_list in lists))


@dataclass
class _PendingQuickAdd:
    title: str
    list_name: str | None
    priority: str | None
    recurrence: RecurrenceInput
    due_date: date  # a recurring task always needs one (spec §7.4)


# Recurring tasks need a time (spec §7.4); quick add's parser can infer everything else
# but not that, so a draft waits here, keyed by Telegram user id, until the next message
# or button tap supplies one. In-memory and per-process is an accepted trade-off (spec's
# own "не усложнять" spirit) — a bot restart mid-conversation just drops the draft, which
# the user notices immediately by re-sending their text.
_pending_time_requests: dict[int, _PendingQuickAdd] = {}


def _local_now(user: User) -> datetime:
    return datetime.now(ZoneInfo(user.timezone)).replace(tzinfo=None)


def _time_preset_keyboard() -> InlineKeyboardMarkup:
    presets = [("9:00 AM", "09:00"), ("12:00 PM", "12:00"), ("6:00 PM", "18:00")]
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=label, callback_data=f"qa:time:{value}")
                for label, value in presets
            ]
        ]
    )


_WEEKDAY_LABEL = {
    "MO": "Mon",
    "TU": "Tue",
    "WE": "Wed",
    "TH": "Thu",
    "FR": "Fri",
    "SA": "Sat",
    "SU": "Sun",
}
_FREQ_UNIT_LABEL = {"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}


def _describe_rrule(rrule: str) -> str:
    parts = dict(p.split("=", 1) for p in rrule.split(";"))
    freq = parts.get("FREQ", "DAILY").lower()
    interval = int(parts.get("INTERVAL", "1"))
    unit = _FREQ_UNIT_LABEL.get(freq, freq)
    label = f"Every {interval} {unit}s" if interval > 1 else f"Every {unit}"
    if freq == "weekly" and "BYDAY" in parts:
        days = [_WEEKDAY_LABEL.get(d, d) for d in parts["BYDAY"].split(",")]
        label += " on " + ", ".join(days)
    if freq == "monthly" and "BYMONTHDAY" in parts:
        label += (
            " on the last day" if parts["BYMONTHDAY"] == "-1" else f" on day {parts['BYMONTHDAY']}"
        )
    if "COUNT" in parts:
        label += f", {parts['COUNT']}×"
    if "UNTIL" in parts:
        u = parts["UNTIL"]
        label += f" until {u[:4]}-{u[4:6]}-{u[6:8]}"
    return label


def _summary_text(task: Task, list_name: str) -> str:
    lines = [f"Created: {task.title}", f"List: {list_name}"]
    if task.due_date is not None:
        due = f"Due: {task.due_date:%b %d, %Y}"
        if task.due_time is not None:
            due += f", {task.due_time:%I:%M %p}".replace(" 0", " ")
        lines.append(due)
    if task.priority != TaskPriority.none:
        lines.append(f"Priority: {task.priority.value.capitalize()}")
    if task.is_recurring and task.rrule:
        lines.append(f"Repeats: {_describe_rrule(task.rrule)}")
    return "\n".join(lines)


def _result_keyboard(task_id: uuid.UUID) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Change list", callback_data=f"qa:list:{task_id}"),
                InlineKeyboardButton(text="Undo", callback_data=f"qa:undo:{task_id}"),
            ]
        ]
    )


async def _create_task_from_parsed(
    session: AsyncSession, user: User, parsed: ParsedQuickAdd
) -> tuple[Task, str]:
    lists = await task_lists_service.list_task_lists(session, user.id)
    matched = next(
        (
            candidate
            for candidate in lists
            if parsed.list_name and candidate.name.lower() == parsed.list_name.lower()
        ),
        None,
    )
    title = parsed.title
    if parsed.list_name is not None and matched is None:
        title = f"{title} #{parsed.list_name}".strip()

    due_date = parsed.due_date
    if parsed.recurrence is not None and due_date is None:
        due_date = default_recurrence_start_date(parsed.recurrence, _local_now(user).date())

    task = await tasks_service.create_task(
        session,
        user.id,
        TaskCreate(
            title=title,
            list_id=matched.id if matched else None,
            priority=TaskPriority(parsed.priority) if parsed.priority else TaskPriority.none,
            due_date=due_date,
            due_time=parsed.due_time,
            recurrence=parsed.recurrence,
        ),
    )
    task_list = await session.get(TaskList, task.list_id)
    return task, task_list.name if task_list is not None else "Inbox"


def _validation_hint(exc: ValidationError) -> str:
    fields = {str(part) for error in exc.errors() for part in error["loc"]}
    if "title" in fields:
        return (
            "I couldn't find a task title in that (it must be 1–500 characters). "
            'Try something like "Buy milk tomorrow 18:00".'
        )
    if fields & {"interval", "recurrence", "end_count", "end_date", "by_weekday"}:
        return 'That repeat rule is out of range — try e.g. "every 2 days" or "every week".'
    return "I couldn't turn that into a task — try rephrasing it."


async def _create_and_reply(message: Message, user: User, parsed: ParsedQuickAdd) -> None:
    # Invalid input used to raise out of the handler: aiogram logged it and the user got
    # no reply at all.
    try:
        async with async_session_factory() as session:
            task, list_name = await _create_task_from_parsed(session, user, parsed)
    except ValidationError as exc:
        await message.answer(_validation_hint(exc))
        return
    except HTTPException as exc:
        await message.answer(f"Couldn't create the task: {exc.detail}")
        return
    await message.answer(_summary_text(task, list_name), reply_markup=_result_keyboard(task.id))


async def _handle_quick_add_text(message: Message, user: User, text: str) -> None:
    assert message.from_user is not None
    parsed = parse_quick_add(text, now=_local_now(user), languages=DEFAULT_LANGUAGES)

    if parsed.recurrence is not None and parsed.due_time is None:
        due_date = parsed.due_date or default_recurrence_start_date(
            parsed.recurrence, _local_now(user).date()
        )
        _pending_time_requests[message.from_user.id] = _PendingQuickAdd(
            title=parsed.title,
            list_name=parsed.list_name,
            priority=parsed.priority,
            recurrence=parsed.recurrence,
            due_date=due_date,
        )
        await message.answer(
            "This is a recurring task and needs a time — pick one or send it as a message.",
            reply_markup=_time_preset_keyboard(),
        )
        return

    await _create_and_reply(message, user, parsed)


async def _resolve_pending_time(message: Message, user: User, pending: _PendingQuickAdd) -> None:
    assert message.from_user is not None
    parsed_dt = dateparser.parse(
        message.text or "",
        languages=DEFAULT_LANGUAGES,
        settings={"RELATIVE_BASE": _local_now(user), "RETURN_AS_TIMEZONE_AWARE": False},
    )
    if parsed_dt is None:
        await message.answer('Sorry, I didn\'t catch a time — try something like "6pm" or "18:00".')
        return

    _pending_time_requests.pop(message.from_user.id, None)
    parsed = ParsedQuickAdd(
        title=pending.title,
        due_date=pending.due_date,
        due_time=parsed_dt.time(),
        priority=pending.priority,
        list_name=pending.list_name,
        recurrence=pending.recurrence,
    )
    await _create_and_reply(message, user, parsed)


@router.message(Command("new"))
async def handle_new_command(message: Message, command: CommandObject) -> None:
    if message.from_user is None:
        return
    text = (command.args or "").strip()
    if not text:
        await message.answer("Usage: /new <task description>")
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return
    await _handle_quick_add_text(message, user, text)


@router.callback_query(F.data.startswith("qa:time:"))
async def handle_time_preset(callback: CallbackQuery) -> None:
    if callback.data is None or callback.from_user is None:
        return
    pending = _pending_time_requests.pop(callback.from_user.id, None)
    if pending is None:
        await callback.answer("This request has expired.", show_alert=True)
        return

    _, _, value = callback.data.split(":", 2)
    hour, minute = (int(part) for part in value.split(":"))

    parsed = ParsedQuickAdd(
        title=pending.title,
        due_date=pending.due_date,
        due_time=time(hour, minute),
        priority=pending.priority,
        list_name=pending.list_name,
        recurrence=pending.recurrence,
    )
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None:
            await callback.answer()
            return
        task, list_name = await _create_task_from_parsed(session, user, parsed)

    if isinstance(callback.message, Message):
        await callback.message.edit_text(
            _summary_text(task, list_name), reply_markup=_result_keyboard(task.id)
        )
    await callback.answer()


@router.callback_query(F.data.startswith("qa:list:"))
async def handle_change_list(callback: CallbackQuery) -> None:
    if callback.data is None or callback.from_user is None:
        return
    _, _, task_id_raw = callback.data.split(":", 2)

    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None:
            await callback.answer()
            return
        lists = await task_lists_service.list_task_lists(session, user.id)

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=task_list.name, callback_data=f"qa:setlist:{task_id_raw}:{task_list.id}"
                )
            ]
            for task_list in lists
        ]
    )
    if isinstance(callback.message, Message):
        await callback.message.edit_reply_markup(reply_markup=keyboard)
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
    _, _, task_id_raw, list_id_raw = callback.data.split(":", 3)

    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None:
            await callback.answer()
            return
        try:
            task = await tasks_service.update_task(
                session, user.id, uuid.UUID(task_id_raw), TaskUpdate(list_id=uuid.UUID(list_id_raw))
            )
        except HTTPException:
            await callback.answer("Not found.", show_alert=True)
            return
        task_list = await session.get(TaskList, task.list_id)

    await callback.message.edit_text(
        _summary_text(task, task_list.name if task_list is not None else "Inbox"),
        reply_markup=_result_keyboard(task.id),
    )
    await callback.answer("List updated.")


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
            await callback.answer("Not found.", show_alert=True)
            return

    await callback.message.edit_text("Task deleted.")
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
                InlineKeyboardButton(text="Yes, unlink", callback_data=f"unlink:confirm:{user.id}"),
                InlineKeyboardButton(text="Cancel", callback_data="unlink:cancel"),
            ]
        ]
    )
    await message.answer("Disconnect Telegram from your account?", reply_markup=keyboard)


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
        await callback.message.edit_text("Cancelled.")
        await callback.answer()
        return

    _, _, user_id = callback.data.split(":", 2)
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None or str(user.id) != user_id:
            await callback.answer("This isn't your account.", show_alert=True)
            return
        await admin_service.unlink_telegram(session, user.id)
        log.info("bot.telegram_unlinked", user_id=str(user.id))

    await callback.message.edit_text("Telegram disconnected.")
    await callback.answer()


@router.message()
async def handle_plain_message(message: Message) -> None:
    if message.from_user is None or message.text is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return

    pending = _pending_time_requests.get(message.from_user.id)
    if pending is not None:
        await _resolve_pending_time(message, user, pending)
        return

    await _handle_quick_add_text(message, user, message.text)
