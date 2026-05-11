import uuid as _uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._mixins import Timestamps, UUIDPk


class PushSubscription(Base, UUIDPk, Timestamps):
    """One row per browser device a user has subscribed to push from.

    Endpoint is unique globally — a single device's PushSubscription is
    bound to one user at a time. On the same device, signing out and
    back in as a different user causes the new subscribe call to take
    over the existing endpoint via ON CONFLICT.
    """
    __tablename__ = "push_subscription"
    __table_args__ = {"schema": "chatbot"}

    user_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("chatbot.user.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # The push service URL the browser handed us at subscription time. Globally
    # unique — re-subscribing from the same browser returns the same endpoint.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # ECDH key material the browser uses to decrypt our pushes.
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
