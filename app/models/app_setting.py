"""Global, app-wide key/value configuration. One row per setting key."""
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._mixins import Timestamps


class AppSetting(Base, Timestamps):
    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
