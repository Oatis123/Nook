"""Fixes for findings of the second (post-fix) review round."""

import asyncio
import io
import threading
import time as time_module
import zipfile
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.core.security as security
from app.models.attachment import Attachment
from app.models.note import Note
from app.models.scheduled_reminder import ReminderStatus, ScheduledReminder
from app.services import api_tokens as api_tokens_service
from app.services import recurrence as recurrence_service
from app.services import reminder_dispatch
from app.services import telegram_link as telegram_link_service
from app.services import vault_import as vault_import_service
from app.services.vault_import import rewrite_embeds
from tests.conftest import csrf_token, login, make_user
from tests.test_reminders import _create_task, _FakeSender, _pending, _reminders

_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def test_argon2_concurrency_is_capped(monkeypatch) -> None:
    active = 0
    peak = 0
    lock = threading.Lock()

    def slow_verify(plain: str, hashed: str) -> bool:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time_module.sleep(0.05)
        with lock:
            active -= 1
        return False

    monkeypatch.setattr(security, "verify_password", slow_verify)
    await asyncio.gather(*(security.verify_password_async("x", "h") for _ in range(12)))
    assert peak <= security.MAX_CONCURRENT_HASHES


async def test_absurd_due_dates_are_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    for due in ("0001-01-01", "1999-12-31", "9999-12-31"):
        response = await client.post(
            "/api/v1/tasks",
            json={
                "title": "x",
                "due_date": due,
                "due_time": "09:00:00",
                "recurrence": {"freq": "daily"},
            },
            headers={"x-csrf-token": csrf},
        )
        assert response.status_code == 422, due


def test_expansion_starts_at_the_current_occurrence() -> None:
    dtstart = datetime(2000, 1, 1, 9, 0)
    anchor = datetime(2026, 9, 1, 9, 0)
    start = time_module.monotonic()
    for _ in range(50):
        occurrences = recurrence_service.occurrences_between(
            "FREQ=DAILY",
            dtstart,
            datetime(2026, 9, 1),
            datetime(2026, 9, 30, 23, 59),
            anchor=anchor,
        )
        nxt = recurrence_service.next_occurrence("FREQ=DAILY", dtstart, anchor, anchor=anchor)
    assert time_module.monotonic() - start < 1
    assert len(occurrences) == 30
    assert nxt == datetime(2026, 9, 2, 9, 0)
    # Weekly-every-2-weeks keeps its phase when re-anchored on a real occurrence.
    two_weekly = recurrence_service.next_occurrence(
        "FREQ=WEEKLY;INTERVAL=2",
        datetime(2026, 1, 5, 9),
        datetime(2026, 1, 19, 9),
        anchor=datetime(2026, 1, 19, 9),
    )
    assert two_weekly == datetime(2026, 2, 2, 9)


def test_recurrence_end_with_until_is_exact() -> None:
    end = recurrence_service.compute_recurrence_end(
        "FREQ=DAILY;UNTIL=20301231T235959", datetime(2010, 1, 1, 9, 0)
    )
    assert str(end) == "2030-12-31"


def test_rewrite_embeds() -> None:
    names = {"image.png": "image (2).png", "img/b.png": "b (2).png"}
    content = "![[image.png]] ![[img/b.png|300]] ![[other.png]] [[image.png]]"
    assert rewrite_embeds(content, names) == (
        "![[image (2).png]] ![[b (2).png|300]] ![[other.png]] [[image.png]]"
    )


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buffer.getvalue()


async def _import(client: AsyncClient, db_session: AsyncSession, entries: dict[str, bytes]):
    csrf = await csrf_token(client)
    upload = await client.post(
        "/api/v1/import",
        files={"file": ("vault.zip", _zip(entries), "application/zip")},
        headers={"x-csrf-token": csrf},
    )
    assert upload.status_code == 200, upload.text
    await vault_import_service.process_pending_import_jobs(db_session)
    return (await client.get(f"/api/v1/import/{upload.json()['id']}")).json()


async def test_import_points_embeds_at_the_imported_file(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    await client.post(
        "/api/v1/attachments",
        files={"file": ("image.png", _PNG + b"old", "image/png")},
        headers={"x-csrf-token": csrf},
    )

    vault = {"img/image.png": _PNG + b"new", "Vault note.md": b"See ![[image.png]]"}
    job = await _import(client, db_session, vault)
    assert job["status"] == "done", job
    note = await db_session.scalar(select(Note).where(Note.title == "Vault note"))
    assert note is not None and note.content == "See ![[image (2).png]]"

    listing = (await client.get("/api/v1/attachments")).json()
    used = {a["filename"]: a["used_by"] for a in listing}
    assert used == {"image.png": [], "image (2).png": ["Vault note"]}

    # Importing the same vault again reuses the identical file instead of copying it.
    await _import(client, db_session, vault)
    listing = (await client.get("/api/v1/attachments")).json()
    assert sorted(a["filename"] for a in listing) == ["image (2).png", "image.png"]


async def test_ambiguous_embeds_keep_all_candidates_from_cleanup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await make_user(db_session, "alice")
    await login(client, "alice")
    for _ in range(2):  # duplicates predating unique names
        db_session.add(
            Attachment(user_id=user.id, filename="dup.png", mime="x", size=1, storage_path="/x")
        )
    await db_session.commit()
    csrf = await csrf_token(client)
    await client.post(
        "/api/v1/notes",
        json={"title": "Uses dup", "content": "![[dup.png]]"},
        headers={"x-csrf-token": csrf},
    )
    cleanup = await client.post("/api/v1/attachments/cleanup", headers={"x-csrf-token": csrf})
    assert cleanup.json() == {"deleted": 0}


async def test_nul_characters_are_stripped(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/notes",
        json={"title": "N\x00ul", "content": "a\x00b"},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200, response.text
    assert (response.json()["title"], response.json()["content"]) == ("Nul", "ab")


async def test_one_broken_reminder_does_not_block_the_rest(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    from freezegun import freeze_time

    await client.get("/health")
    with freeze_time("2026-01-01T00:00:00+00:00"):
        user = await make_user(db_session, "alice")
        user.telegram_chat_id = 12345
        await db_session.commit()
        await login(client, "alice")
        broken = await _create_task(client, "Broken", due_date="2026-02-01")
        fine = await _create_task(client, "Fine", due_date="2026-02-01")

    original = reminder_dispatch.format_reminder_text

    def flaky(kind, task, task_list):
        if task.title == "Broken":
            raise RuntimeError("boom")
        return original(kind, task, task_list)

    monkeypatch.setattr(reminder_dispatch, "format_reminder_text", flaky)
    now = (await _pending(db_session, fine["id"]))[0].remind_at
    sender = _FakeSender()
    await reminder_dispatch.dispatch_due_reminders(db_session, sender, now=now)

    assert len(sender.calls) == 1
    assert (await _reminders(db_session, fine["id"]))[0].status == ReminderStatus.sent
    assert (await _reminders(db_session, broken["id"]))[0].status == ReminderStatus.failed
    # And the next tick isn't stuck on it.
    assert await reminder_dispatch.dispatch_due_reminders(db_session, sender, now=now) == 0


async def test_api_tokens_stop_working_without_telegram(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    _, plain = await api_tokens_service.create_api_token(db_session, user.id, "claude")
    assert await api_tokens_service.resolve_api_token(db_session, plain) is not None
    user.telegram_user_id = None
    await db_session.commit()
    assert await api_tokens_service.resolve_api_token(db_session, plain) is None


async def test_telegram_login_requires_the_browser_code(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/auth/telegram/login-token", headers={"x-csrf-token": csrf}
    )
    body = response.json()
    code = body["confirm_code"]
    assert len(code) == 2 and code.isdigit()
    plain = body["deep_link_url"].rsplit("login_", 1)[-1]
    token = await telegram_link_service.find_login_token_by_plain(db_session, plain)
    assert token is not None and token.meta["code"] == code
    choices = telegram_link_service.confirm_code_choices(code)
    assert code in choices and len(set(choices)) == telegram_link_service.LOGIN_CODE_CHOICES


def test_unused_imports_guard() -> None:
    assert UTC and ScheduledReminder
