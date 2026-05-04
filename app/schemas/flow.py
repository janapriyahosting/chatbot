import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class FlowNode(BaseModel):
    """A single node in the flow graph.

    `type` drives runtime behavior (text/image/video/carousel/form/api/ai/...).
    `config` is free-form per node type; validated by the runtime, not here.
    """

    id: str = Field(min_length=1, max_length=64)
    type: Literal[
        "start",
        "text",
        "image",
        "video",
        "document",
        "carousel",
        "buttons",
        "list",
        "input",
        "form",
        "schedule",
        "otp",
        "api",
        "condition",
        "ai",
        "handoff",
        "end",
    ]
    config: dict[str, Any] = Field(default_factory=dict)


class FlowEdge(BaseModel):
    source: str
    target: str
    condition: str | None = None  # e.g. button value, condition label


class FlowDefinition(BaseModel):
    # Preserve frontend-only bookkeeping like `__positions` so the canvas
    # layout survives a page reload. Runtime code ignores unknown keys.
    model_config = ConfigDict(extra="allow")

    nodes: list[FlowNode]
    edges: list[FlowEdge]
    start_node: str


class FlowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    definition: FlowDefinition


class FlowUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    definition: FlowDefinition | None = None


class FlowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bot_id: uuid.UUID
    name: str
    current_version: int
    is_published: bool
    definition: dict
    created_at: datetime
    updated_at: datetime
    warnings: list[str] = []


class FlowPreviewRequest(BaseModel):
    definition: FlowDefinition
    reply: dict | None = None
    context: dict | None = None
