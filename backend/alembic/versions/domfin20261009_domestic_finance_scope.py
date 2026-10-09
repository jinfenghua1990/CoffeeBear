"""normalize finance legal entities to domestic scope

Revision ID: domfin20261009
Revises: chsettle20261009
Create Date: 2026-10-09

CoffeeBear is domestic-only after the repository split. Existing legal-entity scope
configuration is normalized without deleting historical FinanceEntry rows.
"""

from alembic import op


revision = "domfin20261009"
down_revision = "chsettle20261009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "UPDATE finance_legal_entities "
            "SET business_scopes = '[\"domestic\"]'::jsonb"
        )
    else:
        op.execute(
            "UPDATE finance_legal_entities "
            "SET business_scopes = '[\"domestic\"]'"
        )


def downgrade() -> None:
    # Scope normalization is intentionally irreversible: restoring an old mixed
    # business scope would violate the post-split CoffeeBear ownership boundary.
    pass
