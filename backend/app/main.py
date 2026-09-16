from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.services.admin import bootstrap_admin_if_empty

settings = get_settings()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log.info("api.startup", app_name=settings.app_name, environment=settings.environment)
    async with async_session_factory() as session:
        await bootstrap_admin_if_empty(session, settings.admin_username, settings.admin_password)
    yield


app = FastAPI(
    title=f"{settings.app_name} API",
    docs_url="/api/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.environment != "production" else None,
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
