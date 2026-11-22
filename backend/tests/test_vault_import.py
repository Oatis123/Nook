import io
import zipfile

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_job import ImportJobStatus
from app.services import vault_import as vault_import_service
from tests.conftest import csrf_token, login, make_user


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buffer.getvalue()


async def _upload_and_process(
    client: AsyncClient, db_session: AsyncSession, entries: dict[str, bytes]
) -> dict:
    csrf = await csrf_token(client)
    upload = await client.post(
        "/api/v1/import",
        files={"file": ("vault.zip", _zip_bytes(entries), "application/zip")},
        headers={"x-csrf-token": csrf},
    )
    assert upload.status_code == 200, upload.text
    job_id = upload.json()["id"]

    count = await vault_import_service.process_pending_import_jobs(db_session)
    assert count == 1

    status_response = await client.get(f"/api/v1/import/{job_id}")
    assert status_response.status_code == 200
    return status_response.json()


async def test_import_creates_folders_and_notes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    job = await _upload_and_process(
        client,
        db_session,
        {
            "Root note.md": b"Just a root note.",
            "Work/Nested note.md": b"---\ntags: [work]\n---\n\nNested content [[Root note]].",
        },
    )
    assert job["status"] == ImportJobStatus.done
    assert job["report"]["notes_imported"] == 2

    notes = (await client.get("/api/v1/notes")).json()
    titles = {n["title"] for n in notes}
    assert titles == {"Root note", "Nested note"}

    nested = next(n for n in notes if n["title"] == "Nested note")
    detail = (await client.get(f"/api/v1/notes/{nested['id']}")).json()
    assert detail["tags"] == ["work"]
    assert "[[Root note]]" in detail["content"]

    folders = (await client.get("/api/v1/folders")).json()
    assert {f["name"] for f in folders} == {"Work"}


async def test_import_ignores_obsidian_directory(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    job = await _upload_and_process(
        client,
        db_session,
        {
            "Note.md": b"Hello.",
            ".obsidian/app.json": b'{"some": "config"}',
            ".obsidian/plugins/foo/data.json": b"{}",
        },
    )
    assert job["status"] == ImportJobStatus.done
    assert job["report"]["notes_imported"] == 1
    assert job["report"]["attachments_imported"] == 0

    notes = (await client.get("/api/v1/notes")).json()
    assert {n["title"] for n in notes} == {"Note"}


async def test_import_uploads_attachments_and_links_embeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    job = await _upload_and_process(
        client,
        db_session,
        {
            "attachments/photo.png": b"fake-png-bytes",
            "Note.md": b"Look at this: ![[photo.png]]",
        },
    )
    assert job["status"] == ImportJobStatus.done
    assert job["report"]["attachments_imported"] == 1
    assert job["report"]["notes_imported"] == 1

    attachments = (await client.get("/api/v1/attachments")).json()
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "photo.png"
    assert attachments[0]["folder_id"] is not None
    assert attachments[0]["used_by"] == ["Note"]


async def test_import_attachment_folders_markdown_embeds_and_dedup_rewrite(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    # First import creates folders and places attachments into their zip directories
    job1 = await _upload_and_process(
        client,
        db_session,
        {
            "Course/images/8943ee10.gif": b"GIF89a-course",
            "Other/images/8943ee10.gif": b"GIF89a-other",
            "Course/notes/Lecture.md": b"| ![](../images/8943ee10.gif) | Graph |\n",
        },
    )
    assert job1["status"] == ImportJobStatus.done
    assert job1["report"]["attachments_imported"] == 2
    assert job1["report"]["notes_imported"] == 1

    folders = (await client.get("/api/v1/folders")).json()
    by_name_parent = {(f["name"], f["parent_id"]): f["id"] for f in folders}
    course_id = by_name_parent[("Course", None)]
    other_id = by_name_parent[("Other", None)]
    course_images_id = by_name_parent[("images", course_id)]
    other_images_id = by_name_parent[("images", other_id)]

    attachments = (await client.get("/api/v1/attachments")).json()
    by_folder = {a["folder_id"]: a for a in attachments}
    assert by_folder[course_images_id]["filename"] == "8943ee10.gif"
    assert by_folder[course_images_id]["used_by"] == ["Lecture"]
    assert by_folder[other_images_id]["filename"] == "8943ee10.gif"
    assert by_folder[other_images_id]["used_by"] == []

    # Second import with different bytes in Course/images/8943ee10.gif numbers it and rewrites
    job2 = await _upload_and_process(
        client,
        db_session,
        {
            "Course/images/8943ee10.gif": b"GIF89a-course-v2",
            "Course/notes/Lecture 2.md": b"See ![graph](../images/8943ee10.gif)\n",
        },
    )
    assert job2["status"] == ImportJobStatus.done
    notes = (await client.get("/api/v1/notes")).json()
    lec2 = next(n for n in notes if n["title"] == "Lecture 2")
    lec2_detail = (await client.get(f"/api/v1/notes/{lec2['id']}")).json()
    assert "<../images/8943ee10 (2).gif>" in lec2_detail["content"]

    attachments2 = (await client.get("/api/v1/attachments")).json()
    renamed = next(
        a
        for a in attachments2
        if a["folder_id"] == course_images_id and a["filename"] == "8943ee10 (2).gif"
    )
    assert renamed["used_by"] == ["Lecture 2"]


async def test_import_handles_title_conflict(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    await client.post(
        "/api/v1/notes",
        json={"title": "Existing", "content": "original"},
        headers={"x-csrf-token": csrf},
    )

    job = await _upload_and_process(client, db_session, {"Existing.md": b"imported version"})
    assert job["status"] == ImportJobStatus.done
    assert job["report"]["notes_imported"] == 1
    assert len(job["report"]["conflicts"]) == 1

    notes = (await client.get("/api/v1/notes")).json()
    titles = sorted(n["title"] for n in notes)
    assert titles == ["Existing", "Existing (imported 1)"]


async def test_import_rejects_oversized_archive(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    monkeypatch.setattr(vault_import_service, "MAX_IMPORT_UNCOMPRESSED_MB", 0)

    job = await _upload_and_process(client, db_session, {"Note.md": b"some content"})
    assert job["status"] == ImportJobStatus.failed
    assert job["report"]["notes_imported"] == 0
    assert job["report"]["errors"]

    notes = (await client.get("/api/v1/notes")).json()
    assert notes == []


async def test_import_skips_path_traversal_entries(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    job = await _upload_and_process(
        client,
        db_session,
        {
            "../../evil.md": b"should not be imported",
            "Safe note.md": b"fine",
        },
    )
    assert job["status"] == ImportJobStatus.done
    assert job["report"]["notes_imported"] == 1

    notes = (await client.get("/api/v1/notes")).json()
    assert {n["title"] for n in notes} == {"Safe note"}


async def test_import_rejects_non_zip_upload(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)

    response = await client.post(
        "/api/v1/import",
        files={"file": ("vault.zip", b"not actually a zip", "application/zip")},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 400


async def test_import_job_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    csrf = await csrf_token(client)
    upload = await client.post(
        "/api/v1/import",
        files={"file": ("vault.zip", _zip_bytes({"Note.md": b"x"}), "application/zip")},
        headers={"x-csrf-token": csrf},
    )
    job_id = upload.json()["id"]

    csrf_bob = await csrf_token(second_client)
    response = await second_client.get(
        f"/api/v1/import/{job_id}", headers={"x-csrf-token": csrf_bob}
    )
    assert response.status_code == 404
