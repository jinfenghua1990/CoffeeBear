"""Track purchase-order-driven consumable usage and reversals."""

from alembic import op
import sqlalchemy as sa

revision = "pousage20261021"
down_revision = ("f5a8c2e4b6d0", "domfin20261009")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Some legacy databases were restored with only NOT NULL markers and lost
    # the primary keys created by PkMixin. Restore the missing single-column
    # keys before creating a foreign key. The checks are deliberately limited
    # to tables known to be PkMixin tables in this application, and are
    # idempotent for databases where the keys already exist.
    op.execute(
        """
        DO $$
        DECLARE
            table_name text;
            duplicate_count bigint;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY[
                'monthly_finance_periods',
                'procurement_chain_links',
                'product_skus',
                'products',
                'purchase_allocation_items',
                'roles',
                'sales_order_items',
                'sales_orders',
                'suppliers',
                'sync_jobs',
                'sync_logs',
                'tax_accounting_category_rules',
                'tax_invoice_import_records',
                'tax_invoice_imports',
                'tax_invoice_links',
                'tax_invoices',
                'user_roles',
                'users',
                'warehouses'
            ] LOOP
                IF NOT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    JOIN pg_constraint con ON con.conrelid = c.oid
                    WHERE n.nspname = 'public'
                      AND c.relname = table_name
                      AND con.contype = 'p'
                      AND con.conkey = ARRAY[
                          (SELECT attnum FROM pg_attribute
                           WHERE attrelid = c.oid AND attname = 'id')
                      ]::smallint[]
                ) THEN
                    EXECUTE format(
                        'SELECT count(*) - count(DISTINCT id) FROM public.%I',
                        table_name
                    ) INTO duplicate_count;
                    IF duplicate_count <> 0 THEN
                        RAISE EXCEPTION
                            'Cannot restore % primary key: duplicate or NULL id values exist',
                            table_name;
                    END IF;
                    EXECUTE format(
                        'ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (id)',
                        table_name, table_name || '_pkey'
                    );
                END IF;
            END LOOP;
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
