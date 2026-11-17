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


async def test_create_and_list_folders(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    await _create_folder(client, "Projects")
    await _create_folder(client, "Personal")

    listing = await client.get("/api/v1/folders")
    assert listing.status_code == 200
    names = {f["name"] for f in listing.json()}
    assert names == {"Projects", "Personal"}


async def test_rename_and_move_folder(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    parent = await _create_folder(client, "Parent")
    child = await _create_folder(client, "Child")

    csrf = client.cookies.get("csrf_token")
    move = await client.patch(
        f"/api/v1/folders/{child['id']}",
        json={"name": "Renamed", "parent_id": parent["id"]},
        headers={"x-csrf-token": csrf},
    )
    assert move.status_code == 200
    assert move.json()["name"] == "Renamed"
    assert move.json()["parent_id"] == parent["id"]


async def test_workspace_metadata_round_trip(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    headers = {"x-csrf-token": await csrf_token(client)}
    workspace = await client.post(
        "/api/v1/folders", json={"name": "Studio", "description": " First draft "}, headers=headers
    )
    assert workspace.status_code == 200
    assert workspace.json()["description"] == "First draft"
    workspace_id = workspace.json()["id"]
    child = await _create_folder(client, "Research", parent_id=workspace_id)
    note = await client.post(
        "/api/v1/notes", json={"title": "Brief", "folder_id": child["id"]}, headers=headers
    )
    note_id = note.json()["id"]
    url = f"/api/v1/folders/{workspace_id}"
    updated = await client.patch(
        url, json={"description": "Live project", "pinned_note_id": note_id}, headers=headers
    )
    assert updated.status_code == 200, updated.text
    folders = (await client.get("/api/v1/folders")).json()
    saved = next(folder for folder in folders if folder["id"] == workspace_id)
    assert saved["description"] == "Live project"
    assert saved["pinned_note_id"] == note_id

    cleared = await client.patch(
        url, json={"description": None, "pinned_note_id": None}, headers=headers
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["description"] is None
    assert cleared.json()["pinned_note_id"] is None


async def test_cannot_move_folder_into_itself_or_descendant(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    parent = await _create_folder(client, "Parent")
    child = await _create_folder(client, "Child", parent_id=parent["id"])

    csrf = client.cookies.get("csrf_token")
    into_self = await client.patch(
        f"/api/v1/folders/{parent['id']}",
        json={"parent_id": parent["id"]},
        headers={"x-csrf-token": csrf},
    )
    assert into_self.status_code == 400

    into_descendant = await client.patch(
        f"/api/v1/folders/{parent['id']}",
        json={"parent_id": child["id"]},
        headers={"x-csrf-token": csrf},
    )
    assert into_descendant.status_code == 400


async def test_delete_folder_cascades_to_subfolders_and_notes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    parent = await _create_folder(client, "Parent")
    child = await _create_folder(client, "Child", parent_id=parent["id"])
    csrf = client.cookies.get("csrf_token")
    note = await client.post(
        "/api/v1/notes",
        json={"title": "Note in child", "folder_id": child["id"]},
        headers={"x-csrf-token": csrf},
    )
    assert note.status_code == 200

    delete = await client.delete(f"/api/v1/folders/{parent['id']}", headers={"x-csrf-token": csrf})
    assert delete.status_code == 204

    listing = await client.get("/api/v1/folders")
    assert listing.json() == []

    trashed = await client.get("/api/v1/notes", params={"deleted": True})
    assert any(n["id"] == note.json()["id"] for n in trashed.json())


async def test_folder_isolation_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_folder = await _create_folder(client, "Alice's folder")

    csrf_bob = await csrf_token(second_client)
    patch = await second_client.patch(
        f"/api/v1/folders/{alice_folder['id']}",
        json={"name": "Hacked"},
        headers={"x-csrf-token": csrf_bob},
    )
    assert patch.status_code == 404

    delete = await second_client.delete(
        f"/api/v1/folders/{alice_folder['id']}", headers={"x-csrf-token": csrf_bob}
    )
    assert delete.status_code == 404

    bob_listing = await second_client.get("/api/v1/folders")
    assert bob_listing.json() == []
