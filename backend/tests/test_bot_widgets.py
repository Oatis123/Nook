import asyncio
import json
import uuid
from datetime import date, datetime, time

import pytest
from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramNotFound
from aiogram.methods import EditMessageCaption, SendMessage
from aiogram.types import Message, Update
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.task import Task, TaskPriority
from app.models.task_list import TaskList, TaskListColor
from app.models.user import Theme, User
from app.schemas.task import TaskCreate
from app.services import task_lists, tasks
from bot import handlers, widget_api, widget_views
from bot.main import dp
from tests.conftest import make_user

TODAY = date(2026, 11, 10)


class TelegramSession(AiohttpSession):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.messages = {}
        self.reject_widgets = False

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, widget_api.SendWidget) and self.reject_widgets:
            raise TelegramNotFound(method, "Not Found")
        if isinstance(method, (widget_api.SendWidget, SendMessage)):
            message = {
                "message_id": len(self.calls) + 100,
                "date": 0,
                "chat": {"id": method.chat_id, "type": "private"},
                "from": {"id": bot.id, "is_bot": True, "first_name": "Nook"},
            }
            if isinstance(method, widget_api.SendWidget):
                message["widget"] = {"html": method.html, "chat_data": method.chat_data}
            else:
                message["text"] = method.text
            self.messages[message["message_id"]] = message
            return Message.model_validate(message, context={"bot": bot})
        if isinstance(method, widget_api.EditMessageWidgetData):
            self.messages[method.message_id]["widget"]["chat_data"] = method.chat_data
        return True

    def last(self, method_type):
        return next(method for method in reversed(self.calls) if isinstance(method, method_type))


@pytest.fixture
def telegram(db_engine, monkeypatch):
    monkeypatch.setattr(
        handlers, "async_session_factory", async_sessionmaker(db_engine, expire_on_commit=False)
    )
    monkeypatch.setattr(handlers, "_local_now", lambda user: datetime.combine(TODAY, time(8)))
    handlers._drafts.clear()
    handlers._pending_unlinks.clear()
    session = TelegramSession()
    return Bot("12345:widget-test", session=session), session


async def message(bot, sender_id, text, *, chat_type="private"):
    await dp.feed_update(
        bot,
        Update.model_validate(
            {
                "update_id": 1,
                "message": {
                    "message_id": 1,
                    "date": 0,
                    "chat": {"id": sender_id, "type": chat_type},
                    "from": {"id": sender_id, "is_bot": False, "first_name": "Nook user"},
                    "text": text,
                },
            }
        ),
    )


async def tap(bot, sender_id, message_id, data):
    await dp.feed_update(
        bot,
        Update.model_validate(
            {
                "update_id": 2,
                "widget_query": {
                    "id": "42",
                    "from": {"id": sender_id, "is_bot": False, "first_name": "Nook user"},
                    "chat": {"id": sender_id, "type": "private"},
                    "message_id": message_id,
                    "type": {"type": "data"},
                    "data": data,
                },
            }
        ),
    )


async def tap_text_view(bot, sender_id, prompt, data):
    await dp.feed_update(
        bot,
        Update.model_validate(
            {
                "update_id": 3,
                "callback_query": {
                    "id": "43",
                    "from": {"id": sender_id, "is_bot": False, "first_name": "Nook user"},
                    "message": prompt,
                    "chat_instance": "1",
                    "data": data,
                },
            }
        ),
    )


async def test_widget_saves_typed_task_only_after_confirmation(db_session, telegram):
    bot, session = telegram
    user = await make_user(db_session)
    sender = user.telegram_user_id

    await message(bot, sender, "/new")
    assert session.last(SendMessage).text == "Напишите текст задачи одним сообщением."
    await message(bot, sender, "Review calendar")
    await message(bot, sender, "Check the month boundary")
    await message(bot, sender, "12.11")
    assert not any(isinstance(call, widget_api.SendWidget) for call in session.calls)

    await message(bot, sender, "19:30")
    sent = session.last(widget_api.SendWidget)
    state = json.loads(sent.chat_data)
    assert sent.allow_queries
    assert "caption" not in sent.model_dump(exclude_none=True)
    assert state["rows"][0][0] == "Review calendar"
    assert state["rows"][1] == ["Описание", "Check the month boundary"]
    assert ["Создать задачу", "n:confirm", "primary"] in state["buttons"]
    assert not (await db_session.scalars(select(Task))).all()

    prompt = max(session.messages)
    await message(bot, sender, "Ещё текст")
    assert not (await db_session.scalars(select(Task))).all()
    await asyncio.gather(
        tap(bot, sender, prompt, "n:confirm"), tap(bot, sender, prompt, "n:confirm")
    )
    (task,) = (await db_session.scalars(select(Task))).all()
    assert (task.description, task.due_date, task.due_time) == (
        "Check the month boundary",
        date(2026, 11, 12),
        time(19, 30),
    )
    result = json.loads(session.last(widget_api.EditMessageWidgetData).chat_data)
    assert result["icon"] == "check"
    assert not any(isinstance(call, EditMessageCaption) for call in session.calls)


async def test_confirmation_can_be_cancelled_in_widget(db_session, telegram):
    bot, session = telegram
    user = await make_user(db_session)
    sender = user.telegram_user_id
    await message(bot, sender, "/new Review calendar")
    await message(bot, sender, "Check the month boundary")
    prompt = max(session.messages)
    await tap_text_view(bot, sender, session.messages[prompt], "nt:nodate")
    assert json.loads(session.last(widget_api.SendWidget).chat_data)["buttons"]
    prompt = max(session.messages)
    await tap(bot, sender, prompt, "n:cancel")
    await tap(bot, sender, prompt, "n:confirm")
    assert not (await db_session.scalars(select(Task))).all()
    assert "отменено" in session.last(widget_api.EditMessageWidgetData).chat_data


async def test_week_widget_navigation_and_api_fallback(db_session, telegram):
    bot, session = telegram
    user = await make_user(db_session)
    await message(bot, user.telegram_user_id, "/week")
    sent = session.last(widget_api.SendWidget)
    assert json.loads(sent.chat_data)["detail"] == "9 ноя – 15 ноя"
    prompt = max(session.messages)
    await tap(bot, user.telegram_user_id, prompt, "w:2026-11-16:0")
    edited = session.last(widget_api.EditMessageWidgetData)
    assert json.loads(edited.chat_data)["detail"] == "16 ноя – 22 ноя"
    assert session.last(widget_api.AnswerWidgetQuery).data is None
    await tap_text_view(bot, user.telegram_user_id, session.messages[prompt], "nw:w:2026-11-09")
    assert "Следующая неделя" in session.last(SendMessage).text

    session.reject_widgets = True
    await message(bot, user.telegram_user_id, "/week")
    assert "Эта неделя" in session.last(SendMessage).text


async def test_unlink_widget_requires_current_confirmation(db_session, telegram):
    bot, session = telegram
    user = await make_user(db_session)
    sender = user.telegram_user_id
    await message(bot, sender, "/unlink")
    old_prompt = max(session.messages)
    await message(bot, sender, "/unlink")
    prompt = max(session.messages)
    await tap(bot, sender, old_prompt, "u:confirm")
    assert session.last(widget_api.AnswerWidgetQuery).data is not None
    await tap(bot, sender, prompt, "u:cancel")
    await tap(bot, sender, prompt, "u:confirm")
    await db_session.refresh(user)
    assert user.telegram_user_id == sender

    await message(bot, sender, "/unlink")
    await tap(bot, sender, max(session.messages), "u:confirm")
    await db_session.refresh(user)
    assert user.telegram_user_id is None


async def test_list_widget_opens_only_owned_lists(db_session, telegram):
    bot, session = telegram
    user = await make_user(db_session)
    another = await make_user(db_session, "another")
    work = await task_lists.get_or_create_inbox(db_session, user.id)
    private = await task_lists.get_or_create_inbox(db_session, another.id)
    await tasks.create_task(db_session, user.id, TaskCreate(title="Review calendar"))
    await tasks.create_task(db_session, another.id, TaskCreate(title="Private task"))

    await message(bot, user.telegram_user_id, "/lists")
    sent = session.last(widget_api.SendWidget)
    (row,) = json.loads(sent.chat_data)["rows"]
    assert sent.allow_queries
    prompt = max(session.messages)
    assert row[-1] == f"tl:{work.id.hex}"
    await tap(bot, user.telegram_user_id, prompt, row[-1])
    assert session.last(SendMessage).text == "📋 Inbox\n☐ Review calendar"
    await tap(bot, user.telegram_user_id, prompt, f"tl:{private.id.hex}")
    assert "Список не найден" in session.last(widget_api.AnswerWidgetQuery).data
    assert session.last(SendMessage).text == "📋 Inbox\n☐ Review calendar"


async def test_commands_without_actions_use_text(db_session, telegram):
    bot, session = telegram
    user = await make_user(db_session)
    sender = user.telegram_user_id
    for command, icon in [("/start", "home"), ("/lists", "list")]:
        await message(bot, sender, command)
        sent = session.last(widget_api.SendWidget)
        assert json.loads(sent.chat_data)["icon"] == icon
        assert "caption" not in sent.model_dump(exclude_none=True)

    await message(bot, sender, "/cancel")
    assert isinstance(session.calls[-1], SendMessage)
    await message(bot, sender, "/help")
    assert isinstance(session.calls[-1], SendMessage)
    assert session.calls[-1].text == handlers.HELP_TEXT


def test_widget_payloads_fit_bot_api_limits():
    widget_api.widget_html()
    user = User(theme=Theme.dark)
    long_name = "\\" * 120 + "🗓" * 60
    lists = [
        TaskList(id=uuid.uuid4(), name=long_name, color=TaskListColor.palette_1) for _ in range(12)
    ]
    overdue = [
        Task(title=long_name, list_id=lists[0].id, priority=TaskPriority.high, due_date=TODAY)
        for _ in range(12)
    ]
    states = [
        widget_views.list_card(lists, user, 1),
        widget_views.week_card(date(2026, 11, 9), TODAY, [], overdue, lists, user, 1),
        widget_views.card(
            "Подтвердите создание задачи",
            icon="calendar",
            rows=handlers._task_rows(
                Task(title=long_name, description=long_name, due_date=TODAY, due_time=time(18)),
                long_name,
                TaskPriority.medium,
            ),
            buttons=[["Создать задачу", "n:confirm", "primary"], ["Отмена", "n:cancel"]],
        ),
    ]
    assert all(len(widget_api.encode(state).encode()) <= 1024 for state in states)
