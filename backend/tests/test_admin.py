from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserRole
from tests.conftest import login, make_user


async def _login_as_admin(client: AsyncClient, db_session: AsyncSession, username: str = "admin"):
    admin = await make_user(db_session, username, role=UserRole.admin)
    await login(client, username)
    return admin


async def test_non_admin_cannot_list_invites(client: AsyncClient, db_session: AsyncSession) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")

    response = await client.get("/api/v1/admin/invites")
    assert response.status_code == 403


async def test_admin_can_create_list_and_revoke_invite(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _login_as_admin(client, db_session)
    csrf = client.cookies.get("csrf_token")

    create = await client.post(
        "/api/v1/admin/invites",
        json={"comment": "for bob"},
        headers={"x-csrf-token": csrf},
    )
    assert create.status_code == 200
    body = create.json()
    assert body["status"] == "active"
    assert "/invite/" in body["invite_url"]
    invite_id = body["id"]

    listing = await client.get("/api/v1/admin/invites")
    assert listing.status_code == 200
    assert any(i["id"] == invite_id for i in listing.json())

    revoke = await client.post(
        f"/api/v1/admin/invites/{invite_id}/revoke", headers={"x-csrf-token": csrf}
    )
    assert revoke.status_code == 200
    assert revoke.json()["status"] == "revoked"


async def test_admin_can_deactivate_and_reactivate_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _login_as_admin(client, db_session)
    target = await make_user(db_session, "bob")
    csrf = client.cookies.get("csrf_token")

    deactivate = await client.post(
        f"/api/v1/admin/users/{target.id}/deactivate", headers={"x-csrf-token": csrf}
    )
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False

    activate = await client.post(
        f"/api/v1/admin/users/{target.id}/activate", headers={"x-csrf-token": csrf}
    )
    assert activate.status_code == 200
    assert activate.json()["is_active"] is True


async def test_cannot_demote_or_deactivate_last_admin(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _login_as_admin(client, db_session)
    csrf = client.cookies.get("csrf_token")

    demote = await client.post(
        f"/api/v1/admin/users/{admin.id}/role",
        json={"role": "user"},
        headers={"x-csrf-token": csrf},
    )
    assert demote.status_code == 409

    deactivate = await client.post(
        f"/api/v1/admin/users/{admin.id}/deactivate", headers={"x-csrf-token": csrf}
    )
    assert deactivate.status_code == 409


async def test_demote_allowed_when_another_admin_remains(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _login_as_admin(client, db_session)
    await make_user(db_session, "second-admin", role=UserRole.admin)
    csrf = client.cookies.get("csrf_token")

    demote = await client.post(
        f"/api/v1/admin/users/{admin.id}/role",
        json={"role": "user"},
        headers={"x-csrf-token": csrf},
    )
    assert demote.status_code == 200
    assert demote.json()["role"] == "user"


async def test_admin_reset_password_link_can_be_consumed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _login_as_admin(client, db_session)
    target = await make_user(db_session, "bob")
    csrf = client.cookies.get("csrf_token")

    reset = await client.post(
        f"/api/v1/admin/users/{target.id}/reset-password", headers={"x-csrf-token": csrf}
    )
    assert reset.status_code == 200
    reset_url = reset.json()["reset_url"]
    token = reset_url.rsplit("/", 1)[-1]

    consume = await client.post(
        f"/api/v1/auth/password-reset/{token}", json={"new_password": "brand-new-password"}
    )
    assert consume.status_code == 204

    login_response = await login(client, "bob", password="brand-new-password")
    assert login_response.status_code == 200


async def test_admin_unlink_telegram(client: AsyncClient, db_session: AsyncSession) -> None:
    await _login_as_admin(client, db_session)
    target = await make_user(db_session, "bob")
    target.telegram_user_id = 12345
    target.telegram_chat_id = 6789
    await db_session.commit()
    csrf = client.cookies.get("csrf_token")

    response = await client.post(
        f"/api/v1/admin/users/{target.id}/unlink-telegram", headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 200
    assert response.json()["telegram_linked"] is False


async def test_user_cannot_see_or_revoke_another_users_session(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await make_user(db_session, "bob")
    await login(client, "alice")
    await login(second_client, "bob")

    alice_sessions = await client.get("/api/v1/auth/sessions")
    assert alice_sessions.status_code == 200
    assert len(alice_sessions.json()) == 1

    bob_session_id = (await second_client.get("/api/v1/auth/sessions")).json()[0]["id"]

    csrf = client.cookies.get("csrf_token")
    response = await client.delete(
        f"/api/v1/auth/sessions/{bob_session_id}", headers={"x-csrf-token": csrf}
    )
    assert response.status_code == 404
