"""Regression tests for inputs that used to 500 or silently lose data (pre-deploy review)."""

import io
import uuid
import zipfile
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.folder import Folder
from app.models.import_job import ImportJobStatus
from app.models.note import Note
from app.models.note_link import NoteLink
from app.services import vault_export as vault_export_service
from app.services import vault_import as vault_import_service
from app.services.note_parsing import extract_frontmatter, extract_inline_tags
from tests.conftest import csrf_token, login, make_user


async def _create_note(
    client: AsyncClient, title: str, content: str = "", folder_id: str | None = None
):
    csrf = await csrf_token(client)
    return await client.post(
        "/api/v1/notes",
        json={"title": title, "content": content, "folder_id": folder_id},
        headers={"x-csrf-token": csrf},
    )


def test_frontmatter_values_are_json_safe() -> None:
    frontmatter, _ = extract_frontmatter(
        "---\ncreated: 2024-01-01\nat: 2024-01-01 10:30:00\nratio: .nan\n2024-02-02: keyed\n---\n"
    )
    assert frontmatter["created"] == "2024-01-01"
    assert frontmatter["at"].startswith("2024-01-01T10:30:00")
    assert frontmatter["ratio"] == "nan"
    assert frontmatter["2024-02-02"] == "keyed"


def test_cyrillic_inline_tags() -> None:
    assert extract_inline_tags("Про #заметка и #проект/дом, но не #123") == {
        "заметка",
        "проект/дом",
    }


async def test_note_with_date_frontmatter_saves(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    response = await _create_note(client, "Dated", "---\ncreated: 2024-01-01\n---\nBody")
    assert response.status_code == 200, response.text
    assert response.json()["frontmatter"] == {"created": "2024-01-01"}


async def test_overlong_link_tag_and_alias_are_clipped(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    long = "x" * 300

    response = await _create_note(
        client, "Long", f"---\ntags: [{long}]\naliases: [{long}]\n---\n[[{long}#{long}]]"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tags"] == ["x" * 255]
    assert body["aliases"] == ["x" * 255]
    link = await db_session.scalar(select(NoteLink))
    assert link is not None and len(link.target_raw) == 255


async def test_links_resolve_by_alias_and_folder_form(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    folder = await client.post(
        "/api/v1/folders", json={"name": "Work"}, headers={"x-csrf-token": csrf}
    )
    folder_id = folder.json()["id"]
    target = await _create_note(client, "Plan", "---\naliases: [Roadmap]\n---\n", folder_id)
    target_id = target.json()["id"]

    source = await _create_note(client, "Source", "[[Roadmap]] and [[Work/Plan]] and [[Nope]]")
    assert source.status_code == 200
    links = {
        link.target_raw: link.target_note_id for link in await db_session.scalars(select(NoteLink))
    }
    assert links == {
        "Roadmap": uuid.UUID(target_id),
        "Work/Plan": uuid.UUID(target_id),
        "Nope": None,
    }

    # A later note matching the dangling target resolves it.
    created = await _create_note(client, "Nope")
    await db_session.commit()
    link = await db_session.scalar(select(NoteLink).where(NoteLink.target_raw == "Nope"))
    assert link is not None and str(link.target_note_id) == created.json()["id"]


async def test_single_note_export_with_cyrillic_title(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    note = (await _create_note(client, "Заметка про дом", "Текст")).json()

    response = await client.get(f"/api/v1/notes/{note['id']}/export")
    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert "filename*=UTF-8''%D0%97" in disposition
    assert response.content.decode() == "Текст"


async def test_restore_picks_a_free_title(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    titles = []
    for _ in range(3):
        note = (await _create_note(client, "Twin")).json()
        await client.delete(f"/api/v1/notes/{note['id']}", headers={"x-csrf-token": csrf})
        titles.append(note["id"])
    await _create_note(client, "Twin")

    restored = []
    for note_id in titles:
        response = await client.post(
            f"/api/v1/notes/{note_id}/restore", headers={"x-csrf-token": csrf}
        )
        assert response.status_code == 200, response.text
        restored.append(response.json()["title"])
    assert restored == ["Twin (restored)", "Twin (restored 2)", "Twin (restored 3)"]


async def test_duplicate_title_race_maps_to_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The DB index is the backstop when the service's own check is bypassed (a race)."""
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "Same")

    async def no_check(*_args, **_kwargs) -> None:
        return None

    with patch("app.services.notes._check_title_unique", no_check):
        response = await _create_note(client, "Same")
    assert response.status_code == 409


async def test_export_survives_folder_cycle(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    a = Folder(user_id=user.id, name="a", position=1)
    b = Folder(user_id=user.id, name="..", position=2)
    db_session.add_all([a, b])
    await db_session.flush()
    await db_session.execute(update(Folder).where(Folder.id == a.id).values(parent_id=b.id))
    await db_session.execute(update(Folder).where(Folder.id == b.id).values(parent_id=a.id))
    db_session.add(Note(user_id=user.id, folder_id=a.id, title="n", content="c"))
    user_id = user.id
    await db_session.commit()
    db_session.expire_all()

    data = await vault_export_service.build_vault_zip(db_session, user_id)
    names = zipfile.ZipFile(io.BytesIO(data)).namelist()
    assert len(names) == 1
    assert ".." not in names[0].split("/")


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buffer.getvalue()


async def _import(client: AsyncClient, db_session: AsyncSession, entries: dict[str, bytes]):
    csrf = await csrf_token(client)
    upload = await client.post(
        "/api/v1/import",
        files={"file": ("vault.zip", _zip(entries), "application/zip")},
        headers={"x-csrf-token": csrf},
    )
    assert upload.status_code == 200, upload.text
    await vault_import_service.process_pending_import_jobs(db_session)
    return (await client.get(f"/api/v1/import/{upload.json()['id']}")).json()


async def test_import_obsidian_dates_and_long_names(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    long_name = "n" * 300

    job = await _import(
        client,
        db_session,
        {
            "Daily/2024-01-01.md": b"---\ncreated: 2024-01-01\ntags: [daily]\n---\nHello",
            f"{long_name}.md": b"long title",
            "Plain.md": b"plain",
        },
    )
    assert job["status"] == ImportJobStatus.done.value, job
    assert job["report"]["errors"] == []
    assert job["report"]["notes_imported"] == 3


async def test_import_continues_after_unexpected_entry_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    real_create = vault_import_service.notes_service.create_note

    async def flaky_create(session, user_id, title, folder_id, content):
        if title == "Broken":
            raise RuntimeError("secret internal detail")
        return await real_create(session, user_id, title, folder_id, content)

    with patch.object(vault_import_service.notes_service, "create_note", flaky_create):
        job = await _import(client, db_session, {"Broken.md": b"x", "Fine.md": b"y"})

    assert job["status"] == ImportJobStatus.done.value
    assert job["report"]["notes_imported"] == 1
    assert job["report"]["errors"] == ['"Broken.md": could not be imported']
    assert "secret" not in str(job["report"])
