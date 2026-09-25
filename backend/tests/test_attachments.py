import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.attachments as attachments_service
from app.core.config import get_settings
from tests.conftest import csrf_token, login, make_user

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def _upload(client: AsyncClient, filename: str, data: bytes) -> dict:
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/attachments",
        files={"file": (filename, data, "application/octet-stream")},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200
    return response.json()


async def test_upload_and_list_attachment(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    uploaded = await _upload(client, "notes.txt", b"hello world")
    assert uploaded["filename"] == "notes.txt"
    assert uploaded["size"] == len(b"hello world")
    assert uploaded["used_by"] == []

    listing = await client.get("/api/v1/attachments")
    assert listing.status_code == 200
    assert [a["id"] for a in listing.json()] == [uploaded["id"]]


async def test_mime_detected_from_content_not_filename(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    png = await _upload(client, "picture.bin", _PNG_MAGIC)
    assert png["mime"] == "image/png"

    text_file = await _upload(client, "note.md", b"# Heading\nsome content")
    assert text_file["mime"] == "text/markdown"

    plain = await _upload(client, "readme", b"just plain text")
    assert plain["mime"] == "text/plain"


async def test_upload_over_size_limit_rejected(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    small_limit = get_settings().model_copy(update={"max_upload_mb": 1})
    monkeypatch.setattr(attachments_service, "get_settings", lambda: small_limit)

    oversized = b"x" * (2 * 1024 * 1024)
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/attachments",
        files={"file": ("big.bin", oversized, "application/octet-stream")},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 413


async def test_download_attachment(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    uploaded = await _upload(client, "notes.txt", b"hello world")

    response = await client.get(f"/api/v1/attachments/{uploaded['id']}/download")
    assert response.status_code == 200
    assert response.content == b"hello world"


async def test_delete_attachment(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    uploaded = await _upload(client, "notes.txt", b"hello world")
    csrf = client.cookies.get("csrf_token")

    response = await client.delete(
        f"/api/v1/attachments/{uploaded['id']}", headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 204

    listing = await client.get("/api/v1/attachments")
    assert listing.json() == []

    download = await client.get(f"/api/v1/attachments/{uploaded['id']}/download")
    assert download.status_code == 404


async def test_attachment_used_by_tracks_embedding_notes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    uploaded = await _upload(client, "diagram.png", _PNG_MAGIC)

    csrf = await csrf_token(client)
    await client.post(
        "/api/v1/notes",
        json={"title": "With embed", "content": "See ![[diagram.png]] below"},
        headers={"x-csrf-token": csrf},
    )

    listing = await client.get("/api/v1/attachments")
    attachment = next(a for a in listing.json() if a["id"] == uploaded["id"])
    assert attachment["used_by"] == ["With embed"]


async def test_cleanup_deletes_only_unused_attachments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    used = await _upload(client, "used.png", _PNG_MAGIC)
    unused = await _upload(client, "unused.png", _PNG_MAGIC[::-1] + b"\x01")

    csrf = await csrf_token(client)
    await client.post(
        "/api/v1/notes",
        json={"title": "Keeper", "content": "![[used.png]]"},
        headers={"x-csrf-token": csrf},
    )

    cleanup = await client.post("/api/v1/attachments/cleanup", headers={"x-csrf-token": csrf})
    assert cleanup.status_code == 200
    assert cleanup.json() == {"deleted": 1}

    listing = await client.get("/api/v1/attachments")
    remaining_ids = {a["id"] for a in listing.json()}
    assert remaining_ids == {used["id"]}
    assert unused["id"] not in remaining_ids


async def test_attachment_isolation_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_upload = await _upload(client, "secret.txt", b"alice's data")

    bob_listing = await second_client.get("/api/v1/attachments")
    assert bob_listing.json() == []

    bob_download = await second_client.get(f"/api/v1/attachments/{alice_upload['id']}/download")
    assert bob_download.status_code == 404

    csrf_bob = await csrf_token(second_client)
    bob_delete = await second_client.delete(
        f"/api/v1/attachments/{alice_upload['id']}", headers={"x-csrf-token": csrf_bob}
    )
    assert bob_delete.status_code == 404


async def test_duplicate_filenames_are_numbered(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    names = [(await _upload(client, "image.png", _PNG_MAGIC))["filename"] for _ in range(3)]
    assert names == ["image.png", "image (2).png", "image (3).png"]


async def test_overlong_filename_is_clipped_keeping_extension(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    uploaded = await _upload(client, "a" * 300 + ".png", _PNG_MAGIC)
    assert len(uploaded["filename"]) == 255
    assert uploaded["filename"].endswith(".png")
