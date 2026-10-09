"""add domestic finance open-items lifecycle

Revision ID: openitems20261009
Revises: pmtv20260922_auto_debit
Create Date: 2026-10-09

Open Items belong to CoffeeBear domestic finance only. BusinessPartner remains the
counterparty identity root and BankTransaction remains the cash truth; allocations
link those facts without introducing another payment ledger.
"""

from alembic import op
import sqlalchemy as sa


revision = "openitems20261009"
down_revision = "pmtv20260922_auto_debit"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 4)


def upgrade() -> None:
    op.create_table(
        "finance_open_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("partner_id", sa.BigInteger(), nullable=False),
        sa.Column("item_type", sa.String(length=16), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("source_no", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="CNY"),
        sa.Column("original_amount", MONEY, nullable=False),
        sa.Column("settled_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("occurred_on", sa.Date(), nullable=True),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["partner_id"], ["business_partners.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "item_type", "source_type", "source_id", name="uq_finance_open_item_source"
        ),
    )
    op.create_index("ix_finance_open_items_partner_id", "finance_open_items", ["partner_id"])
    op.create_index("ix_finance_open_items_item_type", "finance_open_items", ["item_type"])
    op.create_index("ix_finance_open_items_source_type", "finance_open_items", ["source_type"])
    op.create_index("ix_finance_open_items_source_no", "finance_open_items", ["source_no"])
    op.create_index("ix_finance_open_items_status", "finance_open_items", ["status"])
    op.create_index("ix_finance_open_items_occurred_on", "finance_open_items", ["occurred_on"])
    op.create_index("ix_finance_open_items_due_on", "finance_open_items", ["due_on"])

    op.create_table(
        "finance_open_item_allocations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("open_item_id", sa.BigInteger(), nullable=False),
        sa.Column("bank_transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["open_item_id"], ["finance_open_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["bank_transaction_id"], ["bank_transactions.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_finance_open_item_allocations_open_item_id",
        "finance_open_item_allocations",
        ["open_item_id"],
    )
    op.create_index(
        "ix_finance_open_item_allocations_bank_transaction_id",
        "finance_open_item_allocations",
        ["bank_transaction_id"],
    )
    op.create_index(
        "ix_finance_open_item_allocations_status",
        "finance_open_item_allocations",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_open_item_allocations_status",
        table_name="finance_open_item_allocations",
    )
    op.drop_index(
        "ix_finance_open_item_allocations_bank_transaction_id",
        table_name="finance_open_item_allocations",
    )
    op.drop_index(
        "ix_finance_open_item_allocations_open_item_id",
        table_name="finance_open_item_allocations",
    )
    op.drop_table("finance_open_item_allocations")

    op.drop_index("ix_finance_open_items_due_on", table_name="finance_open_items")
    op.drop_index("ix_finance_open_items_occurred_on", table_name="finance_open_items")
    op.drop_index("ix_finance_open_items_status", table_name="finance_open_items")
    op.drop_index("ix_finance_open_items_source_no", table_name="finance_open_items")
    op.drop_index("ix_finance_open_items_source_type", table_name="finance_open_items")
    op.drop_index("ix_finance_open_items_item_type", table_name="finance_open_items")
    op.drop_index("ix_finance_open_items_partner_id", table_name="finance_open_items")
    op.drop_table("finance_open_items")
