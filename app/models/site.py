from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._mixins import Timestamps, UUIDPk


class Site(Base, UUIDPk, Timestamps):
    __tablename__ = "site"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    # Exact origins (scheme + host + optional port) the widget may be embedded
    # on. Empty list = unrestricted (back-compat for sites created before C4).
    # Validated against the Origin header on every widget POST.
    allowed_origins: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
