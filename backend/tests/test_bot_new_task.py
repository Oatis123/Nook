import itertools
from datetime import date, time
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiogram.filters import CommandObject
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message
from freezegun import freeze_time
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.task import Task, TaskPriority
from app.models.task_list import TaskList, TaskListColor, TaskListIcon
from app.models.user import User
from app.schemas.task import TaskCreate
from app.services import ideas as ideas_service
from app.services import task_lists as task_lists_service
from app.services import tasks as tasks_service
from app.services import week_agenda
from app.services.recurrence import RecurrenceInput
from app.services.telegram_format import format_due, plural
from bot import handlers
from tests.conftest import make_user

# Friday 2026-10-02, 10:00 in the user's timezone (UTC, the default).
NOW = "2026-10-02T10:00:00+00:00"

_message_ids = itertools.count(1)


def _mock(cls: type) -> Any:
    """A stand-in that passes isinstance checks. aiogram's answer/edit_* methods aren't
    coroutine functions — they return an awaitable request object — so they're replaced
    with AsyncMocks explicitly."""
    mock = MagicMock(spec=cls)
    mock.answer = AsyncMock()
    mock.edit_text = AsyncMock()
    mock.edit_reply_markup = AsyncMock()
    return mock


@pytest.fixture(autouse=True)
def _bot_uses_test_db(db_engine: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        handlers, "async_session_factory", async_sessionmaker(db_engine, expire_on_commit=False)
    )
    handlers._drafts.clear()
    handlers._idea_blocks.clear()


def _checked(markup: InlineKeyboardMarkup | None) -> InlineKeyboardMarkup | None:
    """Telegram rejects a whole keyboard (BUTTON_DATA_INVALID) if any button's
    callback_data is over 64 bytes — which is how the list picker silently broke."""
    for row in markup.inline_keyboard if markup else []:
        for button in row:
            assert button.callback_data is not None
            assert len(button.callback_data.encode()) <= 64, button.callback_data
    return markup


_CALLBACK_ROUTES = [
    ("nt:", handlers.handle_new_task_callback),
    ("qa:list:", handlers.handle_change_list),
    ("qa:setlist:", handlers.handle_set_list),
    ("qa:back:", handlers.handle_list_picker_back),
    ("qa:undo:", handlers.handle_undo),
    ("idea:undo", handlers.handle_idea_undo),
    ("wk:", handlers.handle_week_callback),
]


async def _route_callback(callback: Any) -> None:
    """Mirrors the router: the first handler whose prefix matches, else the fallback."""
    for prefix, handler in _CALLBACK_ROUTES:
        if callback.data.startswith(prefix):
            await handler(callback)
            return
    await handlers.handle_stale_callback(callback)


class FakeChat:
    """Drives the bot's handlers the way Telegram would: typed messages go to the
    catch-all message handler, button taps become callback queries on the message that
    carries the button. Everything the bot sends is kept in `sent`, edited in place."""

    def __init__(self, telegram_id: int) -> None:
        self.telegram_id = telegram_id
        self.sent: list[Any] = []

    def _bot_message(self, text: str, reply_markup: InlineKeyboardMarkup | None) -> Any:
        msg = _mock(Message)
        msg.message_id = next(_message_ids)
        msg.text = text
        msg.reply_markup = _checked(reply_markup)

        async def edit_text(text: str, reply_markup: Any = None, **_: Any) -> None:
            msg.text, msg.reply_markup = text, _checked(reply_markup)

        async def edit_reply_markup(reply_markup: Any = None, **_: Any) -> None:
            msg.reply_markup = _checked(reply_markup)

        msg.edit_text = AsyncMock(side_effect=edit_text)
        msg.edit_reply_markup = AsyncMock(side_effect=edit_reply_markup)
        self.sent.append(msg)
        return msg

    def _user_message(self, text: str) -> Any:
        msg = _mock(Message)
        msg.text = text
        msg.from_user = MagicMock(id=self.telegram_id)

        async def answer(text: str, reply_markup: Any = None, **_: Any) -> Any:
            return self._bot_message(text, reply_markup)

        msg.answer = AsyncMock(side_effect=answer)
        return msg

    async def type(self, text: str) -> None:
        await handlers.handle_plain_message(self._user_message(text))

    async def command(self, name: str, args: str | None = None) -> None:
        text = f"/{name} {args}" if args else f"/{name}"
        command = CommandObject(prefix="/", command=name, args=args)
        await getattr(handlers, f"handle_{name}_command")(self._user_message(text), command)

    def buttons(self, msg: Any = None) -> list[str]:
        markup = (msg or self.last).reply_markup
        return [b.text for row in markup.inline_keyboard for b in row] if markup else []

    async def tap(self, label: str) -> Any:
        """Taps the button labelled `label` on the newest message that has one."""
        for msg in reversed(self.sent):
            for row in msg.reply_markup.inline_keyboard if msg.reply_markup else []:
                for button in row:
                    if button.text == label:
                        callback = _mock(CallbackQuery)
                        callback.data = button.callback_data
                        callback.from_user = MagicMock(id=self.telegram_id)
                        callback.message = msg
                        await _route_callback(callback)
                        return callback
        raise AssertionError(f"no button {label!r} in {[self.buttons(m) for m in self.sent]}")

    @property
    def last(self) -> Any:
        return self.sent[-1]


async def _chat(db_session: AsyncSession) -> FakeChat:
    user = await make_user(db_session, "alice")
    assert user.telegram_user_id is not None
    return FakeChat(user.telegram_user_id)


async def _tasks(db_session: AsyncSession) -> list[Task]:
    return list(await db_session.scalars(select(Task).where(Task.deleted_at.is_(None))))


async def _ideas(db_session: AsyncSession) -> str | None:
    """The Ideas note's content as the bot left it (written through its own sessions)."""
    db_session.expire_all()
    user = await db_session.scalar(select(User))
    assert user is not None
    note = await ideas_service.get_ideas_note(db_session, user.id)
    return None if note is None else note.content


# --- quick ideas ---


@freeze_time(NOW)
async def test_idea_button_instead_of_a_description(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Сделать бота для заметок")
    await chat.tap("💡 Это идея")

    assert await _tasks(db_session) == []
    assert await _ideas(db_session) == "**пт, 2 окт 2026, 10:00**  \nСделать бота для заметок\n"
    assert chat.last.text == "💡 Записал в «Идеи»:\nСделать бота для заметок"
    assert chat.buttons() == ["Отменить"]
    assert handlers._drafts == {}


@freeze_time(NOW)
async def test_idea_command_with_text_appends_at_the_end(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.command("idea", "Первая")
    await chat.command("idea", "Вторая")

    assert await _ideas(db_session) == (
        "**пт, 2 окт 2026, 10:00**  \nПервая\n\n**пт, 2 окт 2026, 10:00**  \nВторая\n"
    )


@freeze_time(NOW)
async def test_idea_command_alone_takes_the_next_message(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Недописанная задача")
    await chat.command("idea")
    prompt = chat.last
    assert prompt.text.startswith("💡 Напишите идею")
    await chat.type("Идея  \nв две строки")

    assert await _ideas(db_session) == "**пт, 2 окт 2026, 10:00**  \nИдея  \nв две строки\n"
    assert await _tasks(db_session) == []
    assert prompt.reply_markup is None
    assert handlers._drafts == {}
    # The next message is a task again.
    await chat.type("Обычная задача")
    assert handlers._drafts[chat.telegram_id].step == "description"


@freeze_time(NOW)
async def test_idea_command_can_be_cancelled(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.command("idea")
    await chat.tap("Отмена")

    assert chat.last.text == "Отменено."
    assert await _ideas(db_session) is None
    assert handlers._drafts == {}


@freeze_time(NOW)
async def test_idea_undo_removes_just_that_idea(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    await chat.command("idea", "Оставить")
    await chat.command("idea", "Убрать")

    await chat.tap("Отменить")

    assert chat.last.text == "Идея удалена."
    assert await _ideas(db_session) == "**пт, 2 окт 2026, 10:00**  \nОставить\n"


# --- the flow ---


@freeze_time(NOW)
async def test_text_description_date_button_and_time_preset(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Купить подарок Лене")
    assert "описание" in chat.last.text
    await chat.type("Что-нибудь из списка в заметках")
    assert chat.buttons()[:2] == ["Сегодня", "Завтра"]
    await chat.tap("Завтра")
    await chat.tap("18:00")

    [task] = await _tasks(db_session)
    assert task.title == "Купить подарок Лене"
    assert task.description == "Что-нибудь из списка в заметках"
    assert task.priority == TaskPriority.medium
    assert (task.due_date, task.due_time) == (date(2026, 10, 3), time(18, 0))
    assert chat.last.text.startswith("✅ Задача создана: Купить подарок Лене")
    assert "Срок: сб, 3 окт 2026, 18:00" in chat.last.text
    assert "Приоритет: средний" in chat.last.text
    assert chat.buttons() == ["Сменить список", "Удалить"]
    assert handlers._drafts == {}


@freeze_time(NOW)
async def test_skipped_description_typed_date_and_time(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Позвонить маме")
    prompt = chat.last
    await chat.tap("Пропустить")
    await chat.type("12.10")
    await chat.type("19.30")

    [task] = await _tasks(db_session)
    assert task.description is None
    assert (task.due_date, task.due_time) == (date(2026, 10, 12), time(19, 30))
    # Answered by typing: the previous step's buttons are taken off.
    assert prompt.reply_markup is None or "Пропустить" not in chat.buttons(prompt)


@freeze_time(NOW)
async def test_calendar_pick_next_month_without_time(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Техосмотр")
    await chat.tap("Пропустить")
    await chat.tap("📆 Выбрать дату")
    assert "Октябрь 2026" in chat.buttons()
    assert "1" not in chat.buttons()  # days before today can't be picked
    await chat.tap("›")
    assert "Ноябрь 2026" in chat.buttons()
    await chat.tap("15")
    await chat.tap("Без времени")

    [task] = await _tasks(db_session)
    assert (task.due_date, task.due_time) == (date(2026, 11, 15), None)


@freeze_time(NOW)
async def test_no_date_creates_task_right_away(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Когда-нибудь почитать")
    await chat.tap("Пропустить")
    await chat.tap("Без срока")

    [task] = await _tasks(db_session)
    assert (task.due_date, task.due_time) == (None, None)
    assert "Срок: без срока" in chat.last.text


@freeze_time(NOW)
async def test_today_offers_only_times_still_ahead(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Обед")
    await chat.tap("Пропустить")
    await chat.tap("Сегодня")

    assert chat.buttons()[:3] == ["12:00", "18:00", "Без времени"]


@freeze_time(NOW)
async def test_cancel_drops_the_draft(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Передумаю")
    await chat.tap("Отмена")
    assert chat.last.text == "Создание задачи отменено."
    await chat.type("Новая задача")

    assert await _tasks(db_session) == []
    assert handlers._drafts[chat.telegram_id].title == "Новая задача"


@freeze_time(NOW)
async def test_abandoned_draft_does_not_swallow_the_next_task(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Старая задача")
    handlers._drafts[chat.telegram_id].started -= handlers.DRAFT_TTL_SECONDS + 1
    await chat.type("Новая задача")

    draft = handlers._drafts[chat.telegram_id]
    assert (draft.title, draft.description) == ("Новая задача", None)


@freeze_time(NOW)
async def test_unparsable_date_asks_again(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Задача")
    await chat.tap("Пропустить")
    await chat.type("когда-нибудь потом")

    assert chat.last.text.startswith("Не понял дату")
    assert handlers._drafts[chat.telegram_id].step == "date"


@freeze_time(NOW)
async def test_buttons_of_a_finished_draft_do_nothing(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Задача")
    first_prompt = chat.last
    await chat.tap("Отмена")
    await chat.type("Другая")
    callback = _mock(CallbackQuery)
    callback.data, callback.message = "nt:skip", first_prompt
    callback.from_user = MagicMock(id=chat.telegram_id)
    await handlers.handle_new_task_callback(callback)

    callback.answer.assert_awaited_once()
    assert handlers._drafts[chat.telegram_id].step == "description"


async def test_too_long_title_is_rejected(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("x" * 501)

    assert chat.last.text.startswith("Слишком длинно")
    assert handlers._drafts == {}


async def test_undo_deletes_the_created_task(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Ошибочная")
    await chat.tap("Пропустить")
    await chat.tap("Без срока")
    await chat.tap("Удалить")

    assert chat.last.text == "Задача удалена."
    assert await _tasks(db_session) == []


async def test_change_list_moves_the_task_or_goes_back(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    user = await db_session.scalar(select(User).where(User.username == "alice"))
    assert user is not None
    await task_lists_service.create_task_list(
        db_session, user.id, "Работа", TaskListColor.palette_1, TaskListIcon.briefcase
    )

    await chat.type("Отчёт")
    await chat.tap("Пропустить")
    await chat.tap("Без срока")
    summary = chat.last

    await chat.tap("Сменить список")
    assert "Работа" in chat.buttons(summary)
    await chat.tap("« Назад")
    assert chat.buttons(summary) == ["Сменить список", "Удалить"]

    await chat.tap("Сменить список")
    await chat.tap("Работа")
    [task] = await _tasks(db_session)
    work = await db_session.scalar(select(TaskList).where(TaskList.name == "Работа"))
    assert work is not None and task.list_id == work.id
    assert "Список: Работа" in summary.text
    assert chat.buttons(summary) == ["Сменить список", "Удалить"]


async def test_old_quick_add_buttons_are_answered(db_session: AsyncSession) -> None:
    callback = _mock(CallbackQuery)
    callback.data = "qa:time:09:00"
    await handlers.handle_stale_callback(callback)
    callback.answer.assert_awaited_once()


# --- parsing and formatting ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("12.10", date(2026, 10, 12)),
        ("12/10", date(2026, 10, 12)),
        ("01.03", date(2027, 3, 1)),  # already past this year
        ("12.10.27", date(2027, 10, 12)),
        ("12.10.2027", date(2027, 10, 12)),
        ("31.02", None),
        ("завтра", date(2026, 10, 3)),
        ("12 октября", date(2026, 10, 12)),
        ("абракадабра", None),
    ],
)
def test_parse_day(text: str, expected: date | None) -> None:
    assert handlers.parse_day(text, date(2026, 10, 2)) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("19:30", time(19, 30)),
        ("19.30", time(19, 30)),
        ("19 30", time(19, 30)),
        ("9", time(9, 0)),
        ("в 9", time(9, 0)),
        ("25:00", None),
        ("7:99", None),
        ("вечером", None),
    ],
)
def test_parse_time(text: str, expected: time | None) -> None:
    assert handlers.parse_time(text) == expected


def test_format_due_in_russian() -> None:
    assert format_due(date(2026, 10, 3), time(18, 0)) == "сб, 3 окт 2026, 18:00"
    assert format_due(date(2026, 5, 1), None) == "пт, 1 мая 2026"


# --- /week ---


async def _add_task(
    db_session: AsyncSession, user: User, title: str, due: date, at: time | None = None, **kw: Any
) -> Task:
    return await tasks_service.create_task(
        db_session, user.id, TaskCreate(title=title, due_date=due, due_time=at, **kw)
    )


@freeze_time(NOW)
async def test_week_shows_open_tasks_by_day_and_pages_ahead(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    assert user.telegram_user_id is not None
    chat = FakeChat(user.telegram_user_id)
    await _add_task(db_session, user, "Позвонить врачу", date(2026, 9, 30))
    await _add_task(db_session, user, "Купить хлеб", date(2026, 10, 2))
    await _add_task(
        db_session, user, "Встреча", date(2026, 10, 2), time(18, 0), priority=TaskPriority.high
    )
    await _add_task(
        db_session,
        user,
        "Зарядка",
        date(2026, 10, 2),
        time(9, 0),
        recurrence=RecurrenceInput(freq="daily"),
    )
    await _add_task(db_session, user, "Уборка <дома>", date(2026, 10, 4))
    await _add_task(db_session, user, "Отчёт", date(2026, 10, 6))
    done = await _add_task(db_session, user, "Уже сделано", date(2026, 10, 3))
    await tasks_service.complete_task(db_session, user.id, done.id, complete_subtasks=False)

    await chat.command("week")
    this_week = chat.last.text
    assert this_week == (
        "📅 <b>Эта неделя: 28 сен – 4 окт</b>\n\n"
        "⚠️ <b>Просрочено</b>\n"
        "• Позвонить врачу — ср, 30 сен\n\n"
        "<b>Пт, 2 окт</b> · сегодня\n"
        "• Купить хлеб\n"
        "• 09:00 Зарядка 🔁\n"
        "• ❗ 18:00 Встреча\n\n"
        "<b>Сб, 3 окт</b> · завтра\n"
        "• 09:00 Зарядка 🔁\n\n"
        "<b>Вс, 4 окт</b>\n"
        "• Уборка &lt;дома&gt;\n"
        "• 09:00 Зарядка 🔁"
    )
    assert chat.buttons() == ["След. неделя ›"]

    await chat.tap("След. неделя ›")
    assert chat.last.text.startswith("📅 <b>Следующая неделя: 5–11 окт</b>\n\n<b>Пн, 5 окт</b>\n")
    assert "Просрочено" not in chat.last.text
    assert "<b>Вт, 6 окт</b>\n• Отчёт\n• 09:00 Зарядка 🔁\n" in chat.last.text
    assert chat.last.text.count("Зарядка") == 7
    assert chat.buttons() == ["‹ Пред. неделя", "След. неделя ›"]

    await chat.tap("След. неделя ›")
    assert chat.last.text.startswith("📅 <b>Через 2 недели: 12–18 окт</b>")
    assert chat.buttons() == ["‹ Пред. неделя", "След. неделя ›", "« Эта неделя"]

    await chat.tap("« Эта неделя")
    assert chat.last.text == this_week
    assert len(chat.sent) == 1  # every tap edited the same message


@freeze_time(NOW)
async def test_week_command_picks_the_week(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.command("week")
    assert chat.last.text == "📅 <b>Эта неделя: 28 сен – 4 окт</b>\n\nДо конца недели задач нет."
    for args, heading in [
        ("1", "Следующая неделя: 5–11 окт"),
        ("следующая", "Следующая неделя: 5–11 окт"),
        ("3", "Через 3 недели: 19–25 окт"),
        ("20.10", "Через 3 недели: 19–25 окт"),
        ("через 5 недель", "Через 5 недель: 2–8 ноя"),
        ("28.12", "Через 13 недель: 28 дек 2026 – 3 янв 2027"),
        ("15.06.2027", "Через 37 недель: 14–20 июн 2027"),
    ]:
        await chat.command("week", args)
        assert chat.last.text == f"📅 <b>{heading}</b>\n\nЗадач нет.", args

    await chat.command("week", "непонятно")
    assert chat.last.text == handlers.WEEK_USAGE
    await chat.command("week", "01.09.2026")
    assert chat.last.text.startswith("Эта неделя уже прошла")
    await chat.command("week", "999")
    assert chat.last.text.startswith("Так далеко не заглядываю")


@freeze_time(NOW)
async def test_a_button_from_a_past_week_shows_the_current_one(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    await chat.command("week")
    message = chat.last
    message.reply_markup = InlineKeyboardMarkup(
        inline_keyboard=[[handlers._button("‹ Пред. неделя", "wk:2026-09-14")]]
    )

    await chat.tap("‹ Пред. неделя")

    assert message.text.startswith("📅 <b>Эта неделя: 28 сен – 4 окт</b>")
    assert chat.buttons() == ["След. неделя ›"]


@freeze_time(NOW)
async def test_a_long_week_is_cut_to_fit_one_message(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    assert user.telegram_user_id is not None
    chat = FakeChat(user.telegram_user_id)
    for n in range(120):
        title = f"Задача номер {n} " + "очень длинная " * 6
        await _add_task(db_session, user, title, date(2026, 10, 2))

    await chat.command("week")

    text = chat.last.text
    assert len(text) <= week_agenda.MAX_WEEK_TEXT + 40
    shown = text.count("\n• ")
    left_out = int(text.rsplit("…и ещё ", 1)[1].split()[0])
    assert shown + left_out == 120
    assert text.endswith(f"…и ещё {left_out} {plural(left_out, 'задача', 'задачи', 'задач')}")


@pytest.mark.parametrize(
    ("count", "word"),
    [(1, "задача"), (2, "задачи"), (5, "задач"), (11, "задач"), (12, "задач"), (21, "задача")]
    + [(22, "задачи"), (111, "задач"), (104, "задачи")],
)
def test_plural(count: int, word: str) -> None:
    assert plural(count, "задача", "задачи", "задач") == word
