from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.bank import BankTransaction
from app.models.business_partner import BusinessPartner
from app.models.open_item import OpenItem, OpenItemAllocation

ZERO = Decimal("0")


class OpenItemError(ValueError):
    pass


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def _remaining(item: OpenItem) -> Decimal:
    remaining = _money(item.original_amount) - _money(item.settled_amount)
    return remaining if remaining > ZERO else ZERO


def _ensure_partner(db: Session, partner_id: int) -> BusinessPartner:
    partner = db.get(BusinessPartner, partner_id)
    if partner is None or getattr(partner, "status", "active") == "archived":
        raise OpenItemError("往来单位不存在")
    return partner


def _active_allocations(db: Session, item_id: int) -> list[OpenItemAllocation]:
    return list(
        db.scalars(
            select(OpenItemAllocation)
            .where(
                OpenItemAllocation.open_item_id == item_id,
                OpenItemAllocation.status == "active",
            )
            .order_by(OpenItemAllocation.id.asc())
        ).all()
    )


def _recompute(db: Session, item: OpenItem) -> OpenItem:
    settled = db.scalar(
        select(func.coalesce(func.sum(OpenItemAllocation.amount), 0)).where(
            OpenItemAllocation.open_item_id == item.id,
            OpenItemAllocation.status == "active",
        )
    )
    settled_amount = _money(settled)
    original_amount = _money(item.original_amount)
    item.settled_amount = settled_amount
    if item.status == "cancelled":
        item.closed_at = item.closed_at or datetime.now(timezone.utc)
    elif settled_amount <= ZERO:
        item.status = "open"
        item.closed_at = None
    elif settled_amount < original_amount:
        item.status = "partial"
        item.closed_at = None
    else:
        item.status = "closed"
        item.closed_at = datetime.now(timezone.utc)
    db.add(item)
    return item


def serialize_item(
    db: Session,
    item: OpenItem,
    *,
    include_allocations: bool = True,
) -> dict[str, Any]:
    allocations: list[dict[str, Any]] = []
    if include_allocations:
        rows = db.scalars(
            select(OpenItemAllocation)
            .where(OpenItemAllocation.open_item_id == item.id)
            .order_by(OpenItemAllocation.id.desc())
        ).all()
        allocations = [
            {
                "id": row.id,
                "bankTransactionId": row.bank_transaction_id,
                "amount": str(row.amount),
                "status": row.status,
                "note": row.note,
                "createdAt": row.created_at,
                "voidedAt": row.voided_at,
            }
            for row in rows
        ]
    return {
        "id": item.id,
        "partnerId": item.partner_id,
        "itemType": item.item_type,
        "sourceType": item.source_type,
        "sourceId": item.source_id,
        "sourceNo": item.source_no,
        "description": item.description,
        "currency": item.currency,
        "originalAmount": str(item.original_amount),
        "settledAmount": str(item.settled_amount),
        "remainingAmount": str(_remaining(item)),
        "status": item.status,
        "occurredOn": item.occurred_on,
        "dueOn": item.due_on,
        "closedAt": item.closed_at,
        "createdAt": item.created_at,
        "updatedAt": item.updated_at,
        "allocations": allocations,
    }


def create_open_item(
    db: Session,
    *,
    partner_id: int,
    item_type: str,
    original_amount: Decimal,
    source_type: str = "manual",
    source_id: str = "",
    source_no: str = "",
    description: str = "",
    currency: str = "CNY",
    occurred_on=None,
    due_on=None,
) -> tuple[OpenItem, bool]:
    _ensure_partner(db, partner_id)
    item_type = item_type.strip().lower()
    if item_type not in {"receivable", "payable"}:
        raise OpenItemError("item_type 仅支持 receivable/payable")
    currency = currency.strip().upper()
    if currency != "CNY":
        raise OpenItemError("CoffeeBear Open Items 当前仅支持 CNY")
    amount = _money(original_amount)
    if amount <= ZERO:
        raise OpenItemError("未结项金额必须大于 0")
    source_type = source_type.strip() or "manual"
    source_id = source_id.strip() or f"manual:{uuid4().hex}"

    existing = db.scalar(
        select(OpenItem).where(
            OpenItem.item_type == item_type,
            OpenItem.source_type == source_type,
            OpenItem.source_id == source_id,
        )
    )
    if existing is not None:
        if existing.partner_id != partner_id or _money(existing.original_amount) != amount:
            raise OpenItemError("同一来源未结项已存在，但往来单位或金额不一致")
        return existing, False

    item = OpenItem(
        partner_id=partner_id,
        item_type=item_type,
        source_type=source_type,
        source_id=source_id,
        source_no=source_no.strip(),
        description=description.strip(),
        currency=currency,
        original_amount=amount,
        settled_amount=ZERO,
        status="open",
        occurred_on=occurred_on,
        due_on=due_on,
    )
    db.add(item)
    db.flush()
    return item, True


def list_open_items(
    db: Session,
    *,
    partner_id: int | None = None,
    item_type: str = "all",
    status: str = "open",
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query = select(OpenItem)
    if partner_id is not None:
        query = query.where(OpenItem.partner_id == partner_id)
    if item_type != "all":
        query = query.where(OpenItem.item_type == item_type)
    if status == "open":
        query = query.where(OpenItem.status.in_(["open", "partial"]))
    elif status != "all":
        query = query.where(OpenItem.status == status)
    rows = db.scalars(
        query.order_by(OpenItem.due_on.asc().nullslast(), OpenItem.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [serialize_item(db, row, include_allocations=False) for row in rows]


def get_open_item(db: Session, item_id: int) -> OpenItem:
    item = db.get(OpenItem, item_id)
    if item is None:
        raise OpenItemError("未结项不存在")
    return item


def allocate_bank_transaction(
    db: Session,
    *,
    item_id: int,
    bank_transaction_id: int,
    amount: Decimal,
    note: str = "",
) -> OpenItemAllocation:
    # Lock both financial facts before checking remaining capacity. This serializes
    # concurrent allocations of the same item or bank transaction and prevents
    # race-condition over-allocation.
    item = db.scalar(select(OpenItem).where(OpenItem.id == item_id).with_for_update())
    if item is None:
        raise OpenItemError("未结项不存在")
    if item.status == "cancelled":
        raise OpenItemError("已取消的未结项不能分配银行流水")
    if item.status == "closed":
        raise OpenItemError("未结项已结清")

    txn = db.scalar(
        select(BankTransaction)
        .where(BankTransaction.id == bank_transaction_id)
        .with_for_update()
    )
    if txn is None:
        raise OpenItemError("银行流水不存在")
    expected_direction = "in" if item.item_type == "receivable" else "out"
    if txn.direction != expected_direction:
        raise OpenItemError(
            "应收只能分配收款流水"
            if item.item_type == "receivable"
            else "应付只能分配付款流水"
        )
    if (
        txn.counterparty_partner_id is not None
        and txn.counterparty_partner_id != item.partner_id
    ):
        raise OpenItemError("银行流水已归属其他往来单位")

    allocation_amount = _money(amount)
    if allocation_amount <= ZERO:
        raise OpenItemError("分配金额必须大于 0")
    remaining = _remaining(item)
    if allocation_amount > remaining:
        raise OpenItemError("分配金额超过未结项剩余金额")

    duplicate = db.scalar(
        select(OpenItemAllocation.id).where(
            OpenItemAllocation.open_item_id == item.id,
            OpenItemAllocation.bank_transaction_id == txn.id,
            OpenItemAllocation.status == "active",
        )
    )
    if duplicate is not None:
        raise OpenItemError("该银行流水已分配到当前未结项")

    used = db.scalar(
        select(func.coalesce(func.sum(OpenItemAllocation.amount), 0)).where(
            OpenItemAllocation.bank_transaction_id == txn.id,
            OpenItemAllocation.status == "active",
        )
    )
    bank_amount = abs(_money(txn.amount))
    if _money(used) + allocation_amount > bank_amount:
        raise OpenItemError("分配金额超过该银行流水可用金额")

    allocation = OpenItemAllocation(
        open_item_id=item.id,
        bank_transaction_id=txn.id,
        amount=allocation_amount,
        status="active",
        note=note.strip(),
    )
    db.add(allocation)
    db.flush()
    _recompute(db, item)
    db.flush()
    return allocation


def void_allocation(db: Session, *, allocation_id: int) -> OpenItemAllocation:
    allocation = db.scalar(
        select(OpenItemAllocation)
        .where(OpenItemAllocation.id == allocation_id)
        .with_for_update()
    )
    if allocation is None:
        raise OpenItemError("未结项分配记录不存在")
    if allocation.status == "voided":
        return allocation
    item = db.scalar(
        select(OpenItem)
        .where(OpenItem.id == allocation.open_item_id)
        .with_for_update()
    )
    if item is None:
        raise OpenItemError("未结项不存在")
    allocation.status = "voided"
    allocation.voided_at = datetime.now(timezone.utc)
    db.add(allocation)
    db.flush()
    _recompute(db, item)
    db.flush()
    return allocation


def cancel_open_item(db: Session, *, item_id: int) -> OpenItem:
    item = db.scalar(select(OpenItem).where(OpenItem.id == item_id).with_for_update())
    if item is None:
        raise OpenItemError("未结项不存在")
    if item.status == "cancelled":
        return item
    if _active_allocations(db, item.id):
        raise OpenItemError("已有有效银行流水分配，不能直接取消；请先撤销分配")
    item.status = "cancelled"
    item.settled_amount = ZERO
    item.closed_at = datetime.now(timezone.utc)
    db.add(item)
    db.flush()
    return item


def summary(db: Session, *, partner_id: int | None = None) -> dict[str, Any]:
    query = select(OpenItem).where(OpenItem.status.in_(["open", "partial"]))
    if partner_id is not None:
        query = query.where(OpenItem.partner_id == partner_id)
    rows = db.scalars(query).all()
    receivable = sum(
        (_remaining(row) for row in rows if row.item_type == "receivable"), ZERO
    )
    payable = sum(
        (_remaining(row) for row in rows if row.item_type == "payable"), ZERO
    )
    return {
        "partnerId": partner_id,
        "openCount": len(rows),
        "receivableOutstanding": str(receivable),
        "payableOutstanding": str(payable),
        "netOutstanding": str(receivable - payable),
        "currency": "CNY",
    }
