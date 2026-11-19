"""Request schema for POST /v1/ask.

Field names and limits are the internal HTTP contract with
internal/knowledge/remote.go (spec §4.1) — rename or resize here and the Go
side breaks. Oversize/empty fields -> pydantic 422 before any LLM call.
"""
from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    source: str = Field(min_length=1, max_length=20000)
