from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_note(client: AsyncClient, title: str) -> dict:
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/notes", json={"title": title}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200
    return response.json()


async def _create_task(client: AsyncClient, title: str) -> dict:
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/tasks", json={"title": title}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200
    return response.json()


async def test_link_note_to_task_appears_on_both_sides(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Project plan")
    task = await _create_task(client, "Write spec")

    csrf = client.cookies.get("csrf_token")
    link = await client.post(
        f"/api/v1/tasks/{task['id']}/notes",
        json={"note_id": note["id"]},
        headers={"x-csrf-token": csrf},
    )
    assert link.status_code == 204

    task_detail = await client.get(f"/api/v1/tasks/{task['id']}")
    assert task_detail.json()["linked_notes"] == [
        {"id": note["id"], "title": "Project plan", "folder_id": None}
    ]

    note_detail = await client.get(f"/api/v1/notes/{note['id']}")
    linked = note_detail.json()["linked_tasks"]
    assert len(linked) == 1
    assert linked[0]["id"] == task["id"]
    assert linked[0]["status"] == "open"


async def test_linking_is_idempotent(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Notes")
    task = await _create_task(client, "Task")
    csrf = client.cookies.get("csrf_token")

    for _ in range(2):
        response = await client.post(
            f"/api/v1/tasks/{task['id']}/notes",
            json={"note_id": note["id"]},
            headers={"x-csrf-token": csrf},
        )
        assert response.status_code == 204

    task_detail = await client.get(f"/api/v1/tasks/{task['id']}")
    assert len(task_detail.json()["linked_notes"]) == 1


async def test_unlink_note_from_task(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Notes")
    task = await _create_task(client, "Task")
    csrf = client.cookies.get("csrf_token")
    await client.post(
        f"/api/v1/tasks/{task['id']}/notes",
        json={"note_id": note["id"]},
        headers={"x-csrf-token": csrf},
    )

    unlink = await client.delete(
        f"/api/v1/tasks/{task['id']}/notes/{note['id']}", headers={"x-csrf-token": csrf}
    )
    assert unlink.status_code == 204

    task_detail = await client.get(f"/api/v1/tasks/{task['id']}")
    assert task_detail.json()["linked_notes"] == []

    note_detail = await client.get(f"/api/v1/notes/{note['id']}")
    assert note_detail.json()["linked_tasks"] == []


async def test_new_task_from_note_creates_and_links(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Meeting notes")
    csrf = await csrf_token(client)

    response = await client.post(
        f"/api/v1/notes/{note['id']}/tasks",
        json={"title": "Follow up with team"},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200
    task = response.json()
    assert task["title"] == "Follow up with team"

    note_detail = await client.get(f"/api/v1/notes/{note['id']}")
    linked = note_detail.json()["linked_tasks"]
    assert len(linked) == 1
    assert linked[0]["id"] == task["id"]


async def test_linked_tasks_exclude_deleted(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Notes")
    task = await _create_task(client, "Task")
    csrf = client.cookies.get("csrf_token")
    await client.post(
        f"/api/v1/tasks/{task['id']}/notes",
        json={"note_id": note["id"]},
        headers={"x-csrf-token": csrf},
    )

    await client.delete(f"/api/v1/tasks/{task['id']}", headers={"x-csrf-token": csrf})

    note_detail = await client.get(f"/api/v1/notes/{note['id']}")
    assert note_detail.json()["linked_tasks"] == []


async def test_link_note_to_task_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_note = await _create_note(client, "Alice's note")
    bob_task = await _create_task(second_client, "Bob's task")

    csrf_bob = await csrf_token(second_client)
    cross_link = await second_client.post(
        f"/api/v1/tasks/{bob_task['id']}/notes",
        json={"note_id": alice_note["id"]},
        headers={"x-csrf-token": csrf_bob},
    )
    assert cross_link.status_code == 404


async def test_cannot_link_note_to_another_users_task(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_task = await _create_task(client, "Alice's task")
    bob_note = await _create_note(second_client, "Bob's note")

    csrf_bob = await csrf_token(second_client)
    cross_link = await second_client.post(
        f"/api/v1/tasks/{alice_task['id']}/notes",
        json={"note_id": bob_note["id"]},
        headers={"x-csrf-token": csrf_bob},
    )
    assert cross_link.status_code == 404


async def test_new_task_from_others_note_rejected(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_note = await _create_note(client, "Alice's note")
    csrf_bob = await csrf_token(second_client)

    response = await second_client.post(
        f"/api/v1/notes/{alice_note['id']}/tasks",
        json={"title": "Sneaky task"},
        headers={"x-csrf-token": csrf_bob},
    )
    assert response.status_code == 404
