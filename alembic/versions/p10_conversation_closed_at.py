"""conversation.closed_at + backfill

Revision ID: p10_closed_at
Revises: p9_api_key
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p10_closed_at"
down_revision: Union[str, None] = "p9_api_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversation",
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        schema="chatbot",
    )
    op.create_index(
        "ix_conversation_closed_at",
        "conversation",
        ["closed_at"],
        schema="chatbot",
    )
    # Backfill: any already-closed conversation gets closed_at set to its
    # last message's created_at (if any) or its own updated_at as a fallback.
    op.execute(
        """
        UPDATE chatbot.conversation c SET closed_at = COALESCE(
            (SELECT MAX(m.created_at) FROM chatbot.message m WHERE m.conversation_id = c.id),
            c.updated_at
        )
        WHERE c.status = 'closed' AND c.closed_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_closed_at", table_name="conversation", schema="chatbot")
    op.drop_column("conversation", "closed_at", schema="chatbot")
