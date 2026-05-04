"""message_template + seed defaults

Revision ID: p11_templates
Revises: p10_closed_at
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p11_templates"
down_revision: Union[str, None] = "p10_closed_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEFAULTS = [
    ("Greeting",        "Hi! How can I help you today?"),
    ("Ask phone",       "Could you share your phone number so I can call you back?"),
    ("Hold on",         "Let me check that for you — one moment please."),
    ("Thanks",          "Thanks for your patience!"),
    ("Schedule visit",  "Would you like to schedule a site visit?"),
    ("Apology",         "Apologies for the delay."),
    ("Sign-off",        "Thank you for reaching out — have a great day!"),
]


def upgrade() -> None:
    op.create_table(
        "message_template",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema="chatbot",
    )
    # Seed defaults so the existing hardcoded set carries over to the DB.
    for i, (title, body) in enumerate(_DEFAULTS):
        op.execute(
            sa.text(
                "INSERT INTO chatbot.message_template (title, body, sort_order) "
                "VALUES (:t, :b, :o)"
            ).bindparams(t=title, b=body, o=i)
        )


def downgrade() -> None:
    op.drop_table("message_template", schema="chatbot")
