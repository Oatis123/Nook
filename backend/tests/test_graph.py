from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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


def _edge_pairs(edges: list[dict]) -> set[tuple[str, str]]:
    return {(e["source"], e["target"]) for e in edges}


async def test_global_graph_includes_resolved_links(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    b = await _create_note(client, "B")
    a = await _create_note(client, "A", content="See [[B]].")

    response = await client.get("/api/v1/graph")
    assert response.status_code == 200
    body = response.json()
    node_ids = {n["id"] for n in body["nodes"]}
    assert {a["id"], b["id"]} <= node_ids
    assert (a["id"], b["id"]) in _edge_pairs(body["edges"])


async def test_global_graph_dangling_link_creates_virtual_node(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    a = await _create_note(client, "A", content="See [[Nonexistent]].")

    shown = await client.get("/api/v1/graph")
    edges = shown.json()["edges"]
    assert any(e["source"] == a["id"] and e["target"] == "dangling:Nonexistent" for e in edges)
    dangling_node = next(n for n in shown.json()["nodes"] if n["id"] == "dangling:Nonexistent")
    assert dangling_node["dangling"] is True
    assert dangling_node["title"] == "Nonexistent"

    hidden = await client.get("/api/v1/graph", params={"show_dangling": "false"})
    assert all(not e["target"].startswith("dangling:") for e in hidden.json()["edges"])
    assert all(not n["dangling"] for n in hidden.json()["nodes"])


async def test_global_graph_hide_orphans(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    b = await _create_note(client, "B")
    a = await _create_note(client, "A", content="See [[B]].")
    orphan = await _create_note(client, "Orphan")

    default = await client.get("/api/v1/graph")
    assert {n["id"] for n in default.json()["nodes"]} == {a["id"], b["id"], orphan["id"]}

    filtered = await client.get("/api/v1/graph", params={"hide_orphans": "true"})
    assert {n["id"] for n in filtered.json()["nodes"]} == {a["id"], b["id"]}


async def test_global_graph_folder_filter(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    folder = await _create_folder(client, "Work")
    inside = await _create_note(client, "Inside", folder_id=folder["id"])
    outside = await _create_note(client, "Outside")

    response = await client.get("/api/v1/graph", params={"folder_id": folder["id"]})
    node_ids = {n["id"] for n in response.json()["nodes"]}
    assert inside["id"] in node_ids
    assert outside["id"] not in node_ids


async def test_global_graph_tag_filter(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    tagged = await _create_note(client, "Tagged", content="#keep")
    untagged = await _create_note(client, "Untagged")

    response = await client.get("/api/v1/graph", params={"tag": "keep"})
    node_ids = {n["id"] for n in response.json()["nodes"]}
    assert tagged["id"] in node_ids
    assert untagged["id"] not in node_ids


async def test_global_graph_link_count_reflects_degree(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    hub = await _create_note(client, "Hub")
    await _create_note(client, "Spoke1", content="[[Hub]]")
    await _create_note(client, "Spoke2", content="[[Hub]]")

    response = await client.get("/api/v1/graph")
    hub_node = next(n for n in response.json()["nodes"] if n["id"] == hub["id"])
    assert hub_node["link_count"] == 2


async def test_local_graph_depth_one_excludes_second_hop(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    c = await _create_note(client, "C")
    b = await _create_note(client, "B", content="[[C]]")
    a = await _create_note(client, "A", content="[[B]]")

    depth1 = await client.get("/api/v1/graph", params={"note_id": a["id"], "depth": 1})
    node_ids = {n["id"] for n in depth1.json()["nodes"]}
    assert node_ids == {a["id"], b["id"]}
    assert c["id"] not in node_ids


async def test_local_graph_depth_two_includes_second_hop(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    c = await _create_note(client, "C")
    b = await _create_note(client, "B", content="[[C]]")
    a = await _create_note(client, "A", content="[[B]]")

    depth2 = await client.get("/api/v1/graph", params={"note_id": a["id"], "depth": 2})
    node_ids = {n["id"] for n in depth2.json()["nodes"]}
    assert node_ids == {a["id"], b["id"], c["id"]}


async def test_local_graph_for_missing_note_returns_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    response = await client.get(
        "/api/v1/graph", params={"note_id": "00000000-0000-0000-0000-000000000000"}
    )
    assert response.status_code == 200
    assert response.json() == {"nodes": [], "edges": []}


async def test_graph_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    await _create_note(client, "Alice's note")

    bob_graph = await second_client.get("/api/v1/graph")
    assert bob_graph.json() == {"nodes": [], "edges": []}
