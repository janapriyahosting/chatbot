"""message_feedback

Revision ID: p18_message_feedback
Revises: p17_push_subscription
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "p18_msg_feedback"
down_revision: Union[str, None] = "p17_push_sub"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "message_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chatbot.message.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chatbot.conversation.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("visitor_id", sa.String(128), nullable=False),
        sa.Column("rating", sa.String(8), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("message_id", "visitor_id", name="uq_message_feedback_voter"),
        sa.CheckConstraint("rating IN ('up','down')", name="ck_message_feedback_rating"),
        schema="chatbot",
    )


def downgrade() -> None:
    op.drop_table("message_feedback", schema="chatbot")
