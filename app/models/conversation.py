import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._mixins import Timestamps, UUIDPk


class ConversationStatus(str, enum.Enum):
    bot = "bot"
    queued = "queued"
    assigned = "assigned"
    ai = "ai"
    closed = "closed"


class MessageSender(str, enum.Enum):
    visitor = "visitor"
    bot = "bot"
    agent = "agent"
    system = "system"


class AssignmentMode(str, enum.Enum):
    manual = "manual"
    round_robin = "round_robin"


class Conversation(Base, UUIDPk, Timestamps):
    __tablename__ = "conversation"

    bot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bot.id", ondelete="CASCADE"), nullable=False
    )
    visitor_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[ConversationStatus] = mapped_column(
        SAEnum(
            ConversationStatus,
            name="conversation_status",
            native_enum=False,
            length=16,
        ),
        nullable=False,
        default=ConversationStatus.bot,
    )
    # Runtime state the flow engine reads/writes (current node, answers, etc.)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )


class Message(Base, UUIDPk, Timestamps):
    __tablename__ = "message"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversation.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sender: Mapped[MessageSender] = mapped_column(
        SAEnum(MessageSender, name="message_sender", native_enum=False, length=16),
        nullable=False,
    )
    sender_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="text")
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Assignment(Base, UUIDPk, Timestamps):
    __tablename__ = "assignment"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversation.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    mode: Mapped[AssignmentMode] = mapped_column(
        SAEnum(AssignmentMode, name="assignment_mode", native_enum=False, length=16),
        nullable=False,
    )
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
