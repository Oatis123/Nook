from pydantic import BaseModel


class TagOut(BaseModel):
    name: str
    note_count: int
