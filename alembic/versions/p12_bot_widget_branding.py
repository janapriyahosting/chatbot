"""bot.widget_footer_text + bot.theme_color

Revision ID: p12_branding
Revises: p11_templates
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p12_branding"
down_revision: Union[str, None] = "p11_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bot",
        sa.Column("widget_footer_text", sa.String(120), nullable=True),
        schema="chatbot",
    )
    op.add_column(
        "bot",
        sa.Column("theme_color", sa.String(16), nullable=True),
        schema="chatbot",
    )


def downgrade() -> None:
    op.drop_column("bot", "theme_color", schema="chatbot")
    op.drop_column("bot", "widget_footer_text", schema="chatbot")
