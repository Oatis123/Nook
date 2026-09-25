from fastapi import APIRouter, Depends

from app.api.v1 import (
    admin,
    api_tokens,
    attachments,
    auth,
    folders,
    graph,
    import_jobs,
    me,
    notes,
    search,
    tags,
    task_lists,
    tasks,
)
from app.core.deps import require_telegram_linked

api_router = APIRouter(prefix="/api/v1")
# Usable before Telegram is linked: signing in/out and the account itself (the
# onboarding gate needs /me and /me/telegram/*).
api_router.include_router(auth.router)
api_router.include_router(me.router)

# Everything else requires a linked Telegram account (spec §5.1).
_linked = [Depends(require_telegram_linked)]
for feature_router in (
    api_tokens.router,
    admin.router,
    folders.router,
    notes.router,
    tags.router,
    search.router,
    attachments.router,
    import_jobs.router,
    graph.router,
    task_lists.router,
    tasks.router,
):
    api_router.include_router(feature_router, dependencies=_linked)
