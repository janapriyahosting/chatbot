import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.bot import BotChannel


class SiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    domain: str = Field(min_length=1, max_length=255)


class SiteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    domain: str
    created_at: datetime


class BotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    channel: BotChannel = BotChannel.web
    site_id: uuid.UUID | None = None


class BotUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    auto_assign: bool | None = None
    persona_name: str | None = Field(default=None, max_length=60)
    persona_avatar: str | None = Field(default=None, max_length=512)
    widget_footer_text: str | None = Field(default=None, max_length=120)
    theme_color: str | None = Field(default=None, max_length=16)


class BotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID | None
    name: str
    channel: BotChannel
    public_key: str
    is_active: bool
    auto_assign: bool
    persona_name: str | None = None
    persona_avatar: str | None = None
    widget_footer_text: str | None = None
    theme_color: str | None = None
    created_at: datetime
