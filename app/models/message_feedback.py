"""Per-message thumbs-up/down feedback from visitors."""
import uuid

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._mixins import Timestamps, UUIDPk


class MessageFeedback(Base, UUIDPk, Timestamps):
    __tablename__ = "message_feedback"
    __table_args__ = (
        UniqueConstraint("message_id", "visitor_id", name="uq_message_feedback_voter"),
        CheckConstraint("rating IN ('up','down')", name="ck_message_feedback_rating"),
    )

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("message.id", ondelete="CASCADE"),
        nullable=False,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversation.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    visitor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    rating: Mapped[str] = mapped_column(String(8), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
