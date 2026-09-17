from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserRole
from app.services import invites as invites_service
from tests.conftest import csrf_token, login, make_user


async def test_login_success_sets_cookies(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")

    response = await login(client, "alice")

    assert response.status_code == 200
    assert response.json()["username"] == "alice"
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


async def test_login_wrong_password_fails(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")

    response = await login(client, "alice", password="wrong-password")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


async def test_login_unknown_user_fails(client: AsyncClient) -> None:
    response = await login(client, "ghost")
    assert response.status_code == 401


async def test_login_rate_limited_after_five_failures(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")

    for _ in range(5):
        response = await login(client, "alice", password="wrong-password")
        assert response.status_code == 401

    response = await login(client, "alice", password="wrong-password")
    assert response.status_code == 429


async def test_mutating_request_without_csrf_header_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await client.get("/health")  # picks up the csrf cookie, but we won't send the header

    response = await client.post(
        "/api/v1/auth/login", json={"username": "alice", "password": "correct-password"}
    )

    assert response.status_code == 403


async def test_refresh_rotates_token_and_invalidates_old_one(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    old_refresh = client.cookies.get("refresh_token")

    csrf = client.cookies.get("csrf_token")
    response = await client.post("/api/v1/auth/refresh", headers={"x-csrf-token": csrf})
    assert response.status_code == 200
    new_refresh = client.cookies.get("refresh_token")
    assert new_refresh != old_refresh

    client.cookies.set("refresh_token", old_refresh)
    replay = await client.post("/api/v1/auth/refresh", headers={"x-csrf-token": csrf})
    assert replay.status_code == 401


async def test_logout_revokes_session(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = client.cookies.get("csrf_token")

    logout_response = await client.post("/api/v1/auth/logout", headers={"x-csrf-token": csrf})
    assert logout_response.status_code == 204

    refresh_response = await client.post("/api/v1/auth/refresh", headers={"x-csrf-token": csrf})
    assert refresh_response.status_code == 401


async def test_invite_accept_creates_user_and_logs_in(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await make_user(db_session, "admin", role=UserRole.admin)
    _invite, plain_token = await invites_service.create_invite(db_session, admin.id, None, None)

    csrf = await csrf_token(second_client)
    response = await second_client.post(
        "/api/v1/auth/invite/accept",
        json={
            "token": plain_token,
            "username": "bob",
            "password": "a-new-password",
            "timezone": "UTC",
        },
        headers={"x-csrf-token": csrf},
    )

    assert response.status_code == 200
    assert response.json()["username"] == "bob"
    assert "access_token" in response.cookies


async def test_invite_cannot_be_used_twice(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await make_user(db_session, "admin", role=UserRole.admin)
    _invite, plain_token = await invites_service.create_invite(db_session, admin.id, None, None)

    csrf = await csrf_token(second_client)
    body = {
        "token": plain_token,
        "username": "bob",
        "password": "a-new-password",
        "timezone": "UTC",
    }
    first = await second_client.post(
        "/api/v1/auth/invite/accept", json=body, headers={"x-csrf-token": csrf}
    )
    assert first.status_code == 200

    csrf2 = await csrf_token(client)
    second = await client.post(
        "/api/v1/auth/invite/accept",
        json={**body, "username": "carol"},
        headers={"x-csrf-token": csrf2},
    )
    assert second.status_code == 404


async def test_expired_invite_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    admin = await make_user(db_session, "admin", role=UserRole.admin)
    _invite, plain_token = await invites_service.create_invite(
        db_session, admin.id, None, expires_in_days=None
    )
    _invite.expires_at = _invite.expires_at.replace(year=2000)
    await db_session.commit()

    response = await client.get(f"/api/v1/auth/invite/{plain_token}")
    assert response.status_code == 404


async def test_password_change_keeps_current_session_revokes_others(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    await login(second_client, "alice")

    csrf = client.cookies.get("csrf_token")
    response = await client.post(
        "/api/v1/me/password",
        json={"current_password": "correct-password", "new_password": "a-different-password"},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 204

    me = await client.get("/api/v1/me")
    assert me.status_code == 200

    second_csrf = second_client.cookies.get("csrf_token")
    other_refresh = await second_client.post(
        "/api/v1/auth/refresh", headers={"x-csrf-token": second_csrf}
    )
    assert other_refresh.status_code == 401
