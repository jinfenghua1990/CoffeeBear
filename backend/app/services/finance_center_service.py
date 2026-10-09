"""统一财务中心：公司主体 + 国内财务事项池。

CoffeeBear 的业务 authority 仅为 DOMESTIC / 卖咖啡的熊。历史数据库中可能仍有
拆分前的外贸 FinanceEntry，但当前服务不会创建、更新、查询或汇总这些历史行。
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.finance import FinanceEntry, FinanceLegalEntity

DEFAULT_ENTITY_CODE = "ZJCB"
DEFAULT_ENTITY_NAME = "浙江柴本网络科技有限公司"

CATEGORY_LABELS = {
    "sales_income": "销售收入",
    "purchase_cost": "采购成本",
    "inventory_purchase": "库存采购 / 应付",
    "sales_cost": "销售成本",
    "platform_fee": "平台费用",
    "domestic_logistics": "国内物流",
    "refund": "退款",
    "other": "其他",
}


def _decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def ensure_default_entity(db: Session) -> FinanceLegalEntity:
    """只读路径兜底：返回默认主体；缺失时仅加入当前事务（不提交）。"""
    row = db.scalar(select(FinanceLegalEntity).where(FinanceLegalEntity.code == DEFAULT_ENTITY_CODE))
    if row is not None:
        return row
    row = FinanceLegalEntity(
        code=DEFAULT_ENTITY_CODE,
        name=DEFAULT_ENTITY_NAME,
        country_code="CN",
        base_currency="CNY",
        status="active",
        is_default=True,
        business_scopes=["domestic"],
        note="系统初始化默认主体",
    )
    db.add(row)
    db.flush()
    db.refresh(row)
    return row


def entity_dict(row: FinanceLegalEntity) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "countryCode": row.country_code,
        "baseCurrency": row.base_currency,
        "taxId": row.tax_id,
        "status": row.status,
        "isDefault": bool(row.is_default),
        "businessScopes": ["domestic"],
        "note": row.note,
    }


def list_entities(db: Session) -> list[dict[str, Any]]:
    ensure_default_entity(db)
    rows = db.scalars(
        select(FinanceLegalEntity)
        .where(FinanceLegalEntity.status != "archived")
        .order_by(FinanceLegalEntity.is_default.desc(), FinanceLegalEntity.id.asc())
    ).all()
    return [entity_dict(row) for row in rows]


def resolve_entity(db: Session, legal_entity_id: int | None = None) -> FinanceLegalEntity:
    if legal_entity_id is not None:
        row = db.get(FinanceLegalEntity, legal_entity_id)
        if row is None or row.status == "archived":
            raise ValueError("公司主体不存在")
        return row
    default = db.scalar(
        select(FinanceLegalEntity)
        .where(FinanceLegalEntity.is_default.is_(True))
        .where(FinanceLegalEntity.status != "archived")
        .order_by(FinanceLegalEntity.id.asc())
    )
    return default or ensure_default_entity(db)


def resolve_entity_by_name(db: Session, company: str) -> FinanceLegalEntity | None:
    if not company.strip():
        return None
    return db.scalar(
        select(FinanceLegalEntity).where(
            FinanceLegalEntity.name == company.strip(),
            FinanceLegalEntity.status != "archived",
        )
    )


def entry_dict(row: FinanceEntry, entity: FinanceLegalEntity | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "legalEntityId": row.legal_entity_id,
        "legalEntityName": entity.name if entity else "",
        "businessScope": "domestic",
        "sourceType": row.source_type,
        "sourceId": row.source_id,
        "sourceNo": row.source_no,
        "category": row.category,
        "categoryLabel": CATEGORY_LABELS.get(row.category, row.category),
        "direction": row.direction,
        "cashEffect": bool(row.cash_effect),
        "profitEffect": bool(row.profit_effect),
        "currency": row.currency,
        "amount": str(row.amount or 0),
        "taxAmount": str(row.tax_amount or 0),
        "valueType": row.value_type,
        "settlementStatus": row.settlement_status,
        "invoiceStatus": row.invoice_status,
        "accountingYear": row.accounting_year,
        "accountingMonth": row.accounting_month,
        "occurredAt": row.occurred_at.isoformat() if row.occurred_at else None,
        "note": row.note,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_entries(
    db: Session,
    *,
    legal_entity_id: int | None = None,
    business_scope: str = "all",
    year: int | None = None,
    month: int | None = None,
    status: str = "",
    limit: int = 200,
) -> list[dict[str, Any]]:
    if business_scope not in {"all", "domestic"}:
        raise ValueError("CoffeeBear 仅提供国内财务范围")
    entity = resolve_entity(db, legal_entity_id)
    stmt = (
        select(FinanceEntry)
        .where(FinanceEntry.legal_entity_id == entity.id)
        .where(FinanceEntry.business_scope == "domestic")
    )
    if year is not None:
        stmt = stmt.where(FinanceEntry.accounting_year == year)
    if month is not None:
        stmt = stmt.where(FinanceEntry.accounting_month == month)
    if status:
        stmt = stmt.where(FinanceEntry.settlement_status == status)
    stmt = stmt.order_by(FinanceEntry.id.desc()).limit(limit)
    return [entry_dict(row, entity) for row in db.scalars(stmt).all()]


def center_overview(
    db: Session,
    *,
    legal_entity_id: int | None = None,
    business_scope: str = "all",
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any]:
    if business_scope not in {"all", "domestic"}:
        raise ValueError("CoffeeBear 仅提供国内财务范围")
    now = datetime.now(timezone.utc)
    year = year or now.year
    month = month or now.month
    entity = resolve_entity(db, legal_entity_id)

    stmt = (
        select(FinanceEntry)
        .where(FinanceEntry.legal_entity_id == entity.id)
        .where(FinanceEntry.business_scope == "domestic")
        .where(FinanceEntry.accounting_year == year)
        .where(FinanceEntry.accounting_month == month)
    )
    rows = db.scalars(stmt.order_by(FinanceEntry.id.desc())).all()

    totals: dict[str, dict[str, Decimal]] = {}
    scopes = {"domestic": {"count": 0, "estimated": 0, "pending": 0}}
    todo = {
        "pendingConfirmation": 0,
        "pendingSettlement": 0,
        "pendingInvoice": 0,
        "estimated": 0,
        "anomalies": 0,
    }

    actual_keys = {
        (row.source_type, row.source_id, row.category)
        for row in rows
        if row.value_type == "actual"
    }

    for row in rows:
        bucket = totals.setdefault(
            row.currency,
            {
                "actualIncome": Decimal("0"),
                "actualExpense": Decimal("0"),
                "estimatedIncome": Decimal("0"),
                "estimatedExpense": Decimal("0"),
                "actualCashInflow": Decimal("0"),
                "actualCashOutflow": Decimal("0"),
                "forecastCashInflow": Decimal("0"),
                "forecastCashOutflow": Decimal("0"),
            },
        )
        identity = (row.source_type, row.source_id, row.category)
        superseded_estimate = row.value_type == "estimated" and identity in actual_keys

        if row.profit_effect and not superseded_estimate:
            key = ("estimated" if row.value_type == "estimated" else "actual") + (
                "Income" if row.direction == "income" else "Expense"
            )
            bucket[key] += _decimal(row.amount)

        if row.cash_effect:
            cash_direction = "Inflow" if row.direction == "income" else "Outflow"
            settled_cash = row.value_type == "actual" and row.settlement_status in {"settled", "closed"}
            if settled_cash:
                bucket[f"actualCash{cash_direction}"] += _decimal(row.amount)
            elif not superseded_estimate:
                bucket[f"forecastCash{cash_direction}"] += _decimal(row.amount)

        scope = scopes["domestic"]
        scope["count"] += 1
        if row.value_type == "estimated" and not superseded_estimate:
            scope["estimated"] += 1
            todo["estimated"] += 1
        if row.settlement_status not in {"settled", "closed"}:
            scope["pending"] += 1
            todo["pendingSettlement"] += 1
        if row.settlement_status == "pending_confirmation":
            todo["pendingConfirmation"] += 1
        if row.invoice_status in {"missing", "pending"}:
            todo["pendingInvoice"] += 1
        if row.settlement_status == "anomaly":
            todo["anomalies"] += 1

    totals_by_currency = []
    for currency, values in sorted(totals.items()):
        actual_profit = values["actualIncome"] - values["actualExpense"]
        estimated_profit = (
            values["actualIncome"]
            + values["estimatedIncome"]
            - values["actualExpense"]
            - values["estimatedExpense"]
        )
        totals_by_currency.append({
            "currency": currency,
            **{key: str(value) for key, value in values.items()},
            "actualProfit": str(actual_profit),
            "estimatedProfit": str(estimated_profit),
            "actualNetCash": str(values["actualCashInflow"] - values["actualCashOutflow"]),
            "forecastNetCash": str(
                values["actualCashInflow"] + values["forecastCashInflow"]
                - values["actualCashOutflow"] - values["forecastCashOutflow"]
            ),
        })

    return {
        "entity": entity_dict(entity),
        "businessScope": "domestic",
        "year": year,
        "month": month,
        "entryCount": len(rows),
        "todo": todo,
        "totalsByCurrency": totals_by_currency,
        "scopeSummary": scopes,
        "recentEntries": [entry_dict(row, entity) for row in rows[:20]],
        "principle": "CoffeeBear 财务中心仅汇总国内业务；不同币种不直接相加。",
    }


def save_entity(
    db: Session,
    *,
    entity_id: int | None,
    code: str,
    name: str,
    country_code: str,
    base_currency: str,
    tax_id: str,
    status: str,
    is_default: bool,
    business_scopes: list[str],
    note: str,
) -> FinanceLegalEntity:
    del business_scopes
    row = db.get(FinanceLegalEntity, entity_id) if entity_id else FinanceLegalEntity()
    if row is None:
        raise ValueError("公司主体不存在")
    if is_default:
        for other in db.scalars(select(FinanceLegalEntity).where(FinanceLegalEntity.is_default.is_(True))).all():
            other.is_default = False
    row.code = code.strip().upper()
    row.name = name.strip()
    row.country_code = country_code.strip().upper() or "CN"
    row.base_currency = base_currency.strip().upper() or "CNY"
    row.tax_id = tax_id.strip()
    row.status = status
    row.is_default = is_default
    row.business_scopes = ["domestic"]
    row.note = note.strip()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_entry(
    db: Session,
    *,
    entry_id: int | None,
    legal_entity_id: int,
    business_scope: str,
    source_type: str,
    source_id: str,
    source_no: str,
    category: str,
    direction: str,
    currency: str,
    amount: str,
    tax_amount: str,
    value_type: str,
    settlement_status: str,
    invoice_status: str,
    accounting_year: int,
    accounting_month: int,
    occurred_at: datetime | None,
    note: str,
    cash_effect: bool = True,
    profit_effect: bool = True,
) -> FinanceEntry:
    if business_scope != "domestic":
        raise ValueError("CoffeeBear 仅允许内销财务事项；ALSVID/外贸财务请在 ALSVID 系统维护")
    if direction not in {"income", "expense"}:
        raise ValueError("财务方向必须是收入或支出")
    if value_type not in {"actual", "estimated"}:
        raise ValueError("金额口径必须是实际或预计")
    if not (1 <= accounting_month <= 12):
        raise ValueError("账期月份不正确")
    entity = resolve_entity(db, legal_entity_id)
    row = db.get(FinanceEntry, entry_id) if entry_id else FinanceEntry()
    if row is None:
        raise ValueError("财务事项不存在")
    row.legal_entity_id = entity.id
    row.business_scope = "domestic"
    row.source_type = source_type.strip() or "manual"
    clean_source_id = source_id.strip()
    if not clean_source_id and row.source_type == "manual":
        clean_source_id = f"manual-{entry_id or uuid4().hex}"
    row.source_id = clean_source_id
    row.source_no = source_no.strip()
    row.category = category.strip() or "other"
    row.direction = direction
    row.cash_effect = bool(cash_effect)
    row.profit_effect = bool(profit_effect)
    row.currency = currency.strip().upper() or entity.base_currency
    row.amount = _decimal(amount)
    row.tax_amount = _decimal(tax_amount)
    row.value_type = value_type
    row.settlement_status = settlement_status
    row.invoice_status = invoice_status
    row.accounting_year = accounting_year
    row.accounting_month = accounting_month
    row.occurred_at = occurred_at
    row.note = note.strip()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
