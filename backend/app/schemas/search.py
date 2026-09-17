import uuid

from pydantic import BaseModel


class SearchResultOut(BaseModel):
    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None
    snippet: str
