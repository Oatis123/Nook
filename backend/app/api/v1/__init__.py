from fastapi import APIRouter

from app.api.v1 import admin, auth, folders, me, notes, tags

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(admin.router)
api_router.include_router(folders.router)
api_router.include_router(notes.router)
api_router.include_router(tags.router)
