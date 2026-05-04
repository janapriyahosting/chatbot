"""phase4 auto_assign and last_assigned_at

Revision ID: 08e596e8ccff
Revises: 8419f67a98c6
Create Date: 2026-04-21 13:00:45.869608
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "08e596e8ccff"
down_revision: Union[str, None] = "8419f67a98c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bot",
        sa.Column("auto_assign", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="chatbot",
    )
    op.add_column(
        "user",
        sa.Column("last_assigned_at", sa.DateTime(timezone=True), nullable=True),
        schema="chatbot",
    )


def downgrade() -> None:
    op.drop_column("user", "last_assigned_at", schema="chatbot")
    op.drop_column("bot", "auto_assign", schema="chatbot")
