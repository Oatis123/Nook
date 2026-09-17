import io
import zipfile

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_folder(client: AsyncClient, name: str, parent_id: str | None = None) -> dict:
    csrf = await csrf_token(client)
    body: dict = {"name": name}
    if parent_id is not None:
        body["parent_id"] = parent_id
    response = await client.post("/api/v1/folders", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200
    return response.json()


async def _create_note(
    client: AsyncClient, title: str, content: str, folder_id: str | None = None
) -> dict:
    csrf = await csrf_token(client)
    body: dict = {"title": title, "content": content}
    if folder_id is not None:
        body["folder_id"] = folder_id
    response = await client.post("/api/v1/notes", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200
    return response.json()


async def test_export_single_note_returns_raw_markdown(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    content = "---\ntags: [work]\n---\n\nHello [[Other Note]]."
    note = await _create_note(client, "My Note", content)

    response = await client.get(f"/api/v1/notes/{note['id']}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert response.content.decode("utf-8") == content


async def test_export_vault_zip_contains_folder_structure(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    work = await _create_folder(client, "Work")
    await _create_note(client, "Root note", "Root content")
    await _create_note(client, "Nested note", "Nested content", folder_id=work["id"])

    response = await client.get("/api/v1/notes/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        names = set(zf.namelist())
        assert "Root note.md" in names
        assert "Work/Nested note.md" in names
        assert zf.read("Root note.md").decode("utf-8") == "Root content"
        assert zf.read("Work/Nested note.md").decode("utf-8") == "Nested content"


async def test_export_vault_includes_attachments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    upload = await client.post(
        "/api/v1/attachments",
        files={"file": ("photo.png", b"\x89PNG\r\n\x1a\nfakepngbytes", "image/png")},
        headers={"x-csrf-token": csrf},
    )
    assert upload.status_code == 200

    response = await client.get("/api/v1/notes/export")
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        assert "attachments/photo.png" in zf.namelist()
        assert zf.read("attachments/photo.png") == b"\x89PNG\r\n\x1a\nfakepngbytes"


async def test_export_is_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    await _create_note(client, "Alice's note", "secret")

    csrf_bob = await csrf_token(second_client)
    response = await second_client.get("/api/v1/notes/export", headers={"x-csrf-token": csrf_bob})
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        assert "Alice's note.md" not in zf.namelist()


async def test_deleted_notes_are_excluded_from_export(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Trashed", "gone")

    csrf = client.cookies.get("csrf_token")
    await client.delete(f"/api/v1/notes/{note['id']}", headers={"x-csrf-token": csrf})

    response = await client.get("/api/v1/notes/export")
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        assert "Trashed.md" not in zf.namelist()
