from datetime import UTC, datetime

import pytest
from freezegun import freeze_time
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_reminder import ReminderKind, ReminderStatus
from app.services.recurrence import parse_rrule
from app.services.reminder_dispatch import dispatch_due_reminders
from app.services.reminders import reminder_label
from tests.conftest import login, make_user
from tests.test_reminders import _create_task, _FakeSender, _patch, _pending, _reminders


@pytest.fixture(autouse=True)
async def _app_built_before_freezing_time(client: AsyncClient) -> None:
    # The app's response schemas must be built outside freeze_time, whose fake `date`
    # pydantic can't generate a schema for (same as test_rereview_fixes).
    await client.get("/health")


async def test_custom_offsets_replace_the_default_reminders(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(
            client,
            "Dentist",
            due_date="2026-02-01",
            due_time="15:00:00",
            reminder_offsets=[15, 120, 15],
        )

    assert task["reminder_offsets"] == [120, 15]
    pending = await _pending(db_session, task["id"])
    assert sorted((r.kind, r.offset_minutes, r.remind_at) for r in pending) == [
        (ReminderKind.before, 15, datetime(2026, 2, 1, 14, 45, tzinfo=UTC)),
        (ReminderKind.before, 120, datetime(2026, 2, 1, 13, 0, tzinfo=UTC)),
    ]


async def test_changing_offsets_cancels_the_old_ones_and_default_brings_them_back(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Dentist", due_date="2026-02-01", due_time="15:00:00")
        url = f"/api/v1/tasks/{task['id']}"

        response = await _patch(client, url, reminder_offsets=[60])
        assert response.json()["reminder_offsets"] == [60]
        pending = await _pending(db_session, task["id"])
        assert [(r.kind, r.offset_minutes) for r in pending] == [(ReminderKind.before, 60)]

        await _patch(client, url, reminder_offsets=[])
        assert await _pending(db_session, task["id"]) == []

        response = await _patch(client, url, default_reminders=True)
        assert response.json()["reminder_offsets"] is None
        kinds = {r.kind for r in await _pending(db_session, task["id"])}
        assert kinds == {ReminderKind.day_before, ReminderKind.hour_before, ReminderKind.occurrence}


async def test_date_only_task_offsets_go_out_at_the_daily_reminder_time(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        # 15 minutes and 2 hours both round down to "on the day"; 2 days stays 2 days.
        task = await _create_task(
            client, "Rent", due_date="2026-02-10", reminder_offsets=[15, 120, 2880]
        )

    pending = await _pending(db_session, task["id"])
    assert sorted((r.offset_minutes, r.remind_at) for r in pending) == [
        (0, datetime(2026, 2, 10, 9, 0, tzinfo=UTC)),
        (2880, datetime(2026, 2, 8, 9, 0, tzinfo=UTC)),
    ]


async def test_recurring_task_offsets_chain_to_the_next_occurrence(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(
            client,
            "Standup",
            due_date="2026-01-02",
            due_time="09:00:00",
            recurrence={"freq": "daily"},
            reminder_offsets=[30],
        )

    [first] = await _pending(db_session, task["id"])
    assert first.remind_at == datetime(2026, 1, 2, 8, 30, tzinfo=UTC)

    sender = _FakeSender()
    await dispatch_due_reminders(db_session, sender, now=first.remind_at)
    assert sender.calls[0][1].startswith("Через 30 минут: Standup")

    rows = await _reminders(db_session, task["id"])
    [nxt] = [r for r in rows if r.status == ReminderStatus.pending]
    assert (nxt.kind, nxt.offset_minutes) == (ReminderKind.before, 30)
    assert nxt.remind_at == datetime(2026, 1, 3, 8, 30, tzinfo=UTC)


async def test_editing_an_overdue_recurring_task_keeps_its_next_reminder(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(
            client,
            "Standup",
            due_date="2026-01-02",
            due_time="09:00:00",
            recurrence={"freq": "daily"},
        )
    with freeze_time("2026-01-05T12:00:00+00:00"):
        await login(client, "alice")
        response = await _patch(client, f"/api/v1/tasks/{task['id']}", title="Daily standup")
        assert response.status_code == 200, response.text

    [pending] = await _pending(db_session, task["id"])
    assert pending.remind_at == datetime(2026, 1, 6, 9, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("offset", "timed", "label"),
    [
        (0, True, "Сейчас:"),
        (15, True, "Через 15 минут:"),
        (21, True, "Через 21 минуту:"),
        (60, True, "Через час:"),
        (120, True, "Через 2 часа:"),
        (90, True, "Через 1 ч 30 мин:"),
        (1440, True, "Завтра:"),
        (2880, True, "Через 2 дня:"),
        (0, False, "Сегодня:"),
        (1440, False, "Завтра:"),
        (7200, False, "Через 5 дней:"),
    ],
)
def test_reminder_labels(offset: int, timed: bool, label: str) -> None:
    assert reminder_label(ReminderKind.before, offset, timed=timed) == label


async def test_invalid_offsets_and_tags_are_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from tests.conftest import csrf_token

    await make_user(db_session, "alice")
    await login(client, "alice")
    headers = {"x-csrf-token": await csrf_token(client)}
    for body in (
        {"title": "x", "reminder_offsets": [-5]},
        {"title": "x", "reminder_offsets": list(range(11))},
        {"title": "x", "tags": ["two words"]},
        {"title": "x", "tags": ["1abc"]},
    ):
        response = await client.post("/api/v1/tasks", json=body, headers=headers)
        assert response.status_code == 422, body


async def test_tags_are_normalized_and_filterable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(client, "Fix tap", tags=["#home/repairs", "urgent", "urgent"])
    await _create_task(client, "Other")
    assert task["tags"] == ["home/repairs", "urgent"]

    response = await client.get("/api/v1/tasks", params={"tag": "urgent"})
    assert [t["title"] for t in response.json()] == ["Fix tap"]


def test_parse_rrule() -> None:
    weekly = parse_rrule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2")
    assert (weekly.freq, weekly.interval, weekly.by_weekday) == ("weekly", 2, [0, 2])
    monthly = parse_rrule("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=5")
    assert (monthly.on_last_day, monthly.end_type, monthly.end_count) == (True, "after_count", 5)
    until = parse_rrule("FREQ=DAILY;UNTIL=20270101T000000Z")
    assert (until.end_type, str(until.end_date)) == ("on_date", "2027-01-01")
    for bad in ("FREQ=HOURLY", "FREQ=DAILY;BYDAY=MO", "FREQ=WEEKLY;BYSETPOS=1", "nonsense"):
        with pytest.raises(ValueError):
            parse_rrule(bad)
