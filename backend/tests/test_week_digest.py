from datetime import UTC, date, datetime

from aiogram.types import InlineKeyboardMarkup
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.task import TaskCreate
from app.services import tasks as tasks_service
from app.services.reminder_dispatch import ReminderBlocked
from app.services.week_agenda import send_weekly_digests
from tests.conftest import csrf_token, login, make_user

# Monday 2026-10-05; users default to UTC and a 09:00 daily reminder time.
MONDAY_0859 = datetime(2026, 10, 5, 8, 59, tzinfo=UTC)
MONDAY_0900 = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)
MONDAY_2200 = datetime(2026, 10, 5, 22, 0, tzinfo=UTC)
TUESDAY_0900 = datetime(2026, 10, 6, 9, 0, tzinfo=UTC)
NEXT_MONDAY_0900 = datetime(2026, 10, 12, 9, 0, tzinfo=UTC)


class FakeTelegram:
    def __init__(self, fail_for: dict[int, Exception] | None = None) -> None:
        self.sent: list[tuple[int, str, InlineKeyboardMarkup]] = []
        self.fail_for = fail_for or {}

    async def __call__(self, chat_id: int, text: str, keyboard: InlineKeyboardMarkup) -> None:
        if chat_id in self.fail_for:
            raise self.fail_for[chat_id]
        self.sent.append((chat_id, text, keyboard))


async def test_sent_once_on_monday_at_the_reminder_time(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    await tasks_service.create_task(
        db_session, user.id, TaskCreate(title="Отчёт", due_date=date(2026, 10, 7))
    )
    telegram = FakeTelegram()

    assert await send_weekly_digests(db_session, telegram, now=MONDAY_0859) == 0
    assert await send_weekly_digests(db_session, telegram, now=MONDAY_0900) == 1
    assert await send_weekly_digests(db_session, telegram, now=MONDAY_2200) == 0
    assert await send_weekly_digests(db_session, telegram, now=TUESDAY_0900) == 0

    [(chat_id, text, keyboard)] = telegram.sent
    assert chat_id == user.telegram_chat_id
    assert text == "📅 <b>Эта неделя: 5–11 окт</b>\n\n<b>Ср, 7 окт</b>\n• Отчёт"
    assert [b.text for row in keyboard.inline_keyboard for b in row] == ["След. неделя ›"]

    assert await send_weekly_digests(db_session, telegram, now=NEXT_MONDAY_0900) == 1
    assert telegram.sent[1][1] == (
        "📅 <b>Эта неделя: 12–18 окт</b>\n\n"
        "⚠️ <b>Просрочено</b>\n• Отчёт — ср, 7 окт\n\n"
        "До конца недели задач нет."
    )


async def test_monday_in_the_users_own_timezone(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    user.timezone = "Asia/Novosibirsk"  # UTC+7
    await db_session.commit()
    telegram = FakeTelegram()

    # Sunday 23:30 UTC is Monday 06:30 in Novosibirsk: Monday, but before 09:00.
    sunday_night_utc = datetime(2026, 10, 4, 23, 30, tzinfo=UTC)
    assert await send_weekly_digests(db_session, telegram, now=sunday_night_utc) == 0
    # 02:00 UTC is 09:00 there.
    assert await send_weekly_digests(db_session, telegram, now=MONDAY_0900.replace(hour=2)) == 1
    # Monday 09:00 UTC is already Monday 16:00 there — no second one.
    assert await send_weekly_digests(db_session, telegram, now=MONDAY_0900) == 0


async def test_not_sent_when_turned_off_or_no_telegram(db_session: AsyncSession) -> None:
    off = await make_user(db_session, "off")
    off.weekly_digest_enabled = False
    muted = await make_user(db_session, "muted")
    muted.notifications_enabled = False
    await make_user(db_session, "unlinked", linked=False)
    await db_session.commit()
    telegram = FakeTelegram()

    assert await send_weekly_digests(db_session, telegram, now=MONDAY_0900) == 0
    assert telegram.sent == []


async def test_a_failed_send_isnt_retried_and_others_still_get_theirs(
    db_session: AsyncSession,
) -> None:
    blocked = await make_user(db_session, "blocked")
    broken = await make_user(db_session, "broken")
    fine = await make_user(db_session, "fine")
    # Read up front: the digest's rollback after a failure expires these objects.
    blocked_id, blocked_chat = blocked.id, blocked.telegram_chat_id
    broken_chat, fine_chat = broken.telegram_chat_id, fine.telegram_chat_id
    assert blocked_chat and broken_chat
    telegram = FakeTelegram({blocked_chat: ReminderBlocked(), broken_chat: RuntimeError()})

    assert await send_weekly_digests(db_session, telegram, now=MONDAY_0900) == 1
    assert [chat_id for chat_id, _, _ in telegram.sent] == [fine_chat]
    assert await send_weekly_digests(db_session, telegram, now=MONDAY_2200) == 0

    db_session.expire_all()
    reloaded = await db_session.get(User, blocked_id)
    assert reloaded is not None and reloaded.telegram_blocked is True


async def test_turned_off_in_settings(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    assert (await client.get("/api/v1/me")).json()["weekly_digest_enabled"] is True

    csrf = await csrf_token(client)
    response = await client.patch(
        "/api/v1/me", json={"weekly_digest_enabled": False}, headers={"x-csrf-token": csrf}
    )

    assert response.json()["weekly_digest_enabled"] is False
