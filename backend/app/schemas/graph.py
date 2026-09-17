import uuid

from pydantic import BaseModel


class GraphNodeOut(BaseModel):
    id: str
    title: str
    folder_id: uuid.UUID | None
    tags: list[str]
    link_count: int
    dangling: bool


class GraphEdgeOut(BaseModel):
    source: str
    target: str
    heading: str | None


class GraphOut(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]
