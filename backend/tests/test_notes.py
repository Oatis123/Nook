from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_note(
    client: AsyncClient, title: str, folder_id: str | None = None, content: str = ""
) -> dict:
    csrf = await csrf_token(client)
    body: dict = {"title": title, "content": content}
    if folder_id is not None:
        body["folder_id"] = folder_id
    response = await client.post("/api/v1/notes", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200
    return response.json()


async def test_create_and_get_note(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    created = await _create_note(client, "My note", content="# Hello")
    assert created["version"] == 1

    fetched = await client.get(f"/api/v1/notes/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["content"] == "# Hello"


async def test_duplicate_title_in_same_folder_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Same title")

    csrf = client.cookies.get("csrf_token")
    response = await client.post(
        "/api/v1/notes", json={"title": "Same title"}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 409


async def test_update_note_optimistic_locking(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Versioned")
    csrf = client.cookies.get("csrf_token")

    first_edit = await client.patch(
        f"/api/v1/notes/{note['id']}",
        json={"version": 1, "content": "edit 1"},
        headers={"x-csrf-token": csrf},
    )
    assert first_edit.status_code == 200
    assert first_edit.json()["version"] == 2

    stale_edit = await client.patch(
        f"/api/v1/notes/{note['id']}",
        json={"version": 1, "content": "conflicting edit"},
        headers={"x-csrf-token": csrf},
    )
    assert stale_edit.status_code == 409


async def test_trash_lifecycle(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "To be trashed")
    csrf = client.cookies.get("csrf_token")

    delete = await client.delete(f"/api/v1/notes/{note['id']}", headers={"x-csrf-token": csrf})
    assert delete.status_code == 204

    active_listing = await client.get("/api/v1/notes")
    assert all(n["id"] != note["id"] for n in active_listing.json())

    trash_listing = await client.get("/api/v1/notes", params={"deleted": True})
    assert any(n["id"] == note["id"] for n in trash_listing.json())

    restore = await client.post(
        f"/api/v1/notes/{note['id']}/restore", headers={"x-csrf-token": csrf}
    )
    assert restore.status_code == 200
    assert restore.json()["deleted_at"] is None

    active_again = await client.get("/api/v1/notes")
    assert any(n["id"] == note["id"] for n in active_again.json())


async def test_permanent_delete_and_empty_trash(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note_a = await _create_note(client, "A")
    note_b = await _create_note(client, "B")
    csrf = client.cookies.get("csrf_token")

    await client.delete(f"/api/v1/notes/{note_a['id']}", headers={"x-csrf-token": csrf})
    await client.delete(f"/api/v1/notes/{note_b['id']}", headers={"x-csrf-token": csrf})

    permanent = await client.delete(
        f"/api/v1/notes/{note_a['id']}/permanent", headers={"x-csrf-token": csrf}
    )
    assert permanent.status_code == 204

    get_deleted = await client.get(f"/api/v1/notes/{note_a['id']}")
    assert get_deleted.status_code == 404

    empty = await client.post("/api/v1/notes/trash/empty", headers={"x-csrf-token": csrf})
    assert empty.status_code == 200
    assert empty.json()["deleted"] == 1

    trash_listing = await client.get("/api/v1/notes", params={"deleted": True})
    assert trash_listing.json() == []


async def test_note_isolation_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_note = await _create_note(client, "Alice's note")

    get_by_bob = await second_client.get(f"/api/v1/notes/{alice_note['id']}")
    assert get_by_bob.status_code == 404

    csrf_bob = await csrf_token(second_client)
    patch_by_bob = await second_client.patch(
        f"/api/v1/notes/{alice_note['id']}",
        json={"version": 1, "content": "hacked"},
        headers={"x-csrf-token": csrf_bob},
    )
    assert patch_by_bob.status_code == 404

    delete_by_bob = await second_client.delete(
        f"/api/v1/notes/{alice_note['id']}", headers={"x-csrf-token": csrf_bob}
    )
    assert delete_by_bob.status_code == 404

    bob_listing = await second_client.get("/api/v1/notes")
    assert bob_listing.json() == []
