from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.channel_settlement import DomesticChannelSettlement
from app.models.finance import FinanceEntry
from app.models.open_item import OpenItem
from app.services import finance_center_service, open_item_service

ZERO = Decimal("0")
CENT = Decimal("0.01")


class ChannelSettlementError(ValueError):
    pass


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def validate_settlement(row: DomesticChannelSettlement) -> None:
    if (row.currency or "CNY").upper() != "CNY":
        raise ChannelSettlementError("CoffeeBear 渠道结算当前仅支持 CNY")

    components = {
        "gross_amount": _money(row.gross_amount),
        "refund_amount": _money(row.refund_amount),
        "platform_fee": _money(row.platform_fee),
        "rebate_amount": _money(row.rebate_amount),
        "other_fee": _money(row.other_fee),
        "net_amount": _money(row.net_amount),
    }
    negative = [key for key, value in components.items() if value < ZERO]
    if negative:
        raise ChannelSettlementError(f"渠道结算金额不能为负数：{', '.join(negative)}")

    expected_net = (
        components["gross_amount"]
        - components["refund_amount"]
        - components["platform_fee"]
        - components["rebate_amount"]
        - components["other_fee"]
    )
    if abs(expected_net - components["net_amount"]) > CENT:
        raise ChannelSettlementError(
            "渠道净结算额不平：gross - refund - platform_fee - rebate - other_fee 必须等于 net"
        )


def serialize(row: DomesticChannelSettlement) -> dict[str, Any]:
    return {
        "id": row.id,
        "legalEntityId": row.legal_entity_id,
        "partnerId": row.partner_id,
        "channel": row.channel,
        "shopName": row.shop_name,
        "externalKey": row.external_key,
        "orderNo": row.order_no,
        "settleDate": row.settle_date,
        "currency": row.currency,
        "grossAmount": str(row.gross_amount),
        "refundAmount": str(row.refund_amount),
        "platformFee": str(row.platform_fee),
        "rebateAmount": str(row.rebate_amount),
        "otherFee": str(row.other_fee),
        "netAmount": str(row.net_amount),
        "status": row.status,
        "raw": row.raw or {},
        "note": row.note,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


def create_settlement(
    db: Session,
    *,
    channel: str,
    external_key: str,
    settle_date,
    gross_amount: Decimal,
    net_amount: Decimal,
    shop_name: str = "",
    order_no: str = "",
    refund_amount: Decimal = ZERO,
    platform_fee: Decimal = ZERO,
    rebate_amount: Decimal = ZERO,
    other_fee: Decimal = ZERO,
    partner_id: int | None = None,
    legal_entity_id: int | None = None,
    currency: str = "CNY",
    raw: dict | None = None,
    note: str = "",
) -> tuple[DomesticChannelSettlement, bool]:
    channel = channel.strip().upper()
    external_key = external_key.strip()
    if not channel:
        raise ChannelSettlementError("渠道不能为空")
    if not external_key:
        raise ChannelSettlementError("外部结算唯一键不能为空")

    if partner_id is not None:
        try:
            open_item_service._ensure_partner(db, partner_id)  # noqa: SLF001 - shared partner validation
        except open_item_service.OpenItemError as exc:
            raise ChannelSettlementError(str(exc)) from exc

    entity = finance_center_service.resolve_entity(db, legal_entity_id)
    existing = db.scalar(
        select(DomesticChannelSettlement).where(
            DomesticChannelSettlement.channel == channel,
            DomesticChannelSettlement.shop_name == shop_name.strip(),
            DomesticChannelSettlement.external_key == external_key,
        )
    )
    if existing is not None:
        comparable = (
            _money(existing.gross_amount) == _money(gross_amount)
            and _money(existing.net_amount) == _money(net_amount)
            and existing.partner_id == partner_id
        )
        if not comparable:
            raise ChannelSettlementError("同一渠道结算唯一键已存在，但金额或往来单位不一致")
        return existing, False

    row = DomesticChannelSettlement(
        legal_entity_id=entity.id,
        partner_id=partner_id,
        channel=channel,
        shop_name=shop_name.strip(),
        external_key=external_key,
        order_no=order_no.strip(),
        settle_date=settle_date,
        currency=currency.strip().upper(),
        gross_amount=_money(gross_amount),
        refund_amount=_money(refund_amount),
        platform_fee=_money(platform_fee),
        rebate_amount=_money(rebate_amount),
        other_fee=_money(other_fee),
        net_amount=_money(net_amount),
        status="draft",
        raw=raw or {},
        note=note.strip(),
    )
    validate_settlement(row)
    db.add(row)
    db.flush()
    return row, True


def list_settlements(
    db: Session,
    *,
    channel: str = "",
    status: str = "all",
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query = select(DomesticChannelSettlement)
    if channel.strip():
        query = query.where(DomesticChannelSettlement.channel == channel.strip().upper())
    if status != "all":
        query = query.where(DomesticChannelSettlement.status == status)
    rows = db.scalars(
        query.order_by(
            DomesticChannelSettlement.settle_date.desc(),
            DomesticChannelSettlement.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return [serialize(row) for row in rows]


def get_settlement(db: Session, settlement_id: int) -> DomesticChannelSettlement:
    row = db.get(DomesticChannelSettlement, settlement_id)
    if row is None:
        raise ChannelSettlementError("渠道结算单不存在")
    return row


def _entry_specs(row: DomesticChannelSettlement) -> list[tuple[str, str, Decimal, str]]:
    return [
        ("channel_sales", "income", _money(row.gross_amount), "渠道结算销售收入"),
        ("channel_refund", "expense", _money(row.refund_amount), "渠道退款"),
        ("channel_platform_fee", "expense", _money(row.platform_fee), "渠道平台服务费"),
        ("channel_rebate", "expense", _money(row.rebate_amount), "渠道返利/优惠承担"),
        ("channel_other_fee", "expense", _money(row.other_fee), "渠道其他扣费"),
    ]


def materialize_settlement(
    db: Session,
    settlement_id: int,
) -> dict[str, Any]:
    row = db.scalar(
        select(DomesticChannelSettlement)
        .where(DomesticChannelSettlement.id == settlement_id)
        .with_for_update()
    )
    if row is None:
        raise ChannelSettlementError("渠道结算单不存在")
    validate_settlement(row)
    entity = finance_center_service.resolve_entity(db, row.legal_entity_id)
    occurred_at = datetime.combine(row.settle_date, time.min).replace(
        tzinfo=ZoneInfo(settings.TZ)
    )

    expected_categories = {
        category for category, _direction, amount, _note in _entry_specs(row) if amount > ZERO
    }
    existing = db.scalars(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "channel_settlement",
            FinanceEntry.source_id == str(row.id),
        )
    ).all()
    for entry in existing:
        if entry.category not in expected_categories and (entry.raw or {}).get("channelSettlement"):
            db.delete(entry)

    entries: list[FinanceEntry] = []
    for category, direction, amount, note in _entry_specs(row):
        if amount <= ZERO:
            continue
        entry = db.scalar(
            select(FinanceEntry).where(
                FinanceEntry.legal_entity_id == entity.id,
                FinanceEntry.source_type == "channel_settlement",
                FinanceEntry.source_id == str(row.id),
                FinanceEntry.category == category,
                FinanceEntry.value_type == "actual",
            )
        )
        if entry is None:
            entry = FinanceEntry(
                legal_entity_id=entity.id,
                source_type="channel_settlement",
                source_id=str(row.id),
                category=category,
                value_type="actual",
            )
        entry.business_scope = "domestic"
        entry.source_no = row.external_key
        entry.direction = direction
        entry.cash_effect = False
        entry.profit_effect = True
        entry.currency = "CNY"
        entry.amount = amount
        entry.tax_amount = ZERO
        entry.settlement_status = "pending"
        entry.invoice_status = "unknown"
        entry.accounting_year = row.settle_date.year
        entry.accounting_month = row.settle_date.month
        entry.occurred_at = occurred_at
        entry.note = note
        entry.raw = {
            **(entry.raw or {}),
            "channelSettlement": True,
            "channel": row.channel,
            "shopName": row.shop_name,
            "externalKey": row.external_key,
            "netAmount": str(row.net_amount),
        }
        db.add(entry)
        entries.append(entry)

    open_item: OpenItem | None = None
    if row.partner_id is not None and _money(row.net_amount) > ZERO:
        try:
            open_item, _created = open_item_service.create_open_item(
                db,
                partner_id=row.partner_id,
                item_type="receivable",
                original_amount=_money(row.net_amount),
                source_type="channel_settlement",
                source_id=str(row.id),
                source_no=row.external_key,
                description=f"{row.channel} {row.shop_name or '渠道'}净结算应收",
                currency="CNY",
                occurred_on=row.settle_date,
            )
        except open_item_service.OpenItemError as exc:
            raise ChannelSettlementError(str(exc)) from exc

    row.status = "materialized"
    db.add(row)
    db.flush()
    return {
        "settlement": serialize(row),
        "financeEntryIds": [entry.id for entry in entries],
        "openItemId": open_item.id if open_item is not None else None,
        "entryCount": len(entries),
    }


def summary(db: Session) -> dict[str, Any]:
    rows = db.scalars(select(DomesticChannelSettlement)).all()
    gross = sum((_money(row.gross_amount) for row in rows), ZERO)
    net = sum((_money(row.net_amount) for row in rows), ZERO)
    deductions = gross - net
    return {
        "count": len(rows),
        "grossAmount": str(gross),
        "netAmount": str(net),
        "deductionAmount": str(deductions),
        "currency": "CNY",
    }
