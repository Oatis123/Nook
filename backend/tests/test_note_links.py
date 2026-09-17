from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import csrf_token, login, make_user


async def _create_note(client: AsyncClient, title: str, content: str = "") -> dict:
    csrf = await csrf_token(client)
    response = await client.post(
        "/api/v1/notes", json={"title": title, "content": content}, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200
    return response.json()


async def _patch_note(client: AsyncClient, note: dict, **fields) -> dict:
    csrf = client.cookies.get("csrf_token")
    body = {"version": note["version"], **fields}
    response = await client.patch(
        f"/api/v1/notes/{note['id']}", json=body, headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_inline_and_frontmatter_tags_and_aliases(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    note = await _create_note(
        client,
        "Recipe",
        content=(
            "---\ntags: [cooking]\naliases: [Dinner Idea]\n---\n"
            "This has an inline #tag and #cooking/pasta."
        ),
    )

    assert set(note["tags"]) == {"cooking", "tag", "cooking/pasta"}
    assert note["aliases"] == ["Dinner Idea"]


async def test_wikilink_resolves_to_existing_note(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    target = await _create_note(client, "Target Note")
    source = await _create_note(client, "Source Note", content="See [[Target Note]] for more.")

    backlinks = await client.get(f"/api/v1/notes/{target['id']}/backlinks")
    assert backlinks.status_code == 200
    body = backlinks.json()
    assert len(body) == 1
    assert body[0]["source_note_id"] == source["id"]


async def test_dangling_link_resolves_once_target_is_created(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    source = await _create_note(client, "Source Note", content="See [[Future Note]].")

    before = await client.get(f"/api/v1/notes/{source['id']}")
    assert before.json()["title"] == "Source Note"

    target = await _create_note(client, "Future Note")

    backlinks = await client.get(f"/api/v1/notes/{target['id']}/backlinks")
    assert backlinks.status_code == 200
    assert len(backlinks.json()) == 1
    assert backlinks.json()[0]["source_note_id"] == source["id"]


async def test_ambiguous_target_stays_unresolved(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    await client.post("/api/v1/folders", json={"name": "A"}, headers={"x-csrf-token": csrf})
    folder_b = (
        await client.post("/api/v1/folders", json={"name": "B"}, headers={"x-csrf-token": csrf})
    ).json()

    dup1 = await _create_note(client, "Dup")
    dup2_csrf = client.cookies.get("csrf_token")
    dup2 = await client.post(
        "/api/v1/notes",
        json={"title": "Dup", "folder_id": folder_b["id"]},
        headers={"x-csrf-token": dup2_csrf},
    )
    assert dup2.status_code == 200

    source = await _create_note(client, "Referrer", content="[[Dup]]")

    # Neither "Dup" note should show the ambiguous link as a resolved backlink.
    for note_id in (dup1["id"], dup2.json()["id"]):
        backlinks = await client.get(f"/api/v1/notes/{note_id}/backlinks")
        assert backlinks.json() == []
    assert source["title"] == "Referrer"


async def test_rename_impact_and_cascade_update(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    target = await _create_note(client, "Old Title")
    source = await _create_note(client, "Referrer", content="Link: [[Old Title]] end.")

    impact = await client.get(f"/api/v1/notes/{target['id']}/rename-impact")
    assert impact.status_code == 200
    assert impact.json()["affected_notes"] == 1

    renamed = await _patch_note(client, target, title="New Title", update_links=True)
    assert renamed["title"] == "New Title"

    updated_source = await client.get(f"/api/v1/notes/{source['id']}")
    assert "[[New Title]]" in updated_source.json()["content"]
    assert updated_source.json()["version"] == source["version"] + 1


async def test_rename_without_update_links_leaves_content_untouched(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    target = await _create_note(client, "Old Title")
    source = await _create_note(client, "Referrer", content="Link: [[Old Title]] end.")

    await _patch_note(client, target, title="New Title", update_links=False)

    updated_source = await client.get(f"/api/v1/notes/{source['id']}")
    assert "[[Old Title]]" in updated_source.json()["content"]


async def test_tags_endpoint_returns_counts(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await _create_note(client, "One", content="#shared #only-one")
    await _create_note(client, "Two", content="#shared")

    tags = await client.get("/api/v1/tags")
    assert tags.status_code == 200
    by_name = {t["name"]: t["note_count"] for t in tags.json()}
    assert by_name == {"shared": 2, "only-one": 1}


async def test_notes_filtered_by_tag(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    tagged = await _create_note(client, "Tagged", content="#keep")
    await _create_note(client, "Untagged")

    filtered = await client.get("/api/v1/notes", params={"tag": "keep"})
    assert filtered.status_code == 200
    ids = [n["id"] for n in filtered.json()]
    assert ids == [tagged["id"]]


async def test_tags_and_backlinks_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_note = await _create_note(client, "Alice Note", content="#alice-tag")

    bob_tags = await second_client.get("/api/v1/tags")
    assert bob_tags.json() == []

    bob_backlinks = await second_client.get(f"/api/v1/notes/{alice_note['id']}/backlinks")
    assert bob_backlinks.status_code == 404
