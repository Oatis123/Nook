import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note
from app.models.note_link import NoteLink
from app.models.tag import NoteTag, Tag


@dataclass(frozen=True)
class GraphNode:
    id: str
    title: str
    folder_id: uuid.UUID | None
    tags: list[str]
    link_count: int
    dangling: bool


@dataclass(frozen=True)
class GraphEdge:
    source: str
    target: str
    heading: str | None


@dataclass(frozen=True)
class GraphResult:
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)


@dataclass(frozen=True)
class _NoteRow:
    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None
    tags: list[str]


async def _active_notes_with_tags(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[uuid.UUID, _NoteRow]:
    notes = await session.execute(
        select(Note.id, Note.title, Note.folder_id).where(
            Note.user_id == user_id, Note.deleted_at.is_(None)
        )
    )
    rows = {
        row.id: _NoteRow(id=row.id, title=row.title, folder_id=row.folder_id, tags=[])
        for row in notes
    }

    tag_result = await session.execute(
        select(NoteTag.note_id, Tag.name)
        .join(Tag, Tag.id == NoteTag.tag_id)
        .where(NoteTag.note_id.in_(rows.keys()))
    )
    for note_id, tag_name in tag_result.all():
        rows[note_id].tags.append(tag_name)

    return rows


async def _links_from(
    session: AsyncSession, user_id: uuid.UUID, source_ids: set[uuid.UUID]
) -> list[NoteLink]:
    if not source_ids:
        return []
    result = await session.scalars(
        select(NoteLink).where(NoteLink.user_id == user_id, NoteLink.source_note_id.in_(source_ids))
    )
    return list(result)


def _dangling_id(target_raw: str) -> str:
    return f"dangling:{target_raw}"


def _assemble(
    notes: dict[uuid.UUID, _NoteRow],
    included_ids: set[uuid.UUID],
    links: list[NoteLink],
    active_ids: set[uuid.UUID],
    *,
    show_dangling: bool,
    hide_orphans: bool,
) -> GraphResult:
    """Builds the node/edge lists for a resolved set of notes. A note's `link_count` (and
    whether it counts as an "orphan") is the degree within the edges actually returned here
    — i.e. relative to what's currently visible, not the note's global connectivity — since
    that's what the size a user sees on screen should reflect."""
    edges: list[GraphEdge] = []
    dangling_titles: dict[str, str] = {}

    for link in links:
        if link.source_note_id not in included_ids:
            continue
        source = str(link.source_note_id)
        if link.target_note_id is not None and link.target_note_id in active_ids:
            if link.target_note_id not in included_ids:
                continue
            edges.append(
                GraphEdge(source=source, target=str(link.target_note_id), heading=link.heading)
            )
        elif show_dangling:
            target = _dangling_id(link.target_raw)
            dangling_titles[target] = link.target_raw
            edges.append(GraphEdge(source=source, target=target, heading=link.heading))

    degree: dict[str, int] = {}
    for edge in edges:
        degree[edge.source] = degree.get(edge.source, 0) + 1
        degree[edge.target] = degree.get(edge.target, 0) + 1

    if hide_orphans:
        included_ids = {nid for nid in included_ids if degree.get(str(nid), 0) > 0}

    nodes = [
        GraphNode(
            id=str(nid),
            title=notes[nid].title,
            folder_id=notes[nid].folder_id,
            tags=notes[nid].tags,
            link_count=degree.get(str(nid), 0),
            dangling=False,
        )
        for nid in included_ids
    ]
    nodes.extend(
        GraphNode(
            id=target_id,
            title=title,
            folder_id=None,
            tags=[],
            link_count=degree.get(target_id, 0),
            dangling=True,
        )
        for target_id, title in dangling_titles.items()
    )

    return GraphResult(nodes=nodes, edges=edges)


async def build_global_graph(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    folder_id: uuid.UUID | None = None,
    tag: str | None = None,
    hide_orphans: bool = False,
    show_dangling: bool = True,
) -> GraphResult:
    notes = await _active_notes_with_tags(session, user_id)
    active_ids = set(notes.keys())

    included_ids = active_ids
    if folder_id is not None:
        included_ids = {nid for nid in included_ids if notes[nid].folder_id == folder_id}
    if tag is not None:
        included_ids = {nid for nid in included_ids if tag in notes[nid].tags}

    links = await _links_from(session, user_id, included_ids)
    return _assemble(
        notes,
        included_ids,
        links,
        active_ids,
        show_dangling=show_dangling,
        hide_orphans=hide_orphans,
    )


async def build_local_graph(
    session: AsyncSession,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    *,
    depth: int = 1,
    show_dangling: bool = True,
) -> GraphResult:
    notes = await _active_notes_with_tags(session, user_id)
    active_ids = set(notes.keys())
    if note_id not in active_ids:
        return GraphResult()

    all_links = await _links_from(session, user_id, active_ids)
    # Undirected adjacency for BFS — a local graph shows what's connected to this note
    # regardless of link direction, matching Obsidian's local-graph behavior.
    neighbors: dict[uuid.UUID, set[uuid.UUID]] = {}
    for link in all_links:
        if link.target_note_id is None or link.target_note_id not in active_ids:
            continue
        neighbors.setdefault(link.source_note_id, set()).add(link.target_note_id)
        neighbors.setdefault(link.target_note_id, set()).add(link.source_note_id)

    visited = {note_id}
    frontier = {note_id}
    for _ in range(max(depth, 1)):
        frontier = set().union(*(neighbors.get(nid, set()) for nid in frontier)) - visited
        visited |= frontier
        if not frontier:
            break

    links_in_scope = [
        link
        for link in all_links
        if link.source_note_id in visited
        and (link.target_note_id is None or link.target_note_id in visited)
    ]
    return _assemble(
        notes, visited, links_in_scope, active_ids, show_dangling=show_dangling, hide_orphans=False
    )
