"""一体化新建采购单：单次提交、真实入库单优先、手工编号不虚增库存。"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models.catalog import ProductSku
from app.models.consumable import (
    Consumable,
    ConsumableSkuMapping,
    ConsumableTransaction,
    InboundConsumableUsage,
)
from app.models.consumable_purchase import ConsumablePurchase, ConsumablePurchaseItem
from app.models.jackyun import JackyunGoodsDocument, JackyunGoodsDocumentItem
from app.models.procurement_chain import ProcurementChainLink
from app.models.purchase import ExternalPurchaseOrder, PurchaseAllocationItem
from app.services.purchase_full_create_service import create_complete_purchase


def _data(**changes):
    row = {
        "external_order_id": f"PYTEST-FULL-{uuid4().hex[:10]}",
        "platform": "pdd",
        "supplier_name": "一体化测试供应商",
        "title": "完整采购记录",
        "ordered_at": datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
        "order_amount": "100",
        "paid_amount": "0",
        "warehouse_id": None,
        "order_kind": "goods",
        "inbound_no": "",
        "invoice_reference_no": "",
        "items": [],
    }
    row.update(changes)
    return row


def _sku(db_session):
    suffix = uuid4().hex[:10]
    row = ProductSku(
        product_id=None, jackyun_sku_id=f"PYTEST-FULL-{suffix}",
        sku_code=f"PYTEST-FULL-SKU-{suffix}",
        sku_name="测试现货", barcode=f"692{suffix}", unit="盒",
        product_type="single", status="active", raw={},
    )
    db_session.add(row)
    db_session.flush()
    return row


def test_full_order_creates_goods_allocations_and_keeps_unimported_inbound_number(db_session):
    sku = _sku(db_session)
    payload = _data(
        inbound_no="USER-RK-0001", invoice_reference_no="INV-USER-001",
        items=[{"item_id": sku.id, "quantity": "2", "amount": "100"}],
    )
    result = create_complete_purchase(db_session, payload, actor="pytest")
    po = db_session.get(ExternalPurchaseOrder, result["id"])
    assert result["inboundStatus"] == "pending_import"
    assert result["workbenchOrderId"] == -po.id
    assert po.raw["manualInboundNo"] == "USER-RK-0001"
    assert po.raw["invoiceReferenceNo"] == "INV-USER-001"
    assert po.paid_amount == Decimal("0")
    row = db_session.query(PurchaseAllocationItem).filter_by(po_id=po.id).one()
    assert row.sku_id == sku.id
    assert row.quantity == Decimal("2")
    assert row.amount == Decimal("100")
    assert db_session.query(JackyunGoodsDocument).filter_by(goodsdoc_no="USER-RK-0001").count() == 0
    assert db_session.query(ProcurementChainLink).filter_by(external_po_id=po.id).count() == 0


def test_exact_existing_inbound_is_linked_without_duplicate_document(db_session):
    sku = _sku(db_session)
    no = f"RK-FULL-{uuid4().hex[:10]}"
    doc = JackyunGoodsDocument(
        document_type="inbound", goodsdoc_no=no,
        document_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        total_quantity=Decimal("3"), total_amount=Decimal("150"),
        raw={"source": "jackyun"},
    )
    db_session.add(doc)
    db_session.flush()
    item = JackyunGoodsDocumentItem(
        document_id=doc.id, line_no=1, matched_sku_id=sku.id,
        goods_no=sku.sku_code, sku_barcode=sku.barcode,
        quantity=Decimal("3"), unit_price_tax=Decimal("50"),
        amount_tax=Decimal("150"), raw={},
    )
    db_session.add(item)
    db_session.flush()
    payload = _data(inbound_no=no.lower(), order_amount="150")
    result = create_complete_purchase(db_session, payload, actor="pytest")
    assert result["inboundStatus"] == "linked"
    assert db_session.query(JackyunGoodsDocument).filter_by(goodsdoc_no=no).count() == 1
    linked = db_session.query(ProcurementChainLink).filter_by(external_po_id=result["id"]).one()
    assert linked.target_id == doc.id and linked.confirmed is True
    allocation = db_session.query(PurchaseAllocationItem).filter_by(po_id=result["id"]).one()
    assert allocation.source_item_id == item.id
    assert allocation.quantity == Decimal("3")


def test_existing_inbound_link_auto_deducts_mapped_consumables_in_same_purchase_transaction(db_session):
    sku = _sku(db_session)
    material = Consumable(
        code=f"HC-FULL-{uuid4().hex[:10]}", name="测试包装耗材",
        unit="个", status="active", stock_qty=Decimal("20"),
        factory_qty=Decimal("0"), transit_qty=Decimal("0"),
        purchased_qty=Decimal("20"), used_qty=Decimal("0"),
        min_stock_qty=Decimal("0"), raw={},
    )
    db_session.add(material)
    db_session.flush()
    db_session.add(ConsumableSkuMapping(
        sku_id=sku.id, consumable_id=material.id, usage_per_unit=Decimal("2"),
    ))
    no = f"RK-CONSUME-{uuid4().hex[:8]}"
    doc = JackyunGoodsDocument(
        document_type="inbound", goodsdoc_no=no,
        raw={"source": "jackyun"},
    )
    db_session.add(doc)
    db_session.flush()
    db_session.add(JackyunGoodsDocumentItem(
        document_id=doc.id, line_no=1, matched_sku_id=sku.id,
        goods_no=sku.sku_code, sku_barcode=sku.barcode,
        quantity=Decimal("3"), unit_price_tax=Decimal("50"),
        amount_tax=Decimal("150"), raw={},
    ))
    db_session.flush()

    result = create_complete_purchase(
        db_session,
        _data(
            inbound_no=no,
            order_amount="150",
            items=[{"item_id": sku.id, "quantity": "3", "amount": "150"}],
        ),
        actor="pytest",
    )

    assert result["consumableUsageStatus"] == "applied"
    assert result["consumableUsageWarning"] == ""
    db_session.refresh(material)
    assert material.stock_qty == Decimal("14.0000")
    assert material.used_qty == Decimal("6.0000")
    usage = db_session.query(InboundConsumableUsage).filter_by(
        inbound_document_id=doc.id, consumable_id=material.id,
    ).one()
    assert usage.quantity == Decimal("6.0000")
    tx = db_session.query(ConsumableTransaction).filter_by(
        source_type="inbound_usage", source_id=usage.id, consumable_id=material.id,
    ).one()
    assert tx.transaction_type == "consume"
    assert tx.quantity == Decimal("6.0000")


def test_unmatched_inbound_no_can_save_without_sku_or_warehouse(db_session):
    data = _data(inbound_no=f"RK-UNSYNC-{uuid4().hex[:8]}")
    result = create_complete_purchase(db_session, data)
    assert result["lineCount"] == 0
    assert result["inboundStatus"] == "pending_import"
    assert db_session.get(ExternalPurchaseOrder, result["id"]).raw["manualInboundNo"] == data["inbound_no"]


def test_consumable_purchase_is_created_without_fake_receipt(db_session):
    material = Consumable(
        code=f"HC-FULL-{uuid4().hex[:10]}", name="测试包材",
        unit="个", status="active", stock_qty=Decimal("0"),
        factory_qty=Decimal("0"), transit_qty=Decimal("0"),
        purchased_qty=Decimal("0"), used_qty=Decimal("0"),
        min_stock_qty=Decimal("0"), raw={},
    )
    db_session.add(material)
    db_session.flush()
    data = _data(
        order_kind="consumable", order_amount="40",
        paid_amount="12", items=[{"item_id": material.id, "quantity": "8", "amount": "40"}],
    )
    result = create_complete_purchase(db_session, data)
    cp = db_session.get(ConsumablePurchase, result["consumablePurchaseId"])
    assert cp.reference_no == data["external_order_id"]
    line = db_session.query(ConsumablePurchaseItem).filter_by(purchase_id=cp.id).one()
    assert line.quantity == Decimal("8")
    assert line.unit_cost == Decimal("5")
    db_session.refresh(material)
    assert material.stock_qty == Decimal("0")
    assert db_session.get(ExternalPurchaseOrder, result["id"]).paid_amount == Decimal("12")


def test_invalid_product_rolls_back_entire_order(db_session):
    data = _data(items=[{"item_id": 987654321, "quantity": "1", "amount": "100"}])
    with pytest.raises(ValueError, match="商品不存在或已停用"):
        create_complete_purchase(db_session, data)
    assert db_session.query(ExternalPurchaseOrder).filter_by(
        platform=data["platform"], external_order_id=data["external_order_id"]
    ).count() == 0


def test_confirmed_inbound_owned_by_another_purchase_is_not_silently_taken(db_session):
    doc = JackyunGoodsDocument(
        document_type="inbound", goodsdoc_no=f"RK-OWNED-{uuid4().hex[:9]}",
        raw={"source": "jackyun"},
    )
    other = ExternalPurchaseOrder(
        external_order_id=f"PYTEST-OWNER-{uuid4().hex[:9]}",
        platform="pdd", supplier_name="原采购商", raw={},
    )
    db_session.add_all([doc, other])
    db_session.flush()
    db_session.add(ProcurementChainLink(
        external_po_id=other.id, target_type="inbound", target_id=doc.id,
        match_method="manual", confirmed=True,
    ))
    db_session.flush()
    result = create_complete_purchase(db_session, _data(inbound_no=doc.goodsdoc_no))
    assert result["inboundStatus"] == "pending_conflict"
    assert db_session.query(ProcurementChainLink).filter_by(
        external_po_id=result["id"], target_type="inbound"
    ).count() == 0

def test_editing_created_purchase_keeps_manual_inbound_reference(db_session):
    from app.services.procurement_workbench_service import edit_order_main_fields

    original = _data(inbound_no="RK-BEFORE")
    result = create_complete_purchase(db_session, original, actor="pytest")
    edit_order_main_fields(
        db_session, order_id=result["workbenchOrderId"],
        actor="pytest", inbound_no_reference="RK-UPDATED",
    )
    po = db_session.get(ExternalPurchaseOrder, result["id"])
    db_session.refresh(po)
    assert po.raw["manualInboundNo"] == "RK-UPDATED"
    assert po.raw["inboundReferenceStatus"] == "pending_import"

def test_existing_inbound_with_repeated_sku_lines_preserves_each_source_line(db_session):
    sku = _sku(db_session)
    no = f"RK-DUP-SKU-{uuid4().hex[:8]}"
    doc = JackyunGoodsDocument(
        document_type="inbound", goodsdoc_no=no,
        raw={"source": "jackyun"},
    )
    db_session.add(doc)
    db_session.flush()
    items = [
        JackyunGoodsDocumentItem(
            document_id=doc.id, line_no=1, matched_sku_id=sku.id,
            goods_no=sku.sku_code, sku_barcode=sku.barcode,
            quantity=Decimal("2"), unit_price_tax=Decimal("10"),
            amount_tax=Decimal("20"), raw={},
        ),
        JackyunGoodsDocumentItem(
            document_id=doc.id, line_no=2, matched_sku_id=sku.id,
            goods_no=sku.sku_code, sku_barcode=sku.barcode,
            quantity=Decimal("5"), unit_price_tax=Decimal("10"),
            amount_tax=Decimal("50"), raw={},
        ),
    ]
    db_session.add_all(items)
    db_session.flush()

    result = create_complete_purchase(db_session, _data(inbound_no=no), actor="pytest")
    allocations = db_session.query(PurchaseAllocationItem).filter_by(po_id=result["id"]).all()

    assert len(allocations) == 2
    assert {row.source_item_id for row in allocations} == {row.id for row in items}
    assert sum((row.quantity for row in allocations), Decimal("0")) == Decimal("7")
    assert sum((row.amount for row in allocations), Decimal("0")) == Decimal("70")

