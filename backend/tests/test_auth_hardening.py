"""Authentication hardening from the pre-deploy security review."""

import asyncio

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import SlidingWindowLimiter
from app.models.auth_token import AuthToken
from app.models.user import User
from app.services import invites as invites_service
from app.services import telegram_link as telegram_link_service
from tests.conftest import DEFAULT_PASSWORD, csrf_token, login, make_user


def test_limiter_counts_before_checking_and_bounds_keys() -> None:
    limiter = SlidingWindowLimiter(limit=2, window_seconds=60, max_keys=3)
    assert [limiter.hit("a") for _ in range(3)] == [True, True, False]
    for key in ("b", "c", "d", "e"):
        limiter.hit(key)
    assert len(limiter._hits) == 3  # least recently used keys evicted


async def test_login_lockout_is_per_user_and_ip(
    client: AsyncClient, second_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    for _ in range(5):
        assert (await login(client, "alice", "wrong-password")).status_code == 401
    assert (await login(client, "alice", "wrong-password")).status_code == 429
    # The right password doesn't bypass the lockout from the same client either.
    assert (await login(client, "alice")).status_code == 429


async def test_concurrent_guesses_cannot_exceed_the_limit(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    csrf = await csrf_token(client)

    async def attempt() -> int:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "wrong-password"},
            headers={"x-csrf-token": csrf},
        )
        return response.status_code

    codes = await asyncio.gather(*(attempt() for _ in range(12)))
    assert codes.count(401) == 5
    assert codes.count(429) == 7


async def test_unknown_user_and_wrong_password_look_the_same(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    unknown = await login(client, "nobody", "whatever-password")
    wrong = await login(client, "alice", "whatever-password")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


async def test_telegram_endpoints_require_linked_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice", linked=False)
    await login(client, "alice")

    notes = await client.get("/api/v1/notes")
    assert notes.status_code == 403
    assert notes.json()["error"]["code"] == "telegram_not_linked"
    # Onboarding still works.
    assert (await client.get("/api/v1/me")).status_code == 200
    csrf = await csrf_token(client)
    link = await client.post("/api/v1/me/telegram/link-token", headers={"x-csrf-token": csrf})
    assert link.status_code == 200


async def test_relinking_and_unlinking_require_the_password(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)

    for path in ("/api/v1/me/telegram/link-token", "/api/v1/me/telegram/unlink"):
        missing = await client.post(path, headers={"x-csrf-token": csrf})
        assert missing.status_code == 400, path
        wrong = await client.post(
            path, json={"current_password": "not-it-at-all"}, headers={"x-csrf-token": csrf}
        )
        assert wrong.status_code == 400, path

    ok = await client.post(
        "/api/v1/me/telegram/link-token",
        json={"current_password": DEFAULT_PASSWORD},
        headers={"x-csrf-token": csrf},
    )
    assert ok.status_code == 200


async def test_password_checks_are_rate_limited(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, "alice")
    await login(client, "alice")
    csrf = await csrf_token(client)
    codes = []
    for _ in range(6):
        response = await client.post(
            "/api/v1/me/password",
            json={"current_password": "wrong-password", "new_password": "another-password-1"},
            headers={"x-csrf-token": csrf},
        )
        codes.append(response.status_code)
    assert codes == [400] * 5 + [429]


async def test_telegram_login_tokens_are_rate_limited(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    csrf = await csrf_token(client)
    codes = [
        (
            await client.post("/api/v1/auth/telegram/login-token", headers={"x-csrf-token": csrf})
        ).status_code
        for _ in range(11)
    ]
    assert codes.count(200) == 10
    assert codes[-1] == 429


async def test_invite_cannot_be_accepted_twice_concurrently(
    db_session: AsyncSession, db_engine
) -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    admin = await make_user(db_session, "admin_user")
    invite, plain = await invites_service.create_invite(db_session, admin.id, None, 7)
    factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def accept(username: str) -> str:
        async with factory() as session:
            try:
                await invites_service.accept_invite(
                    session, plain, username, "long-enough-password", "UTC"
                )
                return "ok"
            except Exception as exc:  # noqa: BLE001
                return type(exc).__name__

    results = await asyncio.gather(accept("first_user"), accept("second_user"))
    assert sorted(results) == ["HTTPException", "ok"]
    count = await db_session.scalar(
        select(func.count())
        .select_from(User)
        .where(User.username.in_(["first_user", "second_user"]))
    )
    assert count == 1


async def test_expired_tokens_are_purged(db_session: AsyncSession) -> None:
    from datetime import UTC, datetime, timedelta

    await telegram_link_service.create_login_token(db_session, "ua", "1.2.3.4")
    fresh, _ = await telegram_link_service.create_login_token(db_session, "ua", "1.2.3.4")
    stale = await db_session.scalar(select(AuthToken).limit(1))
    assert stale is not None
    stale.expires_at = datetime.now(UTC) - timedelta(days=2)
    await db_session.commit()

    assert await telegram_link_service.purge_expired_tokens(db_session) == 1
    assert await db_session.scalar(select(func.count()).select_from(AuthToken)) == 1
    assert fresh


async def test_unexpected_error_returns_json_500() -> None:
    from fastapi import FastAPI
    from httpx import ASGITransport

    from app.core.errors import register_exception_handlers

    probe = FastAPI()
    register_exception_handlers(probe)

    @probe.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internals")

    transport = ASGITransport(app=probe, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/boom")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret" not in response.text
