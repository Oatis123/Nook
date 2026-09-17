from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_list(client: AsyncClient, name: str, **fields) -> dict:
    csrf = await csrf_token(client)
    body = {"name": name, **fields}
    response = await client.post("/api/v1/task-lists", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200, response.text
    return response.json()


async def _create_task(client: AsyncClient, title: str, **fields) -> dict:
    csrf = await csrf_token(client)
    body = {"title": title, **fields}
    response = await client.post("/api/v1/tasks", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200, response.text
    return response.json()


async def test_inbox_is_auto_created_and_cannot_be_deleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    listing = await client.get("/api/v1/task-lists")
    assert listing.status_code == 200
    inbox = next(item for item in listing.json() if item["is_inbox"])
    assert inbox["name"] == "Inbox"

    csrf = client.cookies.get("csrf_token")
    delete = await client.delete(
        f"/api/v1/task-lists/{inbox['id']}", headers={"x-csrf-token": csrf}
    )
    assert delete.status_code == 400


async def test_create_and_list_task_lists(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    await _create_list(client, "Work", color="palette-2", icon="briefcase")
    await _create_list(client, "Personal", color="palette-3", icon="home")

    listing = await client.get("/api/v1/task-lists")
    names = {item["name"] for item in listing.json()}
    assert names == {"Inbox", "Work", "Personal"}


async def test_update_task_list(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task_list = await _create_list(client, "Work")

    csrf = client.cookies.get("csrf_token")
    update = await client.patch(
        f"/api/v1/task-lists/{task_list['id']}",
        json={"name": "Job", "color": "palette-4", "icon": "code"},
        headers={"x-csrf-token": csrf},
    )
    assert update.status_code == 200
    assert update.json()["name"] == "Job"
    assert update.json()["color"] == "palette-4"
    assert update.json()["icon"] == "code"


async def test_archive_task_list(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task_list = await _create_list(client, "Old project")

    csrf = client.cookies.get("csrf_token")
    archived = await client.patch(
        f"/api/v1/task-lists/{task_list['id']}",
        json={"archived": True},
        headers={"x-csrf-token": csrf},
    )
    assert archived.json()["archived_at"] is not None

    unarchived = await client.patch(
        f"/api/v1/task-lists/{task_list['id']}",
        json={"archived": False},
        headers={"x-csrf-token": csrf},
    )
    assert unarchived.json()["archived_at"] is None


async def test_inbox_cannot_be_archived(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    listing = await client.get("/api/v1/task-lists")
    inbox = next(item for item in listing.json() if item["is_inbox"])

    csrf = client.cookies.get("csrf_token")
    response = await client.patch(
        f"/api/v1/task-lists/{inbox['id']}", json={"archived": True}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 400


async def test_delete_list_moves_tasks_to_inbox_by_default(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task_list = await _create_list(client, "Work")
    task = await _create_task(client, "Ship feature", list_id=task_list["id"])

    csrf = client.cookies.get("csrf_token")
    delete = await client.delete(
        f"/api/v1/task-lists/{task_list['id']}", headers={"x-csrf-token": csrf}
    )
    assert delete.status_code == 204

    moved = await client.get(f"/api/v1/tasks/{task['id']}")
    inbox = next(
        item for item in (await client.get("/api/v1/task-lists")).json() if item["is_inbox"]
    )
    assert moved.json()["list_id"] == inbox["id"]


async def test_delete_list_with_delete_tasks_removes_them(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task_list = await _create_list(client, "Work")
    task = await _create_task(client, "Ship feature", list_id=task_list["id"])

    csrf = client.cookies.get("csrf_token")
    delete = await client.delete(
        f"/api/v1/task-lists/{task_list['id']}",
        params={"delete_tasks": "true"},
        headers={"x-csrf-token": csrf},
    )
    assert delete.status_code == 204

    gone = await client.get(f"/api/v1/tasks/{task['id']}")
    assert gone.status_code == 404


async def test_task_list_isolation_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_list = await _create_list(client, "Alice's list")

    csrf_bob = await csrf_token(second_client)
    patch = await second_client.patch(
        f"/api/v1/task-lists/{alice_list['id']}",
        json={"name": "Hacked"},
        headers={"x-csrf-token": csrf_bob},
    )
    assert patch.status_code == 404

    delete = await second_client.delete(
        f"/api/v1/task-lists/{alice_list['id']}", headers={"x-csrf-token": csrf_bob}
    )
    assert delete.status_code == 404

    bob_listing = await second_client.get("/api/v1/task-lists")
    bob_names = {item["name"] for item in bob_listing.json()}
    assert bob_names == {"Inbox"}
