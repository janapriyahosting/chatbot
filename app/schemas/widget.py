import uuid
from typing import Any

from pydantic import BaseModel, Field


class UtmPayload(BaseModel):
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_term: str | None = None
    utm_content: str | None = None
    gclid: str | None = None
    fbclid: str | None = None
    referrer: str | None = None
    landing_url: str | None = None


class SessionStart(BaseModel):
    bot_key: str = Field(min_length=1, max_length=64)
    visitor_id: str | None = Field(default=None, max_length=64)
    utm: UtmPayload | None = None


class ReplyRequest(BaseModel):
    conversation_id: uuid.UUID
    payload: dict[str, Any] = Field(default_factory=dict)


class Persona(BaseModel):
    name: str | None = None
    avatar: str | None = None


class StepResponse(BaseModel):
    conversation_id: uuid.UUID
    visitor_id: str
    outputs: list[dict[str, Any]]
    awaiting: dict[str, Any] | None
    ended: bool
    status: str = "bot"
    persona: Persona | None = None


class PollRequest(BaseModel):
    conversation_id: uuid.UUID
    since_id: uuid.UUID | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    sender: str
    kind: str
    body: str | None
    payload: dict[str, Any]
    created_at: str


class PollResponse(BaseModel):
    status: str
    messages: list[MessageOut]
    agent_name: str | None = None


class WidgetMessageRequest(BaseModel):
    conversation_id: uuid.UUID
    text: str
