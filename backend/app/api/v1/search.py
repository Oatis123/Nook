from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, DbSession
from app.schemas.search import SearchResultOut
from app.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[SearchResultOut])
async def search(
    q: str, user: CurrentUser, session: DbSession, limit: int = Query(default=30, le=100)
) -> list[SearchResultOut]:
    filters = search_service.parse_query(q)
    results = await search_service.search_notes(session, user.id, filters, limit=limit)
    return [
        SearchResultOut(id=r.id, title=r.title, folder_id=r.folder_id, snippet=r.snippet)
        for r in results
    ]
