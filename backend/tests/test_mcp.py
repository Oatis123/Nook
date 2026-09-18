"""End-to-end coverage for the MCP server (app/mcp/) over its real HTTP transport —
this is the layer with the fiddly wiring (auth middleware, mounting, the session
manager's own lifespan), so it's worth proving the whole stack works together once,
on top of the plainer service-level tests in test_api_tokens.py."""

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.testclient import TestClient

import app.mcp.tools as mcp_tools
import app.mcp.verifier as mcp_verifier
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
