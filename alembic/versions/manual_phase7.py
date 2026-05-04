"""phase7 bot persona columns

Revision ID: p7bot_persona
Revises: 08e596e8ccff
Create Date: 2026-04-21 14:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p7bot_persona"
down_revision: Union[str, None] = "08e596e8ccff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bot", sa.Column("persona_name", sa.String(length=60), nullable=True), schema="chatbot")
    op.add_column("bot", sa.Column("persona_avatar", sa.String(length=512), nullable=True), schema="chatbot")


def downgrade() -> None:
    op.drop_column("bot", "persona_avatar", schema="chatbot")
    op.drop_column("bot", "persona_name", schema="chatbot")
