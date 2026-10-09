"""add domestic channel settlement statements

Revision ID: chsettle20261009
Revises: openitems20261009
Create Date: 2026-10-09

Channel settlement statements explain marketplace gross-to-net deductions. They are
non-cash business facts; bank transactions remain the cash source of truth.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "chsettle20261009"
down_revision = "openitems20261009"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 4)


def upgrade() -> None:
    op.create_table(
        "finance_channel_settlements",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("legal_entity_id", sa.BigInteger(), nullable=True),
        sa.Column("partner_id", sa.BigInteger(), nullable=True),
        sa.Column("channel", sa.String(length=64), nullable=False),
        sa.Column("shop_name", sa.String(length=128), nullable=False),
        sa.Column("external_key", sa.String(length=128), nullable=False),
        sa.Column("order_no", sa.String(length=128), nullable=False),
        sa.Column("settle_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("gross_amount", MONEY, nullable=False),
        sa.Column("refund_amount", MONEY, nullable=False),
        sa.Column("platform_fee", MONEY, nullable=False),
        sa.Column("rebate_amount", MONEY, nullable=False),
        sa.Column("other_fee", MONEY, nullable=False),
        sa.Column("net_amount", MONEY, nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["legal_entity_id"],
            ["finance_legal_entities.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["partner_id"],
            ["business_partners.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "channel",
            "shop_name",
            "external_key",
            name="uq_finance_channel_settlement_external",
        ),
    )
    op.create_index(
        "ix_finance_channel_settlements_legal_entity_id",
        "finance_channel_settlements",
        ["legal_entity_id"],
    )
    op.create_index(
        "ix_finance_channel_settlements_partner_id",
        "finance_channel_settlements",
        ["partner_id"],
    )
    op.create_index(
        "ix_finance_channel_settlements_channel",
        "finance_channel_settlements",
        ["channel"],
    )
    op.create_index(
        "ix_finance_channel_settlements_order_no",
        "finance_channel_settlements",
        ["order_no"],
    )
    op.create_index(
        "ix_finance_channel_settlements_settle_date",
        "finance_channel_settlements",
        ["settle_date"],
    )
    op.create_index(
        "ix_finance_channel_settlements_status",
        "finance_channel_settlements",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_channel_settlements_status",
        table_name="finance_channel_settlements",
    )
    op.drop_index(
        "ix_finance_channel_settlements_settle_date",
        table_name="finance_channel_settlements",
    )
    op.drop_index(
        "ix_finance_channel_settlements_order_no",
        table_name="finance_channel_settlements",
    )
    op.drop_index(
        "ix_finance_channel_settlements_channel",
        table_name="finance_channel_settlements",
    )
    op.drop_index(
        "ix_finance_channel_settlements_partner_id",
        table_name="finance_channel_settlements",
    )
    op.drop_index(
        "ix_finance_channel_settlements_legal_entity_id",
        table_name="finance_channel_settlements",
    )
    op.drop_table("finance_channel_settlements")
