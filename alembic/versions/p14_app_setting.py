"""app_setting + drop unused user.working_hours

Revision ID: p14_settings
Revises: p13_hours
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "p14_settings"
down_revision: Union[str, None] = "p13_hours"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(60), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="chatbot",
    )
    # Drop the unused per-user working_hours (we moved to a global config).
    op.drop_column("user", "working_hours", schema="chatbot")


def downgrade() -> None:
    op.add_column(
        "user",
        sa.Column("working_hours", postgresql.JSONB(), nullable=True),
        schema="chatbot",
    )
    op.drop_table("app_setting", schema="chatbot")
