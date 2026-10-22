"""Track purchase-order-driven consumable usage and reversals."""

from alembic import op
import sqlalchemy as sa

revision = "pousage20261021"
down_revision = ("f5a8c2e4b6d0", "domfin20261009")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Some legacy databases were restored with the warehouses.id NOT NULL
    # marker but without the original primary-key constraint. PostgreSQL will
    # reject a foreign key to a column that is not unique, so repair that
    # schema drift before creating the new usage table. The guarded block is
    # idempotent for databases where the primary key is already present.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'warehouses'::regclass
                  AND contype IN ('p', 'u')
                  AND conkey = ARRAY[
                      (SELECT attnum
                       FROM pg_attribute
                       WHERE attrelid = 'warehouses'::regclass
                         AND attname = 'id')
                  ]::smallint[]
            ) THEN
                ALTER TABLE warehouses
                    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);
            END IF;
        END
        $$;
        """
    )

    op.create_table(
        "purchase_order_consumable_usage_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("po_id", sa.BigInteger(), nullable=False),
        sa.Column("consumable_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False, comment="有符号使用增量：正数扣减，负数冲销"),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=True),
        sa.Column("location", sa.String(16), nullable=True, comment="扣减/冲销位置：own=自有仓 / factory=工厂"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_purchase_order_consumable_usage_events_po_id",
        "purchase_order_consumable_usage_events", ["po_id"],
    )
    op.create_index(
        "ix_purchase_order_consumable_usage_events_consumable_id",
        "purchase_order_consumable_usage_events", ["consumable_id"],
    )
    op.create_index(
        "ix_purchase_order_consumable_usage_events_warehouse_id",
        "purchase_order_consumable_usage_events", ["warehouse_id"],
    )
    op.create_index(
        "ix_po_consumable_usage_po_material",
        "purchase_order_consumable_usage_events", ["po_id", "consumable_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_po_consumable_usage_po_material", table_name="purchase_order_consumable_usage_events")
    op.drop_index("ix_purchase_order_consumable_usage_events_warehouse_id", table_name="purchase_order_consumable_usage_events")
    op.drop_index("ix_purchase_order_consumable_usage_events_consumable_id", table_name="purchase_order_consumable_usage_events")
    op.drop_index("ix_purchase_order_consumable_usage_events_po_id", table_name="purchase_order_consumable_usage_events")
    op.drop_table("purchase_order_consumable_usage_events")
