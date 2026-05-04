"""csat_rating

Revision ID: p15_csat
Revises: p14_settings
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "p15_csat"
down_revision: Union[str, None] = "p14_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "csat_rating",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chatbot.conversation.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("agent_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chatbot.user.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("positive", sa.Boolean(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema="chatbot",
    )


def downgrade() -> None:
    op.drop_table("csat_rating", schema="chatbot")
