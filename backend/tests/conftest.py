import asyncio
from collections.abc import AsyncIterator

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Imported for side effects: registers all mapped models on Base.metadata.
import app.models  # noqa: F401
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User, UserRole

DEFAULT_PASSWORD = "correct-password"


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> None:
    """Login rate limiting is process-global state (app/core/rate_limit.py); tests all
    go through ASGITransport with no real client IP, so every test effectively shares
    one bucket per username unless it's reset between tests."""
    rate_limit.reset_all()


@pytest.fixture(scope="session", autouse=True)
def _ensure_test_database() -> None:
    """Tests run against `<postgres_db>_test`, never the database used by `docker compose
    up` / manual runs — db_engine below does create_all/drop_all every test, which would
    otherwise wipe real dev data. Uses its own throwaway event loop (asyncio.run) rather
    than an async fixture, since a session-scoped async fixture would outlive and conflict
    with pytest-asyncio's per-test event loops."""
    settings = get_settings()

    async def _create() -> None:
        conn = await asyncpg.connect(
            user=settings.postgres_user,
            password=settings.postgres_password,
            host=settings.postgres_host,
            port=settings.postgres_port,
            database=settings.postgres_db,
        )
        try:
            await conn.execute(f'CREATE DATABASE "{settings.postgres_db}_test"')
        except asyncpg.DuplicateDatabaseError:
            pass
        finally:
            await conn.close()

    asyncio.run(_create())


@pytest.fixture
async def db_engine() -> AsyncIterator[object]:
    settings = get_settings()
    engine = create_async_engine(settings.test_database_url)
    async with engine.begin() as conn:
        # notes.ix_notes_title_trgm uses gin_trgm_ops (see migration b0537c5876c8) —
        # create_all doesn't run extension DDL, so it must be created explicitly here.
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine) -> AsyncIterator[AsyncSession]:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def second_client(client: AsyncClient) -> AsyncIterator[AsyncClient]:
    """A second cookie jar against the same app + overridden DB session as `client`
    (depends on `client` so the get_db override is guaranteed to be in place)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def make_user(
    session: AsyncSession, username: str = "alice", role: UserRole = UserRole.user
) -> User:
    user = User(username=username, password_hash=hash_password(DEFAULT_PASSWORD), role=role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def csrf_token(client: AsyncClient) -> str:
    await client.get("/health")
    token = client.cookies.get("csrf_token")
    assert token is not None
    return token


async def login(client: AsyncClient, username: str, password: str = DEFAULT_PASSWORD):
    csrf = await csrf_token(client)
    return await client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
        headers={"x-csrf-token": csrf},
    )
