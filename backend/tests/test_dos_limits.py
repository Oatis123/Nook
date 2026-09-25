"""Limits that keep a single user from stalling or exhausting the API (pre-deploy review)."""

import io
import time
import zipfile
from datetime import date, datetime

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import Attachment
from app.services import recurrence as recurrence_service
from app.services import vault_import as vault_import_service
from app.services.recurrence import RecurrenceInput
from tests.conftest import csrf_token, login, make_user


async def _post(client: AsyncClient, url: str, json: dict):
    return await client.post(url, json=json, headers={"x-csrf-token": await csrf_token(client)})


def test_recurrence_count_and_end_date_are_bounded() -> None:
    with pytest.raises(ValidationError):
        RecurrenceInput(freq="daily", end_type="after_count", end_count=10**9)
    with pytest.raises(ValidationError):
        RecurrenceInput(freq="daily", end_type="on_date", end_date=date(9999, 12, 31))
    assert RecurrenceInput(freq="daily", end_type="after_count", end_count=1000).end_count == 1000


def test_expanding_a_huge_stored_rule_is_capped_and_fast() -> None:
    # Rules stored before the input limits existed must not stall the event loop either.
    start = time.monotonic()
    end = recurrence_service.compute_recurrence_end(
        "FREQ=DAILY;COUNT=1000000000", datetime(2026, 1, 1, 9, 0)
    )
    occurrences = recurrence_service.occurrences_between(
        "FREQ=DAILY", datetime(2026, 1, 1, 9, 0), datetime(2026, 1, 1), datetime(9999, 1, 1)
    )
    assert time.monotonic() - start < 2
    assert end is not None
    assert len(occurrences) == recurrence_service.MAX_EXPANDED_OCCURRENCES


async def test_calendar_range_is_limited(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    too_wide = await client.get("/api/v1/tasks/calendar?start=0001-01-01&end=9999-12-31")
    assert too_wide.status_code == 400
    backwards = await client.get("/api/v1/tasks/calendar?start=2026-02-01&end=2026-01-01")
    assert backwards.status_code == 400
    month = await client.get("/api/v1/tasks/calendar?start=2026-01-01&end=2026-01-31")
    assert month.status_code == 200


async def test_huge_count_task_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    response = await _post(
        client,
        "/api/v1/tasks",
        {
            "title": "Spam",
            "due_date": "2030-01-01",
            "due_time": "09:00:00",
            "recurrence": {"freq": "daily", "end_type": "after_count", "end_count": 10**9},
        },
    )
    assert response.status_code == 422


async def test_storage_quota(
    client: AsyncClient, db_session: AsyncSession, _isolated_attachments_dir, monkeypatch
) -> None:
    user = await make_user(db_session, "alice")
    await login(client, "alice")
    patched = _isolated_attachments_dir.model_copy(update={"max_storage_mb": 1})
    monkeypatch.setattr("app.services.attachments.get_settings", lambda: patched)
    db_session.add(
        Attachment(
            user_id=user.id, filename="big.bin", mime="x", size=1024 * 1024 - 10, storage_path=""
        )
    )
    await db_session.commit()

    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/attachments",
        files={"file": ("more.txt", b"x" * 100, "text/plain")},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "storage_quota_exceeded"


async def test_oversized_upload_is_413(
    client: AsyncClient, db_session: AsyncSession, _isolated_attachments_dir, monkeypatch
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    patched = _isolated_attachments_dir.model_copy(update={"max_upload_mb": 1})
    monkeypatch.setattr("app.services.attachments.get_settings", lambda: patched)

    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/attachments",
        files={"file": ("big.bin", b"x" * (1024 * 1024 + 1), "application/octet-stream")},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buffer.getvalue()


async def _upload_zip(client: AsyncClient, data: bytes):
    return await client.post(
        "/api/v1/import",
        files={"file": ("vault.zip", data, "application/zip")},
        headers={"x-csrf-token": await csrf_token(client)},
    )


async def test_one_import_at_a_time(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    first = await _upload_zip(client, _zip({"a.md": b"a"}))
    assert first.status_code == 200
    second = await _upload_zip(client, _zip({"b.md": b"b"}))
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "import_in_progress"


async def test_import_skips_oversized_entries_before_reading(
    client: AsyncClient, db_session: AsyncSession, _isolated_attachments_dir, monkeypatch
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    patched = _isolated_attachments_dir.model_copy(update={"max_upload_mb": 1})
    monkeypatch.setattr("app.services.attachments.get_settings", lambda: patched)
    monkeypatch.setattr("app.services.vault_import.get_settings", lambda: patched)

    zeros = b"\0" * (3 * 1024 * 1024)  # compresses to a few KB
    upload = await _upload_zip(
        client, _zip({"bomb.bin": zeros, "huge.md": zeros, "fine.md": b"fine"})
    )
    assert upload.status_code == 200, upload.text

    def fail_read(*_args, **_kwargs):
        raise AssertionError("oversized entry was read")

    original_read = zipfile.ZipFile.read

    def guarded_read(self, name, pwd=None):
        info = name if isinstance(name, zipfile.ZipInfo) else self.getinfo(name)
        if info.file_size > 1024 * 1024:
            fail_read()
        return original_read(self, name, pwd)

    monkeypatch.setattr(zipfile.ZipFile, "read", guarded_read)
    await vault_import_service.process_pending_import_jobs(db_session)
    job = (await client.get(f"/api/v1/import/{upload.json()['id']}")).json()
    assert job["report"]["notes_imported"] == 1
    assert len(job["report"]["errors"]) == 2


async def test_export_is_streamed_and_skips_missing_files(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await make_user(db_session, "alice")
    await login(client, "alice")
    db_session.add(
        Attachment(
            user_id=user.id, filename="gone.png", mime="image/png", size=1, storage_path="/nope"
        )
    )
    await db_session.commit()
    await _post(client, "/api/v1/notes", {"title": "Kept", "content": "text"})

    response = await client.get("/api/v1/notes/export")
    assert response.status_code == 200
    assert zipfile.ZipFile(io.BytesIO(response.content)).namelist() == ["Kept.md"]


async def test_note_content_size_is_limited(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    response = await _post(client, "/api/v1/notes", {"title": "Huge", "content": "x" * 500_001})
    assert response.status_code == 422
