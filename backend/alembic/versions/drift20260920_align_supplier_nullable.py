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


def upgrade() -> None:
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
