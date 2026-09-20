"""align supplier nullable schema with ORM

Revision ID: drift20260920
Revises: finp20260920
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa


revision = "drift20260920"
down_revision = "finp20260920"
branch_labels = None
depends_on = None


def _ensure_fk(
    name: str,
    source_table: str,
    target_table: str,
    source_columns: list[str],
    target_columns: list[str],
    *,
    ondelete: str | None = None,
) -> None:
    """Create the FK only when it is genuinely missing.

    Some live databases already received these constraints during schema-drift
    repair before this Alembic revision was stamped. Re-running the migration
    must therefore be safe, but an existing constraint with the same name and
    a different definition must still fail loudly.
    """
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys(source_table)
    existing = next((item for item in foreign_keys if item.get("name") == name), None)
    if existing is not None:
        actual_source = list(existing.get("constrained_columns") or [])
        actual_target_table = existing.get("referred_table")
        actual_target = list(existing.get("referred_columns") or [])
        actual_ondelete = str((existing.get("options") or {}).get("ondelete") or "").upper()
        expected_ondelete = str(ondelete or "").upper()
        if (
            actual_source != source_columns
            or actual_target_table != target_table
            or actual_target != target_columns
            or (expected_ondelete and actual_ondelete != expected_ondelete)
        ):
            raise RuntimeError(
                f"existing constraint {name} has a different definition: "
                f"{actual_source} -> {actual_target_table}.{actual_target}, "
                f"ondelete={actual_ondelete or '-'}"
            )
        return

    op.create_foreign_key(
        name,
        source_table,
        target_table,
        source_columns,
        target_columns,
        ondelete=ondelete,
    )


def _drop_fk_if_exists(name: str, table: str) -> None:
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys(table)
    if any(item.get("name") == name for item in foreign_keys):
        op.drop_constraint(name, table, type_="foreignkey")


def upgrade() -> None:
    # 旧模型已提升到 10 位小数，但迁移仍停在 4 位；使用 24,10 保留原有
    # 14 位整数容量，同时获得 10 位小数精度。
    op.alter_column(
        "consumable_purchase_items",
        "unit_cost",
        existing_type=sa.Numeric(18, 4),
        type_=sa.Numeric(24, 10),
        existing_nullable=False,
    )
    op.alter_column(
        "consumable_transactions",
        "unit_cost",
        existing_type=sa.Numeric(18, 4),
        type_=sa.Numeric(24, 10),
        existing_nullable=True,
    )

    # FinanceDeliveryFile 模型声明了两个 FK，但 phase0 迁移只建了列与索引。
    # 正式补上约束；如果生产库存在孤儿行，迁移会明确失败而不是静默删除数据。
    _ensure_fk(
        "fk_fdf_package",
        "finance_delivery_files",
        "finance_delivery_packages",
        ["package_id"],
        ["id"],
        ondelete="CASCADE",
    )
    _ensure_fk(
        "fk_fdf_archive",
        "finance_delivery_files",
        "archive_files",
        ["archive_file_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 旧迁移把这些字段建成 nullable=True，而 ORM 一直按字符串/整数非空字段使用。
    # 先回填历史 NULL，再收紧约束，避免 ALTER TABLE 因存量数据失败。
    op.execute("UPDATE suppliers SET bank_name = '' WHERE bank_name IS NULL")
    op.execute("UPDATE suppliers SET bank_account_no = '' WHERE bank_account_no IS NULL")
    op.execute("UPDATE suppliers SET bank_account_name = '' WHERE bank_account_name IS NULL")
    op.execute("UPDATE suppliers SET tax_invoice_count = 0 WHERE tax_invoice_count IS NULL")

    op.alter_column(
        "suppliers",
        "bank_name",
        existing_type=sa.String(length=128),
        nullable=False,
    )
    op.alter_column(
        "suppliers",
        "bank_account_no",
        existing_type=sa.String(length=64),
        nullable=False,
    )
    op.alter_column(
        "suppliers",
        "bank_account_name",
        existing_type=sa.String(length=256),
        nullable=False,
    )
    op.alter_column(
        "suppliers",
        "tax_invoice_count",
        existing_type=sa.Integer(),
        existing_server_default=sa.text("'0'"),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "suppliers",
        "tax_invoice_count",
        existing_type=sa.Integer(),
        existing_server_default=sa.text("'0'"),
        nullable=True,
    )
    op.alter_column(
        "suppliers",
        "bank_account_name",
        existing_type=sa.String(length=256),
        nullable=True,
    )
    op.alter_column(
        "suppliers",
        "bank_account_no",
        existing_type=sa.String(length=64),
        nullable=True,
    )
    op.alter_column(
        "suppliers",
        "bank_name",
        existing_type=sa.String(length=128),
        nullable=True,
    )

    _drop_fk_if_exists("fk_fdf_archive", "finance_delivery_files")
    _drop_fk_if_exists("fk_fdf_package", "finance_delivery_files")

    op.alter_column(
        "consumable_transactions",
        "unit_cost",
        existing_type=sa.Numeric(24, 10),
        type_=sa.Numeric(18, 4),
        existing_nullable=True,
    )
    op.alter_column(
        "consumable_purchase_items",
        "unit_cost",
        existing_type=sa.Numeric(24, 10),
        type_=sa.Numeric(18, 4),
        existing_nullable=False,
    )
