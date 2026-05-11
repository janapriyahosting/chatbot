"""site_allowed_origins

Revision ID: p16_site_origins
Revises: p15_csat
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "p16_site_origins"
down_revision: Union[str, None] = "p15_csat"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "site",
        sa.Column(
            "allowed_origins",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema="chatbot",
    )
    # Backfill from the existing single `domain` column so every site keeps
    # working the moment this migration lands — no admin has to touch settings.
    op.execute(
        """
        UPDATE chatbot.site
        SET allowed_origins = jsonb_build_array(
            'https://' || domain,
            'http://' || domain
        )
        WHERE domain IS NOT NULL AND domain <> ''
        """
    )


def downgrade() -> None:
    op.drop_column("site", "allowed_origins", schema="chatbot")
