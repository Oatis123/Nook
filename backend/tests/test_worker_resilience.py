"""Reminder dispatch, recurrence and profile edge cases found in the pre-deploy review."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from freezegun import freeze_time
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_job import ImportJob, ImportJobStatus
from app.models.scheduled_reminder import ReminderKind, ReminderStatus
from app.services import vault_import as vault_import_service
from app.services.reminder_dispatch import dispatch_due_reminders
from app.services.reminders import purge_resolved_reminders
from bot import handlers as bot_handlers
from tests.conftest import login, make_user
from tests.test_reminders import _create_task, _FakeSender, _patch, _pending, _post, _reminders


@pytest.fixture(autouse=True)
async def _warm_up(client: AsyncClient) -> None:
    """The app builds some route schemas lazily on the first request; if that happens
    under freeze_time, pydantic sees freezegun's FakeDate instead of datetime.date."""
    await client.get("/health")


class _CrashOnSecond(_FakeSender):
    async def __call__(self, chat_id: int, text: str, url: str) -> None:
        self.calls.append((chat_id, text, url))
        if len(self.calls) == 2:
            raise KeyboardInterrupt  # stands in for the process dying mid-batch


async def test_crash_mid_batch_does_not_resend_already_sent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        first = await _create_task(client, "First", due_date="2026-02-01")
        second = await _create_task(client, "Second", due_date="2026-02-01")

    now = (await _pending(db_session, first["id"]))[0].remind_at
    with pytest.raises(KeyboardInterrupt):
        await dispatch_due_reminders(db_session, _CrashOnSecond(), now=now)
    await db_session.rollback()

    retry = _FakeSender()
    await dispatch_due_reminders(db_session, retry, now=now)
    # Only the reminder that was interrupted is sent again; the first stays sent.
    assert len(retry.calls) == 1
    statuses = [(await _reminders(db_session, t["id"]))[0].status for t in (first, second)]
    assert statuses == [ReminderStatus.sent, ReminderStatus.sent]


async def test_missed_recurring_reminder_still_schedules_next_future_one(
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

    # Worker was down for three days: the Jan 2 reminder is way past the catch-up window.
    now = datetime(2026, 1, 5, 12, 0, tzinfo=UTC)
    sender = _FakeSender()
    await dispatch_due_reminders(db_session, sender, now=now)

    assert sender.calls == []
    pending = await _pending(db_session, task["id"])
    assert len(pending) == 1
    assert pending[0].kind == ReminderKind.occurrence
    assert pending[0].remind_at == datetime(2026, 1, 6, 9, 0, tzinfo=UTC)


async def test_failed_recurring_reminder_still_schedules_next(
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

    now = (await _pending(db_session, task["id"]))[0].remind_at
    await dispatch_due_reminders(db_session, _FakeSender(blocked=True), now=now)
    pending = await _pending(db_session, task["id"])
    assert [p.remind_at for p in pending] == [datetime(2026, 1, 3, 9, 0, tzinfo=UTC)]


async def test_purge_keeps_pending_and_recent_rows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        sent = await _create_task(client, "Sent", due_date="2026-01-10")
        await _create_task(client, "Pending", due_date="2026-06-10")

    now = (await _pending(db_session, sent["id"]))[0].remind_at
    await dispatch_due_reminders(db_session, _FakeSender(), now=now)

    assert await purge_resolved_reminders(db_session, now=now + timedelta(days=1)) == 0
    assert await purge_resolved_reminders(db_session, now=now + timedelta(days=31)) == 1
    assert await _reminders(db_session, sent["id"]) == []


async def test_clearing_due_date_of_recurring_task_clears_recurrence(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client, "Standup", due_date="2030-01-02", due_time="09:00:00", recurrence={"freq": "daily"}
    )

    response = await _patch(client, f"/api/v1/tasks/{task['id']}", clear_due_date=True)
    assert response.status_code == 200, response.text
    assert response.json()["is_recurring"] is False

    completed = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    assert completed.status_code == 200, completed.text
    skipped = await _post(client, f"/api/v1/tasks/{task['id']}/skip")
    assert skipped.status_code == 400


async def test_moving_recurring_task_time_moves_the_series(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client, "Standup", due_date="2030-01-02", due_time="09:00:00", recurrence={"freq": "daily"}
    )

    await _patch(client, f"/api/v1/tasks/{task['id']}", due_time="10:30:00")
    completed = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    assert completed.status_code == 200
    body = completed.json()
    assert (body["due_date"], body["due_time"]) == ("2030-01-03", "10:30:00")


@pytest.mark.parametrize("payload", [{"timezone": "Mars/Base"}, {"timezone": "../etc/passwd"}])
async def test_unknown_timezone_is_rejected(
    client: AsyncClient, db_session: AsyncSession, payload: dict
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    response = await _patch(client, "/api/v1/me", **payload)
    assert response.status_code == 422


async def test_null_profile_fields_are_ignored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    response = await _patch(
        client,
        "/api/v1/me",
        timezone=None,
        daily_reminder_time=None,
        theme=None,
        notifications_enabled=None,
    )
    assert response.status_code == 200, response.text
    assert response.json()["timezone"] == "UTC"

    ok = await _patch(client, "/api/v1/me", timezone="Europe/Moscow")
    assert ok.json()["timezone"] == "Europe/Moscow"


async def test_interrupted_import_is_failed_on_worker_start(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await make_user(db_session, "alice")
    job = ImportJob(user_id=user.id, status=ImportJobStatus.processing)
    db_session.add(job)
    await db_session.commit()

    assert await vault_import_service.fail_interrupted_import_jobs(db_session) == 1
    await db_session.refresh(job)
    assert job.status == ImportJobStatus.failed
    assert job.report is not None
    assert "interrupted" in job.report["errors"][0]


async def test_bot_replies_when_quick_add_has_no_title(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    message = AsyncMock()

    async def boom(*_args: object) -> None:
        from app.schemas.task import TaskCreate

        TaskCreate(title="")

    original = bot_handlers._create_task_from_parsed
    bot_handlers._create_task_from_parsed = boom  # type: ignore[assignment]
    try:
        await bot_handlers._create_and_reply(message, user, None)  # type: ignore[arg-type]
    finally:
        bot_handlers._create_task_from_parsed = original
    message.answer.assert_awaited_once()
    assert "title" in message.answer.await_args.args[0]


def test_validation_hint_for_interval() -> None:
    from app.services.recurrence import RecurrenceInput

    with pytest.raises(ValidationError) as exc_info:
        RecurrenceInput(freq="daily", interval=0)
    assert "repeat rule" in bot_handlers._validation_hint(exc_info.value)
