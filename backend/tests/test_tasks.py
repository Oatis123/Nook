from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_list(client: AsyncClient, name: str) -> dict:
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/task-lists", json={"name": name}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200
    return response.json()


async def _create_task(client: AsyncClient, title: str, **fields) -> dict:
    csrf = await csrf_token(client)
    body = {"title": title, **fields}
    response = await client.post("/api/v1/tasks", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200, response.text
    return response.json()


async def _patch_task(client: AsyncClient, task_id: str, **fields) -> dict:
    csrf = client.cookies.get("csrf_token")
    response = await client.patch(
        f"/api/v1/tasks/{task_id}", json=fields, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_task_defaults_to_inbox(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(client, "Buy milk")

    inbox = next(
        item for item in (await client.get("/api/v1/task-lists")).json() if item["is_inbox"]
    )
    assert task["list_id"] == inbox["id"]
    assert task["status"] == "open"
    assert task["priority"] == "none"


async def test_create_task_in_explicit_list(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    work = await _create_list(client, "Work")
    task = await _create_task(client, "Ship feature", list_id=work["id"], priority="high")

    assert task["list_id"] == work["id"]
    assert task["priority"] == "high"


async def test_due_time_requires_due_date(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/tasks",
        json={"title": "Bad task", "due_time": "18:00:00"},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 400


async def test_subtask_inherits_parent_list_and_one_level_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    work = await _create_list(client, "Work")
    parent = await _create_task(client, "Launch", list_id=work["id"])
    child = await _create_task(client, "Write docs", parent_id=parent["id"])

    assert child["list_id"] == work["id"]
    assert child["parent_id"] == parent["id"]

    csrf = client.cookies.get("csrf_token")
    grandchild = await client.post(
        "/api/v1/tasks",
        json={"title": "Nested", "parent_id": child["id"]},
        headers={"x-csrf-token": csrf},
    )
    assert grandchild.status_code == 400


async def test_subtask_progress_reflected_on_parent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    parent = await _create_task(client, "Launch")
    child1 = await _create_task(client, "Task 1", parent_id=parent["id"])
    await _create_task(client, "Task 2", parent_id=parent["id"])

    csrf = client.cookies.get("csrf_token")
    await client.post(f"/api/v1/tasks/{child1['id']}/complete", headers={"x-csrf-token": csrf})

    listing = await client.get("/api/v1/tasks", params={"status": "all"})
    parent_row = next(t for t in listing.json() if t["id"] == parent["id"])
    assert parent_row["subtask_done_count"] == 1
    assert parent_row["subtask_total_count"] == 2

    detail = await client.get(f"/api/v1/tasks/{parent['id']}")
    assert len(detail.json()["subtasks"]) == 2
    assert detail.json()["subtask_done_count"] == 1


async def test_complete_parent_with_open_subtasks_requires_confirmation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    parent = await _create_task(client, "Launch")
    await _create_task(client, "Task 1", parent_id=parent["id"])

    csrf = client.cookies.get("csrf_token")
    blocked = await client.post(
        f"/api/v1/tasks/{parent['id']}/complete", headers={"x-csrf-token": csrf}
    )
    assert blocked.status_code == 409

    forced = await client.post(
        f"/api/v1/tasks/{parent['id']}/complete",
        json={"complete_subtasks": True},
        headers={"x-csrf-token": csrf},
    )
    assert forced.status_code == 200
    assert forced.json()["status"] == "done"

    detail = await client.get(f"/api/v1/tasks/{parent['id']}")
    assert all(s["status"] == "done" for s in detail.json()["subtasks"])


async def test_reopen_task(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(client, "Buy milk")
    csrf = client.cookies.get("csrf_token")
    await client.post(f"/api/v1/tasks/{task['id']}/complete", headers={"x-csrf-token": csrf})

    reopened = await client.post(
        f"/api/v1/tasks/{task['id']}/reopen", headers={"x-csrf-token": csrf}
    )
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["completed_at"] is None


async def test_update_task_fields_and_clear_due_date(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(client, "Buy milk", due_date="2026-01-01", due_time="09:00:00")

    updated = await _patch_task(client, task["id"], title="Buy oat milk", priority="low")
    assert updated["title"] == "Buy oat milk"
    assert updated["priority"] == "low"

    cleared = await _patch_task(client, task["id"], clear_due_date=True)
    assert cleared["due_date"] is None
    assert cleared["due_time"] is None


async def test_delete_task_cascades_to_subtasks(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    parent = await _create_task(client, "Launch")
    child = await _create_task(client, "Task 1", parent_id=parent["id"])

    csrf = client.cookies.get("csrf_token")
    delete = await client.delete(f"/api/v1/tasks/{parent['id']}", headers={"x-csrf-token": csrf})
    assert delete.status_code == 204

    assert (await client.get(f"/api/v1/tasks/{parent['id']}")).status_code == 404
    assert (await client.get(f"/api/v1/tasks/{child['id']}")).status_code == 404


async def test_list_view_filters_by_status_and_priority(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    work = await _create_list(client, "Work")
    open_high = await _create_task(client, "Open high", list_id=work["id"], priority="high")
    open_low = await _create_task(client, "Open low", list_id=work["id"], priority="low")
    done_task = await _create_task(client, "Done task", list_id=work["id"])
    csrf = client.cookies.get("csrf_token")
    await client.post(f"/api/v1/tasks/{done_task['id']}/complete", headers={"x-csrf-token": csrf})

    open_only = await client.get("/api/v1/tasks", params={"list_id": work["id"], "status": "open"})
    assert {t["id"] for t in open_only.json()} == {open_high["id"], open_low["id"]}

    done_only = await client.get("/api/v1/tasks", params={"list_id": work["id"], "status": "done"})
    assert {t["id"] for t in done_only.json()} == {done_task["id"]}

    high_priority = await client.get(
        "/api/v1/tasks", params={"list_id": work["id"], "status": "all", "priority": "high"}
    )
    assert {t["id"] for t in high_priority.json()} == {open_high["id"]}


async def test_today_view_shows_overdue_and_today_not_future(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    today = date.today()
    overdue = await _create_task(
        client, "Overdue", due_date=(today - timedelta(days=2)).isoformat()
    )
    due_today = await _create_task(client, "Due today", due_date=today.isoformat())
    future = await _create_task(client, "Future", due_date=(today + timedelta(days=5)).isoformat())
    await _create_task(client, "No date")

    response = await client.get("/api/v1/tasks", params={"view": "today"})
    ids = {t["id"] for t in response.json()}
    assert ids == {overdue["id"], due_today["id"]}
    assert future["id"] not in ids


async def test_upcoming_view_shows_future_not_past(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    today = date.today()
    await _create_task(client, "Overdue", due_date=(today - timedelta(days=2)).isoformat())
    due_today = await _create_task(client, "Due today", due_date=today.isoformat())
    future = await _create_task(client, "Future", due_date=(today + timedelta(days=5)).isoformat())

    response = await client.get("/api/v1/tasks", params={"view": "upcoming"})
    ids = {t["id"] for t in response.json()}
    assert ids == {due_today["id"], future["id"]}


async def test_task_isolation_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_task = await _create_task(client, "Alice's task")

    csrf_bob = await csrf_token(second_client)
    get_by_bob = await second_client.get(f"/api/v1/tasks/{alice_task['id']}")
    assert get_by_bob.status_code == 404

    patch_by_bob = await second_client.patch(
        f"/api/v1/tasks/{alice_task['id']}",
        json={"title": "Hacked"},
        headers={"x-csrf-token": csrf_bob},
    )
    assert patch_by_bob.status_code == 404

    complete_by_bob = await second_client.post(
        f"/api/v1/tasks/{alice_task['id']}/complete", headers={"x-csrf-token": csrf_bob}
    )
    assert complete_by_bob.status_code == 404

    delete_by_bob = await second_client.delete(
        f"/api/v1/tasks/{alice_task['id']}", headers={"x-csrf-token": csrf_bob}
    )
    assert delete_by_bob.status_code == 404

    bob_listing = await second_client.get("/api/v1/tasks")
    assert bob_listing.json() == []
