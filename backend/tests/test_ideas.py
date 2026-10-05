from datetime import datetime

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import ideas as ideas_service
from app.services import notes as notes_service
from tests.conftest import csrf_token, login, make_user

MONDAY_14_32 = datetime(2026, 10, 5, 14, 32, 45)
MONDAY_18_05 = datetime(2026, 10, 5, 18, 5)


async def _send(client: AsyncClient, method: str, url: str, **json_body: object) -> Response:
    csrf = await csrf_token(client)
    return await client.request(method, url, json=json_body or None, headers={"x-csrf-token": csrf})


async def test_first_idea_creates_the_note_and_ideas_append_in_order(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session, "alice")

    await ideas_service.append_idea(db_session, user.id, "Первая идея", MONDAY_14_32)
    await ideas_service.append_idea(db_session, user.id, "Вторая  \nв две строки", MONDAY_18_05)

    note = await ideas_service.get_ideas_note(db_session, user.id)
    assert note is not None
    assert (note.title, note.folder_id, note.is_ideas) == ("Идеи", None, True)
    assert note.content == (
        "**пн, 5 окт 2026, 14:32**  \nПервая идея\n\n"
        "**пн, 5 окт 2026, 18:05**  \nВторая  \nв две строки\n"
    )


async def test_existing_note_titled_ideas_is_left_alone(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    await notes_service.create_note(db_session, user.id, "Идеи", None, "мои старые идеи")

    await ideas_service.append_idea(db_session, user.id, "Новая", MONDAY_14_32)

    note = await ideas_service.get_ideas_note(db_session, user.id)
    assert note is not None and note.title == "Идеи (2)"


async def test_remove_idea_takes_out_just_that_entry(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    await ideas_service.append_idea(db_session, user.id, "Раз", MONDAY_14_32)
    middle = await ideas_service.append_idea(db_session, user.id, "Два", MONDAY_14_32)
    await ideas_service.append_idea(db_session, user.id, "Три", MONDAY_18_05)

    assert await ideas_service.remove_idea(db_session, user.id, middle) is True
    assert await ideas_service.remove_idea(db_session, user.id, middle) is False

    note = await ideas_service.get_ideas_note(db_session, user.id)
    assert note is not None
    assert note.content == "**пн, 5 окт 2026, 14:32**  \nРаз\n\n**пн, 5 окт 2026, 18:05**  \nТри\n"


async def test_ideas_note_cannot_be_deleted(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    await login(client, "alice")
    await ideas_service.append_idea(db_session, user.id, "Идея", MONDAY_14_32)
    note = await ideas_service.get_ideas_note(db_session, user.id)
    assert note is not None

    for url in (f"/api/v1/notes/{note.id}", f"/api/v1/notes/{note.id}/permanent"):
        response = await _send(client, "DELETE", url)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ideas_note"


async def test_deleting_its_folder_moves_the_ideas_note_to_the_top_level(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await make_user(db_session, "alice")
    await login(client, "alice")
    await ideas_service.append_idea(db_session, user.id, "Идея", MONDAY_14_32)
    note = await ideas_service.get_ideas_note(db_session, user.id)
    assert note is not None
    folder = (await _send(client, "POST", "/api/v1/folders", name="Архив", parent_id=None)).json()
    moved = await _send(
        client, "PATCH", f"/api/v1/notes/{note.id}", version=note.version, folder_id=folder["id"]
    )
    assert moved.status_code == 200

    assert (await _send(client, "DELETE", f"/api/v1/folders/{folder['id']}")).status_code == 204

    await db_session.refresh(note)
    assert (note.deleted_at, note.folder_id, note.is_ideas) == (None, None, True)


async def test_notes_list_marks_the_ideas_note_and_profile_can_hide_it(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await make_user(db_session, "alice")
    await login(client, "alice")
    await ideas_service.append_idea(db_session, user.id, "Идея", MONDAY_14_32)
    await notes_service.create_note(db_session, user.id, "Обычная", None, "")

    listed = {n["title"]: n["is_ideas"] for n in (await client.get("/api/v1/notes")).json()}
    assert listed == {"Идеи": True, "Обычная": False}

    assert (await client.get("/api/v1/me")).json()["ideas_note_hidden"] is False
    hidden = await _send(client, "PATCH", "/api/v1/me", ideas_note_hidden=True)
    assert hidden.json()["ideas_note_hidden"] is True
