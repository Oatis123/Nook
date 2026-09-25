from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tokens import hash_token
from app.models.auth_token import AuthToken
from app.services import telegram_link as telegram_link_service
from tests.conftest import DEFAULT_PASSWORD, login, make_user


async def test_consume_link_token_links_user(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    plain, _ = await telegram_link_service.create_link_token(db_session, user.id)

    linked = await telegram_link_service.consume_link_token(db_session, plain, 111, 222)

    assert linked is not None
    assert linked.telegram_user_id == 111
    assert linked.telegram_chat_id == 222


async def test_consume_link_token_rejects_reuse(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    plain, _ = await telegram_link_service.create_link_token(db_session, user.id)
    await telegram_link_service.consume_link_token(db_session, plain, 111, 222)

    second = await telegram_link_service.consume_link_token(db_session, plain, 111, 222)

    assert second is None


async def test_consume_link_token_rejects_expired(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    plain, _ = await telegram_link_service.create_link_token(db_session, user.id)

    row = await db_session.scalar(
        select(AuthToken).where(AuthToken.token_hash == hash_token(plain))
    )
    assert row is not None
    row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()

    linked = await telegram_link_service.consume_link_token(db_session, plain, 111, 222)
    assert linked is None


async def test_consume_link_token_rejects_telegram_account_already_linked_elsewhere(
    db_session: AsyncSession,
) -> None:
    alice = await make_user(db_session, "alice")
    bob = await make_user(db_session, "bob")
    alice_plain, _ = await telegram_link_service.create_link_token(db_session, alice.id)
    await telegram_link_service.consume_link_token(db_session, alice_plain, 111, 222)

    bob_plain, _ = await telegram_link_service.create_link_token(db_session, bob.id)
    result = await telegram_link_service.consume_link_token(db_session, bob_plain, 111, 999)

    assert result is None


async def test_login_token_flow_confirmed(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    plain, _ = await telegram_link_service.create_login_token(db_session, "Chrome", "1.2.3.4")

    status_pending, user_pending = await telegram_link_service.claim_login_token(db_session, plain)
    assert status_pending == "pending"
    assert user_pending is None

    token = await telegram_link_service.find_login_token_by_plain(db_session, plain)
    assert token is not None
    await telegram_link_service.attach_login_requester(db_session, token, user.id)
    await telegram_link_service.set_login_status(db_session, token, "confirmed")

    status_confirmed, confirmed_user = await telegram_link_service.claim_login_token(
        db_session, plain
    )
    assert status_confirmed == "confirmed"
    assert confirmed_user is not None
    assert confirmed_user.id == user.id

    status_again, user_again = await telegram_link_service.claim_login_token(db_session, plain)
    assert status_again == "expired"
    assert user_again is None


async def test_login_token_flow_denied(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    plain, _ = await telegram_link_service.create_login_token(db_session, None, None)
    token = await telegram_link_service.find_login_token_by_plain(db_session, plain)
    assert token is not None
    await telegram_link_service.attach_login_requester(db_session, token, user.id)
    await telegram_link_service.set_login_status(db_session, token, "denied")

    status_denied, denied_user = await telegram_link_service.claim_login_token(db_session, plain)

    assert status_denied == "denied"
    assert denied_user is None


async def test_create_telegram_link_token_endpoint(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice", linked=False)
    await login(client, "alice")
    csrf = client.cookies.get("csrf_token")

    response = await client.post("/api/v1/me/telegram/link-token", headers={"x-csrf-token": csrf})

    assert response.status_code == 200
    assert "?start=link_" in response.json()["deep_link_url"]


async def test_telegram_login_status_endpoint_flow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await make_user(db_session, "alice")
    await client.get("/health")
    csrf = client.cookies.get("csrf_token")

    create = await client.post("/api/v1/auth/telegram/login-token", headers={"x-csrf-token": csrf})
    assert create.status_code == 200
    deep_link_url = create.json()["deep_link_url"]
    plain_token = deep_link_url.rsplit("login_", 1)[-1]

    pending = await client.post(
        "/api/v1/auth/telegram/login-status",
        json={"token": plain_token},
        headers={"x-csrf-token": csrf},
    )
    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"

    token = await telegram_link_service.find_login_token_by_plain(db_session, plain_token)
    assert token is not None
    await telegram_link_service.attach_login_requester(db_session, token, user.id)
    await telegram_link_service.set_login_status(db_session, token, "confirmed")

    confirmed = await client.post(
        "/api/v1/auth/telegram/login-status",
        json={"token": plain_token},
        headers={"x-csrf-token": csrf},
    )
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["status"] == "confirmed"
    assert body["user"]["username"] == "alice"
    assert "access_token" in confirmed.cookies


async def test_self_service_unlink(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    user.telegram_user_id = 555
    user.telegram_chat_id = 777
    await db_session.commit()
    await login(client, "alice")
    csrf = client.cookies.get("csrf_token")

    response = await client.post(
        "/api/v1/me/telegram/unlink",
        json={"current_password": DEFAULT_PASSWORD},
        headers={"x-csrf-token": csrf},
    )

    assert response.status_code == 200
    assert response.json()["telegram_linked"] is False
