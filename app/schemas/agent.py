import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ConversationOut(BaseModel):
    id: uuid.UUID
    bot_id: uuid.UUID
    visitor_id: str
    status: str
    created_at: datetime
    closed_at: datetime | None = None
    last_message_at: datetime | None = None
    last_body: str | None = None
    assigned_to_name: str | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    sender: str
    kind: str
    body: str | None
    payload: dict[str, Any]
    created_at: datetime


class ConversationDetail(BaseModel):
    id: uuid.UUID
    bot_id: uuid.UUID
    visitor_id: str
    status: str
    created_at: datetime
    closed_at: datetime | None = None
    assigned_user_id: uuid.UUID | None = None
    assigned_to_name: str | None = None
    messages: list[MessageOut]


class AgentMessageRequest(BaseModel):
    text: str = ""
    # Optional attachment — when set, the message is rendered as image/document
    # and `text` is treated as an optional caption.
    attachment_url: str | None = None
    attachment_kind: str | None = None  # "image" | "document"
    attachment_filename: str | None = None


class AssignRequest(BaseModel):
    user_id: uuid.UUID | None = None  # None → round-robin
