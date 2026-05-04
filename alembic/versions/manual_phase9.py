"""phase9 api_key table

Revision ID: p9_api_key
Revises: p7bot_persona
Create Date: 2026-04-21 15:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p9_api_key"
down_revision: Union[str, None] = "p7bot_persona"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_key",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("prefix", sa.String(length=16), nullable=False),
        sa.Column("key_hash", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["chatbot.user.id"], ondelete="SET NULL"),
        schema="chatbot",
    )
    op.create_index("ix_chatbot_api_key_prefix", "api_key", ["prefix"], schema="chatbot")


def downgrade() -> None:
    op.drop_index("ix_chatbot_api_key_prefix", "api_key", schema="chatbot")
    op.drop_table("api_key", schema="chatbot")
