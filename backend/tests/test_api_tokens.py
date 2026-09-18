from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.api_tokens import create_api_token, resolve_api_token
from tests.conftest import csrf_token, login, make_user


async def test_create_lists_and_never_leaks_the_plaintext_again(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    csrf = await csrf_token(client)
    created = await client.post(
        "/api/v1/me/api-tokens", json={"name": "laptop"}, headers={"x-csrf-token": csrf}
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == "laptop"
    assert len(body["token"]) > 20

    listing = await client.get("/api/v1/me/api-tokens")
    assert listing.status_code == 200
    tokens = listing.json()
    assert len(tokens) == 1
    assert tokens[0]["name"] == "laptop"
    assert "token" not in tokens[0]
    assert "token_hash" not in tokens[0]


async def test_revoke_removes_it_from_the_list_and_invalidates_it(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    csrf = await csrf_token(client)
    created = await client.post(
        "/api/v1/me/api-tokens", json={"name": "phone"}, headers={"x-csrf-token": csrf}
    )
    body = created.json()

    assert await resolve_api_token(db_session, body["token"]) is not None

    delete = await client.delete(
        f"/api/v1/me/api-tokens/{body['id']}", headers={"x-csrf-token": csrf}
    )
    assert delete.status_code == 204

    listing = await client.get("/api/v1/me/api-tokens")
    assert listing.json() == []
    assert await resolve_api_token(db_session, body["token"]) is None


async def test_tokens_are_isolated_between_users(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    csrf = await csrf_token(client)
    await client.post(
        "/api/v1/me/api-tokens", json={"name": "alice-token"}, headers={"x-csrf-token": csrf}
    )

    bob_csrf = second_client.cookies.get("csrf_token")
    bob_listing = await second_client.get("/api/v1/me/api-tokens")
    assert bob_listing.json() == []

    # Bob can't revoke Alice's token either — same isolation guarantee as every other
    # owned resource (404, not 403; see app/core/isolation.py).
    alice_tokens = (await client.get("/api/v1/me/api-tokens")).json()
    delete = await second_client.delete(
        f"/api/v1/me/api-tokens/{alice_tokens[0]['id']}", headers={"x-csrf-token": bob_csrf}
    )
    assert delete.status_code == 404


async def test_resolve_api_token_rejects_garbage_and_inactive_users(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session, "alice")
    _, plain = await create_api_token(db_session, user.id, "cli")

    assert (await resolve_api_token(db_session, plain)).id == user.id
    assert await resolve_api_token(db_session, "not-a-real-token") is None

    user.is_active = False
    await db_session.commit()
    assert await resolve_api_token(db_session, plain) is None
