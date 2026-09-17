import uuid
from datetime import UTC, datetime, timedelta

from freezegun import freeze_time
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_reminder import ReminderKind, ReminderStatus, ScheduledReminder
from app.models.user import User
from app.services.reminder_dispatch import ReminderBlocked, dispatch_due_reminders
from tests.conftest import csrf_token, login, make_user


async def _create_task(client: AsyncClient, title: str, **fields: object) -> dict:
    csrf = await csrf_token(client)
    body = {"title": title, **fields}
    response = await client.post("/api/v1/tasks", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200, response.text
    return response.json()


async def _post(client: AsyncClient, url: str, **json_body: object) -> Response:
    csrf = client.cookies.get("csrf_token")
    return await client.post(url, json=json_body or None, headers={"x-csrf-token": csrf})


async def _patch(client: AsyncClient, url: str, **json_body: object) -> Response:
    csrf = client.cookies.get("csrf_token")
    return await client.patch(url, json=json_body, headers={"x-csrf-token": csrf})


async def _reminders(session: AsyncSession, task_id: str) -> list[ScheduledReminder]:
    result = await session.scalars(
        select(ScheduledReminder)
        .where(ScheduledReminder.task_id == uuid.UUID(task_id))
        .order_by(ScheduledReminder.kind)
    )
    return list(result)


async def _pending(session: AsyncSession, task_id: str) -> list[ScheduledReminder]:
    return [r for r in await _reminders(session, task_id) if r.status == ReminderStatus.pending]


class _FakeSender:
    """Stands in for the real Telegram-sending closure in worker/main.py, so dispatch's
    send/retry/backoff/blocked logic can be tested without a live Bot."""

    def __init__(self, *, fail_times: int = 0, blocked: bool = False) -> None:
        self.calls: list[tuple[int, str, str]] = []
        self.fail_times = fail_times
        self.blocked = blocked

    async def __call__(self, chat_id: int, text: str, url: str) -> None:
        self.calls.append((chat_id, text, url))
        if self.blocked:
            raise ReminderBlocked
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("network error")


# --- spec §8.2 table: which reminders a task should get ---


async def test_no_due_date_means_no_reminders(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(client, "Someday")
    assert await _pending(db_session, task["id"]) == []


async def test_date_only_schedules_day_before_reminder(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    pending = await _pending(db_session, task["id"])
    assert len(pending) == 1
    assert pending[0].kind == ReminderKind.day_before
    # default user timezone UTC, default daily_reminder_time 09:00
    assert pending[0].remind_at == datetime(2026, 1, 31, 9, 0, tzinfo=UTC)


async def test_date_and_time_schedules_day_before_and_hour_before(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Dentist", due_date="2026-02-01", due_time="15:00:00")

    by_kind = {r.kind: r for r in await _pending(db_session, task["id"])}
    assert set(by_kind) == {ReminderKind.day_before, ReminderKind.hour_before}
    assert by_kind[ReminderKind.day_before].remind_at == datetime(2026, 1, 31, 9, 0, tzinfo=UTC)
    assert by_kind[ReminderKind.hour_before].remind_at == datetime(2026, 2, 1, 14, 0, tzinfo=UTC)


async def test_recurring_task_schedules_single_occurrence_reminder(
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

    pending = await _pending(db_session, task["id"])
    assert len(pending) == 1
    assert pending[0].kind == ReminderKind.occurrence
    assert pending[0].remind_at == datetime(2026, 1, 2, 9, 0, tzinfo=UTC)


# --- past moments: no catch-up messages at creation/modification time ---


async def test_reminder_already_in_past_is_not_scheduled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-02-01T10:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        # Due today at 9am: hour_before (8am) and day_before (yesterday 9am) are both
        # already in the past relative to "now" (10am today) -> neither is scheduled.
        task = await _create_task(client, "Already due", due_date="2026-02-01", due_time="09:00:00")

    assert await _pending(db_session, task["id"]) == []


# --- timezone / daily_reminder_time changes recompute ---


async def test_changing_timezone_recomputes_pending_reminders(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")
        assert (await _pending(db_session, task["id"]))[0].remind_at == datetime(
            2026, 1, 31, 9, 0, tzinfo=UTC
        )

        resp = await _patch(client, "/api/v1/me", timezone="America/New_York")
        assert resp.status_code == 200

    pending = await _pending(db_session, task["id"])
    assert len(pending) == 1
    # 9am America/New_York on Jan 31 is standard time (EST, UTC-5) -> 14:00 UTC.
    assert pending[0].remind_at == datetime(2026, 1, 31, 14, 0, tzinfo=UTC)


# --- DST: zoneinfo, not a fixed offset, must drive the UTC conversion ---


async def test_dst_transition_uses_correct_utc_offset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.timezone = "America/New_York"
        await db_session.commit()
        await login(client, "alice")

        # US DST starts 2026-03-08. One task due just before it, one just after.
        before_dst = await _create_task(
            client, "Before DST", due_date="2026-03-01", due_time="09:00:00"
        )
        after_dst = await _create_task(
            client, "After DST", due_date="2026-03-20", due_time="09:00:00"
        )

    before_hour = next(
        r
        for r in await _pending(db_session, before_dst["id"])
        if r.kind == ReminderKind.hour_before
    )
    after_hour = next(
        r for r in await _pending(db_session, after_dst["id"]) if r.kind == ReminderKind.hour_before
    )
    # EST (UTC-5) before the transition, EDT (UTC-4) after it.
    assert before_hour.remind_at == datetime(2026, 3, 1, 13, 0, tzinfo=UTC)
    assert after_hour.remind_at == datetime(2026, 3, 20, 12, 0, tzinfo=UTC)


# --- completing / skipping a recurring task advances its reminder ---


async def test_completing_recurring_task_schedules_next_occurrence_reminder(
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
        completed = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
        assert completed.status_code == 200
        assert completed.json()["due_date"] == "2026-01-03"

    all_rows = await _reminders(db_session, task["id"])
    assert len(all_rows) == 2
    pending = [r for r in all_rows if r.status == ReminderStatus.pending]
    assert len(pending) == 1
    assert pending[0].remind_at == datetime(2026, 1, 3, 9, 0, tzinfo=UTC)


async def test_skipping_recurring_task_schedules_next_occurrence_reminder(
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
        skipped = await _post(client, f"/api/v1/tasks/{task['id']}/skip")
        assert skipped.status_code == 200
        assert skipped.json()["due_date"] == "2026-01-03"

    pending = await _pending(db_session, task["id"])
    assert len(pending) == 1
    assert pending[0].remind_at == datetime(2026, 1, 3, 9, 0, tzinfo=UTC)


# --- changing due date, and idempotency (no duplicates) ---


async def test_changing_due_date_cancels_old_and_creates_new_reminder(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")
        updated = await _patch(client, f"/api/v1/tasks/{task['id']}", due_date="2026-02-10")
        assert updated.status_code == 200

    all_rows = await _reminders(db_session, task["id"])
    assert len(all_rows) == 2
    assert sum(r.status == ReminderStatus.cancelled for r in all_rows) == 1
    pending = [r for r in all_rows if r.status == ReminderStatus.pending]
    assert len(pending) == 1
    assert pending[0].remind_at == datetime(2026, 2, 9, 9, 0, tzinfo=UTC)


async def test_recompute_without_change_does_not_duplicate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")
        # update_task recomputes unconditionally; editing an unrelated field must not
        # duplicate the (task_id, occurrence_at, kind) row the unique index protects.
        updated = await _patch(client, f"/api/v1/tasks/{task['id']}", title="Pay rent (updated)")
        assert updated.status_code == 200, updated.text

    all_rows = await _reminders(db_session, task["id"])
    assert len(all_rows) == 1
    assert all_rows[0].status == ReminderStatus.pending


# --- reminders_enabled / completion / deletion cancel pending reminders ---


async def test_disabling_reminders_cancels_pending_then_reenabling_recomputes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

        disabled = await _patch(client, f"/api/v1/tasks/{task['id']}", reminders_enabled=False)
        assert disabled.status_code == 200
        assert await _pending(db_session, task["id"]) == []

        reenabled = await _patch(client, f"/api/v1/tasks/{task['id']}", reminders_enabled=True)
        assert reenabled.status_code == 200

    assert len(await _pending(db_session, task["id"])) == 1


async def test_completing_task_cancels_pending_reminders(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")
        completed = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
        assert completed.status_code == 200

    assert await _pending(db_session, task["id"]) == []


async def test_deleting_task_cancels_pending_reminders(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        await make_user(db_session, "alice")
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")
        csrf = client.cookies.get("csrf_token")
        deleted = await client.delete(f"/api/v1/tasks/{task['id']}", headers={"x-csrf-token": csrf})
        assert deleted.status_code == 204

    assert await _pending(db_session, task["id"]) == []


# --- worker dispatch: send, catch-up window, retry/backoff, blocked bot ---


async def test_dispatch_sends_due_reminder_and_marks_sent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    remind_at = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender()
    count = await dispatch_due_reminders(db_session, sender, now=remind_at)

    assert count == 1
    assert len(sender.calls) == 1
    assert "Tomorrow:" in sender.calls[0][1]
    assert (await _reminders(db_session, task["id"]))[0].status == ReminderStatus.sent


async def test_worker_sends_within_catchup_window(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    remind_at = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender()
    await dispatch_due_reminders(db_session, sender, now=remind_at + timedelta(minutes=10))

    assert len(sender.calls) == 1
    assert (await _reminders(db_session, task["id"]))[0].status == ReminderStatus.sent


async def test_worker_cancels_reminder_past_catchup_window(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    remind_at = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender()
    await dispatch_due_reminders(db_session, sender, now=remind_at + timedelta(minutes=16))

    assert sender.calls == []
    assert (await _reminders(db_session, task["id"]))[0].status == ReminderStatus.cancelled


async def test_send_failure_retries_with_backoff_then_fails(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    now = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender(fail_times=99)

    await dispatch_due_reminders(db_session, sender, now=now)
    row = (await _reminders(db_session, task["id"]))[0]
    assert row.status == ReminderStatus.pending
    assert row.attempts == 1
    assert row.remind_at == now + timedelta(minutes=1)

    now = row.remind_at
    await dispatch_due_reminders(db_session, sender, now=now)
    row = (await _reminders(db_session, task["id"]))[0]
    assert row.status == ReminderStatus.pending
    assert row.attempts == 2
    assert row.remind_at == now + timedelta(minutes=2)

    now = row.remind_at
    await dispatch_due_reminders(db_session, sender, now=now)
    row = (await _reminders(db_session, task["id"]))[0]
    assert row.status == ReminderStatus.failed
    assert row.attempts == 3
    assert len(sender.calls) == 3


async def test_blocked_bot_marks_user_blocked_and_reminder_failed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    remind_at = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender(blocked=True)
    await dispatch_due_reminders(db_session, sender, now=remind_at)

    assert (await _reminders(db_session, task["id"]))[0].status == ReminderStatus.failed
    refreshed = await db_session.get(User, user.id)
    assert refreshed is not None
    assert refreshed.telegram_blocked is True


async def test_reminder_stays_pending_when_notifications_disabled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        user.notifications_enabled = False
        await db_session.commit()
        await login(client, "alice")
        task = await _create_task(client, "Pay rent", due_date="2026-02-01")

    remind_at = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender()
    await dispatch_due_reminders(db_session, sender, now=remind_at)

    assert sender.calls == []
    assert (await _reminders(db_session, task["id"]))[0].status == ReminderStatus.pending


async def test_sending_recurring_occurrence_reminder_schedules_next_one(
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
        )

    remind_at = (await _pending(db_session, task["id"]))[0].remind_at
    sender = _FakeSender()
    await dispatch_due_reminders(db_session, sender, now=remind_at)

    rows = await _reminders(db_session, task["id"])
    sent = [r for r in rows if r.status == ReminderStatus.sent]
    pending = [r for r in rows if r.status == ReminderStatus.pending]
    assert len(sent) == 1
    assert len(pending) == 1
    assert pending[0].kind == ReminderKind.occurrence
    assert pending[0].remind_at == datetime(2026, 1, 3, 9, 0, tzinfo=UTC)
