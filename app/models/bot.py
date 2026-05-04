import enum
import uuid

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._mixins import Timestamps, UUIDPk


class BotChannel(str, enum.Enum):
    web = "web"
    whatsapp = "whatsapp"
    drip = "drip"


class Bot(Base, UUIDPk, Timestamps):
    __tablename__ = "bot"

    site_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("site.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    channel: Mapped[BotChannel] = mapped_column(
        SAEnum(BotChannel, name="bot_channel", native_enum=False, length=16),
        nullable=False,
        default=BotChannel.web,
    )
    public_key: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    # When True, handoff nodes auto-assign the conversation via round-robin.
    # When False, handoff queues the conversation for manual supervisor assignment.
    auto_assign: Mapped[bool] = mapped_column(default=False, nullable=False)
    # Persona — shown in the widget header. Makes the chat feel human.
    persona_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    persona_avatar: Mapped[str | None] = mapped_column(String(512), nullable=True)
