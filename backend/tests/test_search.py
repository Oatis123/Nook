from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.search import parse_query
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


async def _create_folder(client: AsyncClient, name: str) -> dict:
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/folders", json={"name": name}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200
    return response.json()


def test_parse_query_extracts_filters() -> None:
    filters = parse_query("hello tag:project path:Work/Notes in:notes world")
    assert filters.text == "hello world"
    assert filters.tag == "project"
    assert filters.path == "Work/Notes"
    assert filters.scope == "notes"


def test_parse_query_defaults_scope_to_all() -> None:
    filters = parse_query("plain text query")
    assert filters.text == "plain text query"
    assert filters.tag is None
    assert filters.path is None
    assert filters.scope == "all"


async def test_search_finds_note_by_english_content(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Recipe", content="A delicious chocolate cake recipe")
    await _create_note(client, "Unrelated", content="Something else entirely")

    response = await client.get("/api/v1/search", params={"q": "chocolate"})
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Recipe"
    assert "<mark>" in results[0]["snippet"]


async def test_search_finds_note_by_russian_content(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Заметка", content="Рецепт шоколадного торта")

    response = await client.get("/api/v1/search", params={"q": "шоколадный"})
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Заметка"


async def test_search_ranks_title_match_above_content_match(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Something else", content="mentions banana in passing")
    await _create_note(client, "Banana bread", content="a good loaf")

    response = await client.get("/api/v1/search", params={"q": "banana"})
    results = response.json()
    assert [r["title"] for r in results] == ["Banana bread", "Something else"]


async def test_search_tag_filter(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Tagged", content="#project this note has a tag")
    await _create_note(client, "Untagged", content="this note has no tag")

    response = await client.get("/api/v1/search", params={"q": "tag:project"})
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Tagged"


async def test_search_path_filter(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    folder = await _create_folder(client, "Work")
    await _create_note(client, "In folder", folder_id=folder["id"], content="hello")
    await _create_note(client, "No folder", content="hello")

    response = await client.get("/api/v1/search", params={"q": "path:Work hello"})
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "In folder"


async def test_search_in_tasks_scope_returns_empty_before_tasks_exist(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Note", content="hello world")

    response = await client.get("/api/v1/search", params={"q": "hello in:tasks"})
    assert response.status_code == 200
    assert response.json() == []


async def test_search_filters_only_no_free_text(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Tagged", content="#project body text")
    await _create_note(client, "Other", content="other body text")

    response = await client.get("/api/v1/search", params={"q": "tag:project"})
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Tagged"
    assert results[0]["snippet"]


async def test_search_excludes_trashed_notes(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = await _create_note(client, "Trashed", content="findable text")
    csrf = client.cookies.get("csrf_token")
    await client.delete(f"/api/v1/notes/{note['id']}", headers={"x-csrf-token": csrf})

    response = await client.get("/api/v1/search", params={"q": "findable"})
    assert response.json() == []


async def test_search_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    await _create_note(client, "Alice's secret", content="unique search term xyzzy")

    response = await second_client.get("/api/v1/search", params={"q": "xyzzy"})
    assert response.status_code == 200
    assert response.json() == []
