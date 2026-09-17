import uuid

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, DbSession
from app.schemas.graph import GraphEdgeOut, GraphNodeOut, GraphOut
from app.services import graph as graph_service
from app.services.graph import GraphResult

router = APIRouter(prefix="/graph", tags=["graph"])


def _to_out(result: GraphResult) -> GraphOut:
    return GraphOut(
        nodes=[GraphNodeOut(**vars(n)) for n in result.nodes],
        edges=[GraphEdgeOut(**vars(e)) for e in result.edges],
    )


@router.get("", response_model=GraphOut)
async def get_graph(
    user: CurrentUser,
    session: DbSession,
    note_id: uuid.UUID | None = None,
    depth: int = Query(default=1, ge=1, le=2),
    folder_id: uuid.UUID | None = None,
    tag: str | None = None,
    hide_orphans: bool = False,
    show_dangling: bool = True,
) -> GraphOut:
    if note_id is not None:
        result = await graph_service.build_local_graph(
            session, user.id, note_id, depth=depth, show_dangling=show_dangling
        )
    else:
        result = await graph_service.build_global_graph(
            session,
            user.id,
            folder_id=folder_id,
            tag=tag,
            hide_orphans=hide_orphans,
            show_dangling=show_dangling,
        )
    return _to_out(result)
