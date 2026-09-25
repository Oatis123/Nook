from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AsyncExitStack, asynccontextmanager

import structlog
from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.cookies import CSRF_COOKIE, ensure_csrf_cookie
from app.core.db import async_session_factory, get_db
from app.core.errors import register_exception_handlers
from app.mcp.asgi import app as mcp_app
from app.services.admin import bootstrap_admin_if_empty

settings = get_settings()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log.info("api.startup", app_name=settings.app_name, environment=settings.environment)
    async with async_session_factory() as session:
        await bootstrap_admin_if_empty(session, settings.admin_username, settings.admin_password)
    # The MCP server's Starlette app (app/mcp/asgi.py) owns its own session-manager
    # lifespan — mounting it doesn't run that automatically, so it's entered here
    # alongside this app's own startup (see AsyncExitStack use below).
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(mcp_app.router.lifespan_context(mcp_app))
        yield


app = FastAPI(
    title=f"{settings.app_name} API",
    docs_url="/api/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.environment != "production" else None,
    lifespan=lifespan,
)

register_exception_handlers(app)
app.include_router(api_router)


@app.middleware("http")
async def csrf_cookie_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Issues a readable CSRF cookie on any response that doesn't already have one, so
    the frontend always has a double-submit token available before its first mutating
    request (spec §5.4)."""
    response = await call_next(request)
    ensure_csrf_cookie(request.cookies.get(CSRF_COOKIE), response)
    return response


@app.get("/health", response_model=None)
async def health(session: AsyncSession = Depends(get_db)) -> dict[str, str] | JSONResponse:
    """Liveness plus a database round-trip, so the compose healthcheck (and anything
    gating on it: worker, bot, web) sees the API as down when Postgres is unreachable."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        log.exception("health.db_unreachable")
        return JSONResponse(status_code=503, content={"status": "db_unavailable"})
    return {"status": "ok"}


# Mounted last (and at root, not "/mcp") so it never shadows the routes above — its own
# internal route is already "/mcp" (see app/mcp/asgi.py), Starlette tries this app's own
# routes first, and anything unmatched here still 404s instead of reaching the MCP app.
app.mount("/", mcp_app)
