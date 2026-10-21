"""Reconcile consumable stock against saved goods-purchase SKU quantities.

The purchase allocation is the immediate source of truth. Later inbound linkage must
not deduct the same packaging again. Signed usage events keep every recalculation
append-only, including allocation edits and deletions.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.catalog import Warehouse
from app.models.consumable import (
    Consumable,
    ConsumableSkuMapping,
    ConsumableTransaction,
    InboundConsumableUsage,
    PurchaseOrderConsumableUsageEvent,
)
from app.models.procurement_chain import ProcurementChainLink
from app.models.purchase import ExternalPurchaseOrder, PurchaseAllocationItem
from app.services.consumable_ledger_service import record_transaction
from app.utils.money import to_decimal


_ZERO = Decimal("0")
_QUANTUM = Decimal("0.0001")


def _manual_inbound_override(db: Session, po_id: int) -> bool:
    """An explicit manual inbound usage remains authoritative for legacy orders."""
    links = db.query(ProcurementChainLink).filter(
        ProcurementChainLink.external_po_id == po_id,
        ProcurementChainLink.target_type == "inbound",
        ProcurementChainLink.confirmed.is_(True),
    ).all()
    for link in links:
        has_usage = db.query(InboundConsumableUsage.id).filter_by(link_id=link.id).first()
        if not has_usage:
            continue
        note = str(link.note or "")
        automatic = any(marker in note for marker in (
            "按 SKU 耗材映射自动关联",
            "采购单耗材已按采购数量扣减",
        ))
        if link.match_method == "manual" and not automatic:
            return True
    return False


def _default_location(db: Session, material: Consumable) -> tuple[str, int | None]:
    from app.services import warehouse_service

    warehouse = warehouse_service.default_for_consumable(db)
    # Legacy stock_qty balances are still treated as own stock until warehouse
    # normalization has moved them into the factory warehouse.
    if (
        warehouse is not None
        and warehouse.warehouse_type == "factory"
        and to_decimal(material.factory_qty) == _ZERO
        and to_decimal(material.stock_qty) > _ZERO
    ):
        warehouse = None
    if warehouse is None:
        return "own", None
    return (
        "factory" if warehouse.warehouse_type == "factory" else "own",
        warehouse.id,
    )


def _event_location(
    db: Session,
    material: Consumable,
    events: list[PurchaseOrderConsumableUsageEvent],
    current_qty: Decimal,
) -> tuple[str, int | None]:
    if current_qty != _ZERO:
        for event in reversed(events):
            if event.quantity > _ZERO and event.location:
                warehouse_id = event.warehouse_id
                if warehouse_id is not None:
                    warehouse = db.get(Warehouse, warehouse_id)
                    if warehouse is None or warehouse.status != "active":
                        warehouse_id = None
                return event.location, warehouse_id
    return _default_location(db, material)


def reconcile_purchase_order_consumable_usage(
    db: Session,
    po_id: int,
    *,
    note: str = "",
    commit: bool = True,
) -> dict:
    """Idempotently reconcile usage to Σ(purchased SKU qty × usage-per-unit).

    If a legacy order has an explicitly manual inbound usage, that inbound usage is
    preserved and any previous purchase-order usage is reversed to prevent overlap.
    """
    po = db.scalar(
        select(ExternalPurchaseOrder)
        .where(ExternalPurchaseOrder.id == po_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if po is None:
        return {"status": "missing_purchase_order", "changed": False}
    raw = po.raw if isinstance(po.raw, dict) else {}
    if (po.order_kind_override or "").lower() == "consumable" or str(
        raw.get("orderKind") or raw.get("order_kind") or ""
    ).lower() == "consumable":
        return {"status": "not_applicable", "changed": False}

    allocations = db.query(PurchaseAllocationItem).filter(
        PurchaseAllocationItem.po_id == po.id,
        PurchaseAllocationItem.sku_id.isnot(None),
        PurchaseAllocationItem.quantity.isnot(None),
        PurchaseAllocationItem.quantity > 0,
    ).all()
    allocation_count = len(allocations)
    sku_ids = {int(row.sku_id) for row in allocations if row.sku_id is not None}
    mappings = db.query(ConsumableSkuMapping).filter(
        ConsumableSkuMapping.sku_id.in_(sku_ids),
    ).all() if sku_ids else []
    mappings_by_sku: dict[int, list[ConsumableSkuMapping]] = defaultdict(list)
    for mapping in mappings:
        mappings_by_sku[mapping.sku_id].append(mapping)

    missing_sku_ids = sorted(sku_id for sku_id in sku_ids if not mappings_by_sku.get(sku_id))
    manual_override = _manual_inbound_override(db, po.id)
    desired: dict[int, Decimal] = defaultdict(lambda: _ZERO)
    if not manual_override:
        for allocation in allocations:
            sku_id = int(allocation.sku_id)
            quantity = to_decimal(allocation.quantity)
            for mapping in mappings_by_sku.get(sku_id, []):
                usage = quantity * to_decimal(mapping.usage_per_unit)
                if usage > _ZERO:
                    desired[mapping.consumable_id] += usage

    events = db.query(PurchaseOrderConsumableUsageEvent).filter_by(
        po_id=po.id,
    ).order_by(PurchaseOrderConsumableUsageEvent.id).all()
    events_by_material: dict[int, list[PurchaseOrderConsumableUsageEvent]] = defaultdict(list)
    current: dict[int, Decimal] = defaultdict(lambda: _ZERO)
    for event in events:
        events_by_material[event.consumable_id].append(event)
        current[event.consumable_id] += to_decimal(event.quantity)

    changed = False
    for material_id in sorted(set(desired) | set(current)):
        before = current[material_id].quantize(_QUANTUM)
        target = desired[material_id].quantize(_QUANTUM)
        delta = (target - before).quantize(_QUANTUM)
        if delta == _ZERO:
            continue
        material = db.scalar(
            select(Consumable)
            .where(Consumable.id == material_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if material is None:
            continue
        location, warehouse_id = _event_location(
            db, material, events_by_material.get(material_id, []), before
        )
        event_note = (note.strip() or f"采购单 {po.external_order_id} 按 SKU 数量核算耗材")
        if delta < _ZERO:
            event_note = f"{event_note}；采购明细/映射调整冲销"
        event = PurchaseOrderConsumableUsageEvent(
            po_id=po.id,
            consumable_id=material_id,
            quantity=delta,
            location=location,
            warehouse_id=warehouse_id,
            note=event_note,
        )
        db.add(event)
        db.flush()
        if delta > _ZERO:
            record_transaction(
                db,
                consumable_id=material_id,
                transaction_type="consume",
                quantity=str(delta),
                unit_cost=str(material.purchase_unit_cost) if material.purchase_unit_cost is not None else None,
                source_type="purchase_order_usage",
                source_id=event.id,
                note=event_note,
                location=location,
                warehouse_id=warehouse_id,
                commit=False,
            )
        else:
            reverse_qty = -delta
            record_transaction(
                db,
                consumable_id=material_id,
                transaction_type="manual",
                quantity=str(reverse_qty),
                unit_cost=str(material.purchase_unit_cost) if material.purchase_unit_cost is not None else None,
                source_type="purchase_order_usage",
                source_id=event.id,
                note=event_note,
                location=location,
                warehouse_id=warehouse_id,
                commit=False,
            )
            material.used_qty = max(_ZERO, to_decimal(material.used_qty) - reverse_qty)
        changed = True

    if commit:
        db.commit()
    else:
        db.flush()

    if manual_override:
        status = "manual_inbound_preserved"
    elif not allocation_count:
        status = "awaiting_sku"
    elif missing_sku_ids:
        status = "applied" if desired else "pending_mapping"
    elif desired:
        status = "applied"
    else:
        status = "no_mapping"
    return {
        "status": status,
        "changed": changed,
        "allocationCount": allocation_count,
        "missingSkuIds": missing_sku_ids,
        "usageTotals": {str(key): str(value.quantize(_QUANTUM)) for key, value in desired.items()},
        "purchaseOrderId": po.id,
    }


def has_purchase_order_usage_events(db: Session, po_id: int) -> bool:
    return db.query(PurchaseOrderConsumableUsageEvent.id).filter_by(po_id=po_id).first() is not None
