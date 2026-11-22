"""End-to-end coverage for the MCP server (app/mcp/) over its real HTTP transport —
this is the layer with the fiddly wiring (auth middleware, mounting, the session
manager's own lifespan), so it's worth proving the whole stack works together once,
on top of the plainer service-level tests in test_api_tokens.py."""

import base64
import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.testclient import TestClient

import app.mcp.tools as mcp_tools
import app.mcp.verifier as mcp_verifier
import app.services.attachments as attachments_service
from app.core.config import get_settings
from app.main import app
from app.services.api_tokens import create_api_token
from tests.conftest import make_user

HEADERS = {"Accept": "application/json, text/event-stream"}


@pytest.fixture(scope="module")
def _mcp_test_client() -> Iterator[TestClient]:
    """One TestClient (and so one lifespan entry) for the whole module — the mounted
    MCP app's session manager is a singleton built at import time and its `.run()` may
    only be entered once per process (a second entry raises), so this can't be a
    per-test fixture the way `client` in conftest.py is. base_url must match
    settings.public_url (whatever this environment's .env sets — no fixed default):
    the MCP transport checks the Host header against it
    (app/mcp/instance.py's allowed_hosts), and TestClient's default Host ("testserver")
    would otherwise fail that check with a 421."""
    with TestClient(app, base_url=get_settings().public_url) as c:
        yield c


@pytest.fixture
async def mcp_client(
    _mcp_test_client: TestClient, db_engine: object, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[TestClient]:
    """TestClient drives the ASGI app on its own background thread with its own event
    loop — sharing `db_session` (opened on the main test loop, e.g. by a prior
    `make_user` call) across that boundary crashes asyncpg ("attached to a different
    loop"). A `NullPool` engine of its own sidesteps that: it never reuses a pooled
    connection, so every query opens a fresh one on whichever loop calls it (here,
    always TestClient's) — see the `db_session` this test still uses for setup, which
    stays entirely on the main loop and never touches this engine."""
    engine = create_async_engine(get_settings().test_database_url, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    # Both modules did `from app.core.db import async_session_factory`, so each needs
    # patching individually — patching app.core.db's own attribute wouldn't reach
    # either already-bound name.
    monkeypatch.setattr(mcp_verifier, "async_session_factory", session_factory)
    monkeypatch.setattr(mcp_tools, "async_session_factory", session_factory)
    yield _mcp_test_client
    await engine.dispose()


def _rpc(method: str, params: dict[str, Any], id_: int = 1) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "method": method, "params": params}


def _parse_sse(text: str) -> dict[str, Any]:
    for line in text.splitlines():
        if line.startswith("data: "):
            return json.loads(line.removeprefix("data: "))
    raise AssertionError(f"no SSE data line in: {text!r}")


def _initialize(client: TestClient, token: str) -> str:
    resp = client.post(
        "/mcp",
        json=_rpc(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "0"},
            },
        ),
        headers={**HEADERS, "Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    session_id = resp.headers["mcp-session-id"]
    client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={**HEADERS, "Authorization": f"Bearer {token}", "mcp-session-id": session_id},
    )
    return session_id


def _call_tool(client: TestClient, token: str, session_id: str, name: str, arguments: dict) -> dict:
    resp = client.post(
        "/mcp",
        json=_rpc("tools/call", {"name": name, "arguments": arguments}),
        headers={**HEADERS, "Authorization": f"Bearer {token}", "mcp-session-id": session_id},
    )
    assert resp.status_code == 200, resp.text
    return _parse_sse(resp.text)


def _tool_object(rpc_response: dict) -> dict:
    """A tool call's return value, for a tool whose return type is `dict[str, Any]` —
    the SDK uses the dict's own shape as `structuredContent` directly. More reliable to
    parse than `content[0].text`, whose human-readable rendering doesn't consistently
    give back the exact same JSON (e.g. a one-element `list[dict]` return renders as
    just that element, not a one-item array — see `_tool_list`)."""
    return rpc_response["result"]["structuredContent"]


def _tool_list(rpc_response: dict) -> list:
    """A tool call's return value, for a tool whose return type is `list[...]` — the
    SDK wraps a non-object return in a synthetic `{"result": ...}` object, since
    structuredContent's own JSON schema must be an object."""
    return rpc_response["result"]["structuredContent"]["result"]


async def test_request_without_a_token_is_rejected(mcp_client: TestClient) -> None:
    resp = mcp_client.post(
        "/mcp",
        json=_rpc(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "x", "version": "0"},
            },
        ),
        headers=HEADERS,
    )
    assert resp.status_code == 401
    assert "Bearer" in resp.headers["www-authenticate"]


async def test_create_and_list_notes_round_trip(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    _, plain = await create_api_token(db_session, alice.id, "test")
    session_id = _initialize(mcp_client, plain)

    created = _call_tool(
        mcp_client, plain, session_id, "create_note", {"title": "Groceries", "content": "milk"}
    )
    assert created["result"]["isError"] is False
    assert _tool_object(created)["title"] == "Groceries"

    listed = _call_tool(mcp_client, plain, session_id, "list_notes", {})
    assert [n["title"] for n in _tool_list(listed)] == ["Groceries"]


async def test_a_users_token_cannot_reach_another_users_note(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    bob = await make_user(db_session, "bob")
    _, alice_token = await create_api_token(db_session, alice.id, "alice-cli")
    _, bob_token = await create_api_token(db_session, bob.id, "bob-cli")

    alice_session = _initialize(mcp_client, alice_token)
    created = _call_tool(
        mcp_client, alice_token, alice_session, "create_note", {"title": "Alice's secret"}
    )
    note_id = _tool_object(created)["id"]

    bob_session = _initialize(mcp_client, bob_token)
    result = _call_tool(mcp_client, bob_token, bob_session, "get_note", {"note_id": note_id})
    assert result["result"]["isError"] is True
    assert "Not found" in result["result"]["content"][0]["text"]


async def test_organizing_notes_folders_tags_and_backlinks(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    _, token = await create_api_token(db_session, alice.id, "agent")
    sid = _initialize(mcp_client, token)

    def call(tool: str, /, **arguments: Any) -> dict:
        response = _call_tool(mcp_client, token, sid, tool, arguments)
        assert response["result"]["isError"] is False, response
        return response

    projects = _tool_object(call("create_folder", name="Projects"))
    archive = _tool_object(call("create_folder", name="Archive", parent_id=projects["id"]))
    assert archive["parent_id"] == projects["id"]
    assert _tool_object(call("rename_folder", folder_id=archive["id"], name="Old"))["name"] == "Old"
    assert _tool_object(call("move_folder", folder_id=archive["id"]))["parent_id"] is None

    roadmap = _tool_object(call("create_note", title="Roadmap", content="Plans #work"))
    call("create_note", title="Standup", content="See [[Roadmap#Q4]] #work #daily")
    moved = _tool_object(call("move_note", note_id=roadmap["id"], folder_id=projects["id"]))
    assert moved["folder_id"] == projects["id"]
    assert _tool_object(call("move_note", note_id=roadmap["id"]))["folder_id"] is None

    [backlink] = _tool_list(call("get_backlinks", note_id=roadmap["id"]))
    assert (backlink["title"], backlink["heading"]) == ("Standup", "Q4")
    assert _tool_list(call("list_tags")) == [
        {"name": "daily", "note_count": 1, "task_count": 0},
        {"name": "work", "note_count": 2, "task_count": 0},
    ]
    assert [n["title"] for n in _tool_list(call("list_notes", tag="daily"))] == ["Standup"]

    # Renaming rewrites the links to it.
    call("update_note", note_id=roadmap["id"], title="Plan")
    standup = next(n for n in _tool_list(call("list_notes")) if n["title"] == "Standup")
    assert "[[Plan#Q4]]" in _tool_object(call("get_note", note_id=standup["id"]))["content"]

    # Deleting a folder trashes the notes in it.
    call("move_note", note_id=roadmap["id"], folder_id=projects["id"])
    call("delete_folder", folder_id=projects["id"])
    assert [f["name"] for f in _tool_list(call("list_folders"))] == ["Old"]
    assert [n["title"] for n in _tool_list(call("list_notes"))] == ["Standup"]

    bad = _call_tool(mcp_client, token, sid, "move_folder", {"folder_id": "nope"})
    assert bad["result"]["isError"] is True


async def test_managing_task_lists_and_deleting_tasks(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    _, token = await create_api_token(db_session, alice.id, "agent")
    sid = _initialize(mcp_client, token)

    def call(tool: str, /, **arguments: Any) -> dict:
        response = _call_tool(mcp_client, token, sid, tool, arguments)
        assert response["result"]["isError"] is False, response
        return response

    work = _tool_object(call("create_task_list", name="Work", icon="briefcase", color="palette-3"))
    assert (work["icon"], work["color"]) == ("briefcase", "palette-3")
    renamed = _tool_object(call("update_task_list", list_id=work["id"], name="Job"))
    assert (renamed["name"], renamed["icon"]) == ("Job", "briefcase")

    task = _tool_object(call("create_task", title="Report"))
    moved = _tool_object(call("update_task", task_id=task["id"], list_id=work["id"]))
    assert moved["list_id"] == work["id"]

    call("delete_task_list", list_id=work["id"])  # its tasks go to the Inbox
    [inbox] = _tool_list(call("list_task_lists"))
    assert inbox["is_inbox"] is True
    [kept] = _tool_list(call("list_tasks"))
    assert (kept["title"], kept["list_id"]) == ("Report", inbox["id"])

    call("delete_task", task_id=task["id"])
    assert _tool_list(call("list_tasks", status="all")) == []

    bad = _call_tool(mcp_client, token, sid, "create_task_list", {"name": "X", "icon": "unicorn"})
    assert bad["result"]["isError"] is True
    assert "icon" in bad["result"]["content"][0]["text"]
    inbox_delete = _call_tool(mcp_client, token, sid, "delete_task_list", {"list_id": inbox["id"]})
    assert "Inbox can't be deleted" in inbox_delete["result"]["content"][0]["text"]


async def test_creating_tasks_links_unambiguous_wikilinks(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    bob = await make_user(db_session, "bob")
    _, token = await create_api_token(db_session, alice.id, "agent")
    _, bob_token = await create_api_token(db_session, bob.id, "agent")
    sid = _initialize(mcp_client, token)
    bob_sid = _initialize(mcp_client, bob_token)

    def call(tool: str, /, **arguments: Any) -> dict:
        response = _call_tool(mcp_client, token, sid, tool, arguments)
        assert response["result"]["isError"] is False, response
        return response

    plan = _tool_object(call("create_note", title="Gym plan"))
    checklist = _tool_object(call("create_note", title="Checklist"))
    _tool_object(call("create_note", title="Code sample"))
    private = _tool_object(
        _call_tool(mcp_client, bob_token, bob_sid, "create_note", {"title": "Private note"})
    )

    description = "[[Gym plan#Warm-up|Plan]], [[Missing]], [[Private note]], `[[Code sample]]`"
    task = _tool_object(
        call(
            "create_task",
            title="Review [[Checklist]]",
            description=description,
            note_ids=[plan["id"], plan["id"]],
        )
    )
    assert task["description"] == description
    assert {note["id"] for note in task["linked_notes"]} == {plan["id"], checklist["id"]}
    detail = _tool_object(call("get_task", task_id=task["id"]))
    assert detail["linked_notes"] == task["linked_notes"]

    results = _tool_list(
        call(
            "create_tasks",
            tasks=[
                {"title": "Reject foreign ID", "note_ids": [private["id"]]},
                {"title": "Warm up", "description": "[[Gym plan]]"},
            ],
        )
    )
    assert [result["ok"] for result in results] == [False, True]
    assert [note["id"] for note in results[1]["task"]["linked_notes"]] == [plan["id"]]
    assert "Reject foreign ID" not in [task["title"] for task in _tool_list(call("list_tasks"))]


async def test_tasks_with_recurrence_reminders_tags_subtasks_and_batches(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    _, token = await create_api_token(db_session, alice.id, "agent")
    sid = _initialize(mcp_client, token)

    def call(tool: str, /, **arguments: Any) -> dict:
        response = _call_tool(mcp_client, token, sid, tool, arguments)
        assert response["result"]["isError"] is False, response
        return response

    note = _tool_object(call("create_note", title="Gym plan"))
    gym = _tool_object(
        call(
            "create_task",
            title="Gym",
            due_date="2030-01-07",
            due_time="18:00",
            recurrence="FREQ=WEEKLY;BYDAY=MO,WE",
            reminders=[120, 15],
            tags=["#health"],
            note_ids=[note["id"]],
        )
    )
    assert gym["recurrence"] == "FREQ=WEEKLY;BYDAY=MO,WE"
    assert (gym["reminders"], gym["tags"]) == ([120, 15], ["health"])
    assert [n["title"] for n in gym["linked_notes"]] == ["Gym plan"]

    warmup = _tool_object(call("create_task", title="Warm up", parent_id=gym["id"]))
    assert warmup["parent_id"] == gym["id"]
    top = _tool_object(call("update_task", task_id=warmup["id"], parent_id=""))
    assert top["parent_id"] is None
    sub = _tool_object(call("update_task", task_id=top["id"], parent_id=gym["id"]))
    assert sub["parent_id"] == gym["id"]

    changed = _tool_object(
        call("update_task", task_id=gym["id"], recurrence="", default_reminders=True, tags=[])
    )
    assert (changed["recurrence"], changed["reminders"], changed["tags"]) == (None, None, [])
    unlinked = _tool_object(call("unlink_note_from_task", task_id=gym["id"], note_id=note["id"]))
    assert unlinked["linked_notes"] == []
    relinked = _tool_object(call("link_note_to_task", task_id=gym["id"], note_id=note["id"]))
    assert len(relinked["linked_notes"]) == 1

    results = _tool_list(
        call(
            "create_tasks",
            tasks=[
                {"title": "A", "tags": ["errands"]},
                {"title": "B", "recurrence": "FREQ=DAILY"},  # no due date/time: fails
                {"title": "C", "tags": ["errands"]},
            ],
        )
    )
    assert [r["ok"] for r in results] == [True, False, True]
    assert "due date and time" in results[1]["error"]
    a, c = results[0]["task"], results[2]["task"]
    assert [t["title"] for t in _tool_list(call("list_tasks", tag="errands"))] == ["A", "C"]
    assert {"name": "errands", "note_count": 0, "task_count": 2} in _tool_list(call("list_tags"))

    ordered = _tool_list(call("reorder_tasks", task_ids=[c["id"], a["id"]]))
    assert [t["title"] for t in ordered] == ["C", "A", "Gym"]

    moved = _tool_list(
        call(
            "update_tasks",
            updates=[
                {"task_id": a["id"], "due_date": "2030-02-01"},
                {"task_id": "not-an-id", "title": "X"},
            ],
        )
    )
    assert moved[0]["task"]["due_date"] == "2030-02-01"
    assert moved[1]["ok"] is False

    done = _tool_list(call("complete_tasks", task_ids=[a["id"], c["id"], gym["id"]]))
    assert [r["ok"] for r in done] == [True, True, False]  # Gym still has an open subtask
    assert "open subtask" in done[2]["error"]
    assert (
        _tool_object(call("complete_task", task_id=gym["id"], complete_subtasks=True))["status"]
        == "done"
    )


_PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def test_mcp_attachments_upload_list_get_move_delete(
    mcp_client: TestClient, db_session: AsyncSession
) -> None:
    alice = await make_user(db_session, "alice")
    _, token = await create_api_token(db_session, alice.id, "agent")
    sid = _initialize(mcp_client, token)

    def call(tool: str, /, **arguments: Any) -> dict:
        response = _call_tool(mcp_client, token, sid, tool, arguments)
        assert response["result"]["isError"] is False, response
        return response

    png_b64 = base64.b64encode(_PNG_MAGIC).decode("ascii")
    txt_bytes = b"lecture notes bytes"
    txt_b64 = base64.b64encode(txt_bytes).decode("ascii")

    # Upload to root
    root_att = _tool_object(
        call("upload_attachment", filename="diagram.png", content_base64=png_b64)
    )
    assert root_att["filename"] == "diagram.png"
    assert root_att["mime"] == "image/png"
    assert root_att["size"] == len(_PNG_MAGIC)
    assert root_att["folder_id"] is None
    assert root_att["download_url"] == f"/api/v1/attachments/{root_att['id']}/download"
    assert root_att["created_at"]

    # Upload into nested folder_path (auto-creates parent + child folders)
    folder_att = _tool_object(
        call(
            "upload_attachment",
            filename="diagram.png",
            content_base64=png_b64,
            folder_path="Математический анализ 1/images",
        )
    )
    assert folder_att["filename"] == "diagram.png"
    assert folder_att["folder_id"] is not None
    images_folder_id = folder_att["folder_id"]

    folders = _tool_list(call("list_folders"))
    by_name = {f["name"]: f for f in folders}
    assert "Математический анализ 1" in by_name
    assert by_name["images"]["parent_id"] == by_name["Математический анализ 1"]["id"]
    assert by_name["images"]["id"] == images_folder_id

    # Duplicate upload in the same folder is numbered, while a different folder keeps its name
    dup_att = _tool_object(
        call(
            "upload_attachment",
            filename="diagram.png",
            content_base64=png_b64,
            folder_id=images_folder_id,
        )
    )
    assert dup_att["filename"] == "diagram (2).png"
    assert dup_att["folder_id"] == images_folder_id

    other_folder_att = _tool_object(
        call(
            "upload_attachment",
            filename="notes.txt",
            content_base64=txt_b64,
            folder_path="Physics/handouts",
        )
    )
    assert other_folder_att["filename"] == "notes.txt"
    assert other_folder_att["mime"] == "text/plain"

    # Link the image in a sibling note via relative Markdown embed -> used_by tracks it
    notes_folder = _tool_object(
        call(
            "create_folder",
            name="notes",
            parent_id=by_name["Математический анализ 1"]["id"],
        )
    )
    call(
        "create_note",
        title="Lecture 1",
        folder_id=notes_folder["id"],
        content="See ![graph](../images/diagram.png) here.",
    )

    # List all / root_only / by folder_id
    all_atts = _tool_list(call("list_attachments"))
    assert len(all_atts) == 4
    root_only = _tool_list(call("list_attachments", root_only=True))
    assert [a["id"] for a in root_only] == [root_att["id"]]
    in_images = _tool_list(call("list_attachments", folder_id=images_folder_id))
    assert {a["id"] for a in in_images} == {folder_att["id"], dup_att["id"]}
    by_id = {a["id"]: a for a in in_images}
    assert by_id[folder_att["id"]]["used_by"] == ["Lecture 1"]
    assert by_id[dup_att["id"]]["used_by"] == []

    # Get metadata (without and with base64 content)
    meta = _tool_object(call("get_attachment", attachment_id=folder_att["id"]))
    assert meta["used_by"] == ["Lecture 1"]
    assert "content_base64" not in meta

    with_content = _tool_object(
        call("get_attachment", attachment_id=other_folder_att["id"], include_content_base64=True)
    )
    assert base64.b64decode(with_content["content_base64"]) == txt_bytes

    # Rename in place keeps folder_id unchanged
    renamed = _tool_object(
        call("move_attachment", attachment_id=other_folder_att["id"], filename="renamed.txt")
    )
    assert renamed["filename"] == "renamed.txt"
    assert renamed["folder_id"] == other_folder_att["folder_id"]

    # Move into another folder via folder_path
    moved = _tool_object(
        call(
            "move_attachment",
            attachment_id=other_folder_att["id"],
            folder_path="Archive/Files",
        )
    )
    assert moved["folder_id"] is not None
    assert moved["folder_id"] != other_folder_att["folder_id"]
    assert moved["filename"] == "renamed.txt"

    # Move back to root explicitly
    at_root = _tool_object(
        call("move_attachment", attachment_id=other_folder_att["id"], move_to_root=True)
    )
    assert at_root["folder_id"] is None

    # Move into folder, then omit folder_id/folder_path/filename to move to root
    _tool_object(
        call("move_attachment", attachment_id=other_folder_att["id"], folder_id=images_folder_id)
    )
    back_root = _tool_object(call("move_attachment", attachment_id=other_folder_att["id"]))
    assert back_root["folder_id"] is None

    # Delete attachment
    deleted = _tool_object(call("delete_attachment", attachment_id=other_folder_att["id"]))
    assert deleted == {"status": "deleted"}
    missing = _call_tool(
        mcp_client, token, sid, "get_attachment", {"attachment_id": other_folder_att["id"]}
    )
    assert missing["result"]["isError"] is True
    assert "Not found" in missing["result"]["content"][0]["text"]
    assert other_folder_att["id"] not in {a["id"] for a in _tool_list(call("list_attachments"))}


async def test_mcp_attachments_validation_limits_and_isolation(
    mcp_client: TestClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    alice = await make_user(db_session, "alice")
    bob = await make_user(db_session, "bob")
    _, alice_token = await create_api_token(db_session, alice.id, "alice")
    _, bob_token = await create_api_token(db_session, bob.id, "bob")
    alice_sid = _initialize(mcp_client, alice_token)
    bob_sid = _initialize(mcp_client, bob_token)

    png_b64 = base64.b64encode(_PNG_MAGIC).decode("ascii")

    # Invalid base64 / empty content / empty filename / conflicting folder params / traversal
    bad_b64 = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "upload_attachment",
        {"filename": "bad.png", "content_base64": "not-valid-base64!!!"},
    )
    assert bad_b64["result"]["isError"] is True
    assert "Invalid base64" in bad_b64["result"]["content"][0]["text"]

    empty_b64 = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "upload_attachment",
        {"filename": "empty.txt", "content_base64": "   "},
    )
    assert empty_b64["result"]["isError"] is True

    empty_name = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "upload_attachment",
        {"filename": "   ", "content_base64": png_b64},
    )
    assert empty_name["result"]["isError"] is True

    alice_folder = _tool_object(
        _call_tool(mcp_client, alice_token, alice_sid, "create_folder", {"name": "AliceFolder"})
    )
    both_folders = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "upload_attachment",
        {
            "filename": "a.png",
            "content_base64": png_b64,
            "folder_id": alice_folder["id"],
            "folder_path": "Other",
        },
    )
    assert both_folders["result"]["isError"] is True

    traversal = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "upload_attachment",
        {"filename": "a.png", "content_base64": png_b64, "folder_path": "../secret"},
    )
    assert traversal["result"]["isError"] is True

    bad_list_filter = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "list_attachments",
        {"folder_id": alice_folder["id"], "root_only": True},
    )
    assert bad_list_filter["result"]["isError"] is True

    # Oversized upload rejected via service limit
    small_limit = get_settings().model_copy(update={"max_upload_mb": 1})
    monkeypatch.setattr(attachments_service, "get_settings", lambda: small_limit)
    oversized_b64 = base64.b64encode(b"x" * (1024 * 1024 + 10)).decode("ascii")
    oversized = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "upload_attachment",
        {"filename": "big.bin", "content_base64": oversized_b64},
    )
    assert oversized["result"]["isError"] is True
    assert "exceeds" in oversized["result"]["content"][0]["text"]

    # Inline base64 limit check on get_attachment
    alice_att = _tool_object(
        _call_tool(
            mcp_client,
            alice_token,
            alice_sid,
            "upload_attachment",
            {"filename": "pic.png", "content_base64": png_b64, "folder_id": alice_folder["id"]},
        )
    )
    monkeypatch.setattr(mcp_tools, "_MAX_INLINE_ATTACHMENT_BYTES", 8)
    too_big_inline = _call_tool(
        mcp_client,
        alice_token,
        alice_sid,
        "get_attachment",
        {"attachment_id": alice_att["id"], "include_content_base64": True},
    )
    assert too_big_inline["result"]["isError"] is True
    assert "too large" in too_big_inline["result"]["content"][0]["text"]

    # Ownership isolation between Alice and Bob
    bob_list = _call_tool(mcp_client, bob_token, bob_sid, "list_attachments", {})
    assert _tool_list(bob_list) == []

    for tool, args in (
        ("get_attachment", {"attachment_id": alice_att["id"]}),
        ("move_attachment", {"attachment_id": alice_att["id"], "filename": "hacked.png"}),
        ("delete_attachment", {"attachment_id": alice_att["id"]}),
        (
            "upload_attachment",
            {"filename": "intrude.png", "content_base64": png_b64, "folder_id": alice_folder["id"]},
        ),
    ):
        resp = _call_tool(mcp_client, bob_token, bob_sid, tool, args)
        assert resp["result"]["isError"] is True, (tool, resp)
        assert "Not found" in resp["result"]["content"][0]["text"]

    bob_att = _tool_object(
        _call_tool(
            mcp_client,
            bob_token,
            bob_sid,
            "upload_attachment",
            {"filename": "bob.png", "content_base64": png_b64},
        )
    )
    bob_move_foreign_folder = _call_tool(
        mcp_client,
        bob_token,
        bob_sid,
        "move_attachment",
        {"attachment_id": bob_att["id"], "folder_id": alice_folder["id"]},
    )
    assert bob_move_foreign_folder["result"]["isError"] is True
    assert "Not found" in bob_move_foreign_folder["result"]["content"][0]["text"]
