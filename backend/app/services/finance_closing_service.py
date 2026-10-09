"""Domestic finance closing helpers.

CoffeeBear is domestic-only. Historical rows from pre-split databases may still exist,
but the current runtime must not turn them into reports or delivery artifacts.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.finance import FinanceLegalEntity


def resolve_entity_by_name(db: Session, company: str) -> FinanceLegalEntity | None:
    if not company.strip():
        return None
    return db.scalar(
        select(FinanceLegalEntity).where(
            FinanceLegalEntity.name == company.strip(),
            FinanceLegalEntity.status != "archived",
        )
    )


def foreign_trade_summary(
    db: Session,
    *,
    legal_entity_id: int,
    year: int,
    month: int,
) -> dict[str, Any]:
    """Compatibility response for old callers; foreign-trade output is retired."""
    del db, legal_entity_id, year, month
    return {"rowCount": 0, "rows": [], "totalsByCurrency": []}


def foreign_trade_xlsx(
    db: Session,
    *,
    legal_entity_id: int,
    year: int,
    month: int,
) -> None:
    """Never generate foreign-trade delivery files from CoffeeBear."""
    del db, legal_entity_id, year, month
    return None
