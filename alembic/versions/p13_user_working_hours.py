"""user.working_hours

Revision ID: p13_hours
Revises: p12_branding
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "p13_hours"
down_revision: Union[str, None] = "p12_branding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("working_hours", postgresql.JSONB(), nullable=True),
        schema="chatbot",
    )


def downgrade() -> None:
    op.drop_column("user", "working_hours", schema="chatbot")
