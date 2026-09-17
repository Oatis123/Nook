from datetime import date, timedelta

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_task(client: AsyncClient, title: str, **fields) -> dict:
    csrf = await csrf_token(client)
    body = {"title": title, **fields}
    response = await client.post("/api/v1/tasks", json=body, headers={"x-csrf-token": csrf})
    assert response.status_code == 200, response.text
    return response.json()


async def _post(client: AsyncClient, url: str, **json_body: object) -> Response:
    csrf = client.cookies.get("csrf_token")
    return await client.post(url, json=json_body or None, headers={"x-csrf-token": csrf})


async def test_create_recurring_task_requires_due_date_and_time(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)

    no_time = await client.post(
        "/api/v1/tasks",
        json={
            "title": "Daily standup",
            "due_date": "2026-01-01",
            "recurrence": {"freq": "daily"},
        },
        headers={"x-csrf-token": csrf},
    )
    assert no_time.status_code == 400

    no_date = await client.post(
        "/api/v1/tasks",
        json={"title": "Daily standup", "recurrence": {"freq": "daily"}},
        headers={"x-csrf-token": csrf},
    )
    assert no_date.status_code == 400


async def test_create_recurring_task_stores_rrule_and_recurrence_end(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client,
        "Daily standup",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily", "end_type": "after_count", "end_count": 3},
    )
    assert task["is_recurring"] is True
    assert task["rrule"] == "FREQ=DAILY;COUNT=3"
    assert task["recurrence_end"] == "2026-01-03"


async def test_completing_recurring_task_advances_due_and_stays_open(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client,
        "Daily standup",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily"},
    )

    completed = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    assert completed.status_code == 200
    body = completed.json()
    assert body["status"] == "open"
    assert body["due_date"] == "2026-01-02"
    assert body["due_time"] == "09:00:00"


async def test_completing_last_occurrence_closes_the_task(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client,
        "Two-day event",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily", "end_type": "after_count", "end_count": 2},
    )

    first = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    assert first.json()["status"] == "open"
    assert first.json()["due_date"] == "2026-01-02"

    second = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    assert second.json()["status"] == "done"
    assert second.json()["completed_at"] is not None


async def test_skip_occurrence_advances_without_marking_done(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client,
        "Weekly review",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "weekly"},
    )

    skipped = await _post(client, f"/api/v1/tasks/{task['id']}/skip")
    assert skipped.status_code == 200
    assert skipped.json()["status"] == "open"
    assert skipped.json()["due_date"] == "2026-01-08"


async def test_skip_non_recurring_task_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(client, "One-off task")

    response = await _post(client, f"/api/v1/tasks/{task['id']}/skip")
    assert response.status_code == 400


async def test_clear_recurrence_makes_task_one_off_again(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client,
        "Daily standup",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily"},
    )

    csrf = client.cookies.get("csrf_token")
    cleared = await client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"clear_recurrence": True},
        headers={"x-csrf-token": csrf},
    )
    assert cleared.json()["is_recurring"] is False
    assert cleared.json()["rrule"] is None

    completed = await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    assert completed.json()["status"] == "done"


async def test_calendar_includes_virtual_future_occurrences(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_task(
        client,
        "Daily standup",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily"},
    )

    response = await client.get(
        "/api/v1/tasks/calendar", params={"start": "2026-01-01", "end": "2026-01-05"}
    )
    assert response.status_code == 200
    entries = response.json()
    dates = sorted(e["date"] for e in entries)
    assert dates == [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
        "2026-01-05",
    ]
    real = next(e for e in entries if e["date"] == "2026-01-01")
    virtual = next(e for e in entries if e["date"] == "2026-01-02")
    assert real["virtual"] is False
    assert virtual["virtual"] is True


async def test_calendar_excludes_completed_recurring_task_future_occurrences(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Once a recurring task is fully exhausted (no more occurrences), the calendar should
    still show its real last occurrence (like any other completed task due that day) but
    must not keep inventing virtual future occurrences for it."""
    await make_user(db_session, "alice")
    await login(client, "alice")
    task = await _create_task(
        client,
        "Two-day event",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily", "end_type": "after_count", "end_count": 2},
    )
    await _post(client, f"/api/v1/tasks/{task['id']}/complete")
    await _post(client, f"/api/v1/tasks/{task['id']}/complete")

    response = await client.get(
        "/api/v1/tasks/calendar", params={"start": "2026-01-01", "end": "2026-01-05"}
    )
    entries = response.json()
    assert len(entries) == 1
    assert entries[0]["date"] == "2026-01-02"
    assert entries[0]["virtual"] is False


async def test_calendar_includes_non_recurring_tasks_in_range(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    today = date.today()
    await _create_task(client, "Plain task", due_date=(today + timedelta(days=2)).isoformat())

    response = await client.get(
        "/api/v1/tasks/calendar",
        params={"start": today.isoformat(), "end": (today + timedelta(days=7)).isoformat()},
    )
    assert len(response.json()) == 1
    assert response.json()[0]["virtual"] is False


async def test_calendar_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    await _create_task(
        client,
        "Daily standup",
        due_date="2026-01-01",
        due_time="09:00:00",
        recurrence={"freq": "daily"},
    )

    response = await second_client.get(
        "/api/v1/tasks/calendar", params={"start": "2026-01-01", "end": "2026-01-05"}
    )
    assert response.status_code == 200
    assert response.json() == []
