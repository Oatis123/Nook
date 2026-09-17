import re
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_FILTER_RE = re.compile(r"(?:^|\s)(tag|path|in):(\S+)")


@dataclass(frozen=True)
class SearchFilters:
    text: str
    tag: str | None
    path: str | None
    scope: str  # "notes" | "tasks" | "all"


def parse_query(raw: str) -> SearchFilters:
    """Pulls `tag:`, `path:`, `in:` tokens out of the query (spec §6.7), leaving the rest
    as free text for full-text search."""
    tag = path = None
    scope = "all"
    for match in _FILTER_RE.finditer(raw):
        key, value = match.group(1), match.group(2)
        if key == "tag":
            tag = value
        elif key == "path":
            path = value
        elif key == "in":
            scope = value
    remaining = re.sub(r"\s+", " ", _FILTER_RE.sub(" ", raw)).strip()
    return SearchFilters(text=remaining, tag=tag, path=path, scope=scope)


@dataclass(frozen=True)
class NoteSearchResult:
    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None
    snippet: str


async def search_notes(
    session: AsyncSession, user_id: uuid.UUID, filters: SearchFilters, limit: int = 30
) -> list[NoteSearchResult]:
    if filters.scope not in ("notes", "all"):
        return []

    conditions = ["n.user_id = :user_id", "n.deleted_at IS NULL"]
    params: dict[str, object] = {"user_id": str(user_id), "limit": limit}

    if filters.text:
        conditions.append("(n.search_vector_en @@ query_en OR n.search_vector_ru @@ query_ru)")
        params["q"] = filters.text
    if filters.tag:
        conditions.append(
            "EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id "
            "WHERE nt.note_id = n.id AND t.user_id = :user_id AND t.name = :tag)"
        )
        params["tag"] = filters.tag
    if filters.path:
        conditions.append(
            "EXISTS (SELECT 1 FROM folders f WHERE f.id = n.folder_id AND f.name ILIKE :path)"
        )
        params["path"] = f"{filters.path}%"

    where_clause = " AND ".join(conditions)

    if filters.text:
        query = text(
            f"""
            SELECT n.id, n.title, n.folder_id,
                CASE WHEN n.search_vector_en @@ query_en
                    THEN ts_headline('english', n.content, query_en,
                        'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=25,MinWords=8')
                    ELSE ts_headline('russian', n.content, query_ru,
                        'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=25,MinWords=8')
                END AS snippet,
                (ts_rank(n.search_vector_en, query_en)
                    + ts_rank(n.search_vector_ru, query_ru)) AS rank
            FROM notes n,
                plainto_tsquery('english', :q) query_en,
                plainto_tsquery('russian', :q) query_ru
            WHERE {where_clause}
            ORDER BY rank DESC, n.title
            LIMIT :limit
            """
        )
    else:
        query = text(
            f"""
            SELECT n.id, n.title, n.folder_id, left(n.content, 160) AS snippet, 0 AS rank
            FROM notes n
            WHERE {where_clause}
            ORDER BY n.title
            LIMIT :limit
            """
        )

    result = await session.execute(query, params)
    return [
        NoteSearchResult(id=row.id, title=row.title, folder_id=row.folder_id, snippet=row.snippet)
        for row in result
    ]
