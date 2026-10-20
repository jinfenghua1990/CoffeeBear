"""采购工作台一体化新建：单请求、单事务、不凭填写的入库单号虚增库存。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.audit import audit
from app.models.catalog import ProductSku, Warehouse
from app.models.consumable import Consumable
from app.models.consumable_purchase import ConsumablePurchase, ConsumablePurchaseItem
from app.models.jackyun import JackyunGoodsDocument, JackyunGoodsDocumentItem
from app.models.procurement_chain import ProcurementChainLink
from app.models.purchase import ExternalPurchaseOrder, PurchaseAllocationItem
from app.services.consumable_purchase_service import build_consumable_purchase_number, fingerprint
from app.services.purchase_service import normalize_platform
from app.services.supplier_sync_service import ensure_supplier
from app.utils.money import to_decimal


def _quantity(value, label: str, *, positive: bool = True) -> Decimal:
    try:
        result = to_decimal(value)
    except (TypeError, ValueError, ArithmeticError) as exc:
        raise ValueError(f"{label}不是有效数字") from exc
    if result is None or not result.is_finite() or (result <= 0 if positive else result < 0):
        raise ValueError(f"{label}必须为{'正数' if positive else '非负数'}")
    if result.as_tuple().exponent < -4:
        raise ValueError(f"{label}最多保留四位小数")
    return result


def _money(value, label: str) -> Decimal:
    result = _quantity(value, label, positive=False)
    return result.quantize(Decimal("0.0001"))


def create_complete_purchase(db: Session, data: dict, *, actor: str = "system") -> dict:
    """提交整张单：采购主单、明细、耗材采购单和已有入库单关联同时成功或回滚。

    填写的入库单号是用户明确的业务参考：
    - 若能在真实入库单表精确找到，关联原单，绝不创建重复单或改写已有库存；
    - 若尚未同步，保存为待匹配编号，不伪造入库事实；
    - 有其他采购单占用的入库单不会被静默挪用。
    """
    order_no = str(data.get("external_order_id") or "").strip()
    supplier = str(data.get("supplier_name") or "").strip()
    platform = normalize_platform(data.get("platform"))
    order_kind = str(data.get("order_kind") or "goods")
    inbound_no = str(data.get("inbound_no") or "").strip()
    invoice_no = str(data.get("invoice_reference_no") or "").strip()
    if not order_no or len(order_no) > 128:
        raise ValueError("采购订单号不能为空且不能超过128字符")
    if not supplier or len(supplier) > 256:
        raise ValueError("供应商不能为空且不能超过256字符")
    if order_kind not in {"goods", "consumable"}:
        raise ValueError("请选择有效的货品类型")
    if len(inbound_no) > 128 or len(invoice_no) > 128:
        raise ValueError("单据参考编号不能超过128字符")
    if db.query(ExternalPurchaseOrder.id).filter_by(
        platform=platform, external_order_id=order_no
    ).first() is not None:
        raise ValueError(f"采购单 {order_no} 已存在，请打开原订单编辑，避免重复创建")

    amount = _money(data.get("order_amount"), "采购总金额")
    paid = _money(data.get("paid_amount") or "0", "已付款金额")
    ordered_at = data.get("ordered_at")
    if ordered_at is None:
        raise ValueError("请填写采购时间")
    if ordered_at.tzinfo is None:
        ordered_at = ordered_at.replace(tzinfo=ZoneInfo(settings.TZ))

    warehouse = None
    if data.get("warehouse_id") is not None:
        warehouse = db.get(Warehouse, data["warehouse_id"])
        if warehouse is None or warehouse.status != "active":
            raise ValueError("入库仓库不存在或已停用")
        expected = "consumable" if order_kind == "consumable" else "goods"
        if warehouse.purpose not in {expected, "both"}:
            raise ValueError("所选仓库与货品类型不匹配")

    lines = data.get("items") or []
    if len(lines) > 100:
        raise ValueError("一张采购单最多录入100条明细")
    ids = [int(row.get("item_id") or 0) for row in lines]
    if 0 in ids or len(ids) != len(set(ids)):
        raise ValueError("商品明细不能为空，重复的商品请合并成一行")

    model = ProductSku if order_kind == "goods" else Consumable
    active = {row.id: row for row in db.query(model).filter(model.id.in_(ids)).all()} if ids else {}
    checked = []
    for index, line in enumerate(lines, 1):
        ref = active.get(int(line["item_id"]))
        if ref is None or ref.status != "active" or (order_kind == "goods" and ref.product_type == "virtual_bundle"):
            raise ValueError(f"第{index}行商品不存在或已停用")
        qty = _quantity(line.get("quantity"), f"第{index}行数量")
        total = _money(line.get("amount"), f"第{index}行总价")
        checked.append((ref, qty, total))
    # 允许已有入库单号但暂未导入 SKU 的历史采购订单先完整登记；不会因此自动入库。
    if not checked and not inbound_no:
        raise ValueError("请至少填写一条商品明细，或填写已有入库单号")

    inbound_doc = None
    inbound_status = "none"
    inbound_warning = ""
    if inbound_no:
        inbound_doc = db.query(JackyunGoodsDocument).filter(
            JackyunGoodsDocument.document_type == "inbound",
            func.lower(JackyunGoodsDocument.goodsdoc_no) == inbound_no.lower(),
        ).first()
        inbound_status = "pending_import" if inbound_doc is None else "linked"
        if inbound_doc is None:
            inbound_warning = "入库单号已保存；单据尚未同步，暂不计入实际库存"
        elif order_kind == "consumable":
            # 耗材的真实收货事实属于 consumable_receipts，不能误关联到正品入库表。
            inbound_status = "pending_consumable_receipt"
            inbound_warning = "耗材入库单号已登记；实际耗材收货仍以耗材收货台账为准"
            inbound_doc = None
        else:
            used = db.query(ProcurementChainLink).filter(
                ProcurementChainLink.target_type == "inbound",
                ProcurementChainLink.target_id == inbound_doc.id,
                ProcurementChainLink.confirmed.is_(True),
                ProcurementChainLink.match_method != "rejected",
            ).first()
            if used is not None:
                inbound_status = "pending_conflict"
                inbound_warning = "此入库单已关联其他采购单；已保留人工编号，需核对归属后关联"
                inbound_doc = None

    po = ExternalPurchaseOrder(
        external_order_id=order_no,
        platform=platform,
        supplier_name=supplier,
        title=str(data.get("title") or "").strip(),
        ordered_at=ordered_at,
        order_amount=amount,
        paid_amount=paid,
        warehouse_id=warehouse.id if warehouse is not None else None,
        order_kind_override=order_kind,
        purchase_status="pending_refine",
        raw={
            "source": "manual",
            "manualInboundNo": inbound_no,
            "inboundReferenceStatus": inbound_status,
            "invoiceReferenceNo": invoice_no,
        },
    )
    db.add(po)
    db.flush()
    ensure_supplier(db, supplier, platform=platform)
    for ref, qty, total in checked:
        if order_kind == "goods":
            db.add(PurchaseAllocationItem(
                po_id=po.id, sku_id=ref.id, sku_code=ref.sku_code,
                goods_name=ref.sku_name or "", quantity=qty,
                unit_price=(total / qty).quantize(Decimal("0.0001")),
                amount=total, source="manual",
            ))
    db.flush()

    consumable_purchase_id = None
    if order_kind == "consumable" and checked:
        from app.models.consumable_purchase import ConsumablePurchase
        consumable_number = build_consumable_purchase_number(
            db, ordered_on=ordered_at.date(), reference_no=order_no
        )
        item_payload = [
            {"consumable_id": ref.id, "quantity": str(qty), "unit_cost": str((total / qty).quantize(Decimal("0.0000000001")))}
            for ref, qty, total in checked
        ]
        cp = ConsumablePurchase(
            number=consumable_number, request_key=str(uuid4()),
            request_fingerprint=fingerprint({"sourcePurchaseId": po.id, "items": item_payload}),
            supplier_name=supplier, ordered_on=ordered_at.date(),
            reference_no=order_no, status="ordered",
            note=str(data.get("title") or "").strip(), created_by=actor,
        )
        db.add(cp)
        db.flush()
        consumable_purchase_id = cp.id
        for (ref, qty, total), payload in zip(checked, item_payload):
            db.add(ConsumablePurchaseItem(
                purchase_id=cp.id, consumable_id=ref.id, code=ref.code,
                name=ref.name, unit=ref.unit, quantity=qty,
                unit_cost=Decimal(payload["unit_cost"]), received_qty=Decimal("0"),
            ))

    # 可确认的既有入库单只关联一次，绝不基于文本新建库存流水。
    if inbound_doc is not None:
        link = ProcurementChainLink(
            external_po_id=po.id, target_type="inbound", target_id=inbound_doc.id,
            match_method="manual", confidence=Decimal("1"), confirmed=True,
            note=f"一体化建单：手工指定现有入库单 {inbound_doc.goodsdoc_no}",
        )
        db.add(link)
        if not checked:
            # 未人工填写 SKU 时，安全反填这张现有单上未被别的采购占用的明细。
            items = db.query(JackyunGoodsDocumentItem).filter_by(
                document_id=inbound_doc.id
            ).order_by(JackyunGoodsDocumentItem.line_no).all()
            existing_used = {
                row.source_item_id for row in db.query(PurchaseAllocationItem)
                .filter(PurchaseAllocationItem.source_item_id.isnot(None)).all()
            }
            for it in items:
                if it.matched_sku_id is None or it.id in existing_used:
                    continue
                marker = str((it.raw or {}).get("_1688采购订单") or "").strip()
                if marker and marker != order_no:
                    continue
                sku = db.get(ProductSku, it.matched_sku_id)
                qty = to_decimal(it.quantity)
                if sku is None or sku.status != "active" or qty <= 0:
                    continue
                total = (to_decimal(it.amount_tax) if it.amount_tax is not None
                         else qty * to_decimal(it.unit_price_tax)).quantize(Decimal("0.0001"))
                db.add(PurchaseAllocationItem(
                    po_id=po.id, sku_id=sku.id, sku_code=sku.sku_code,
                    goods_name=sku.sku_name or "", quantity=qty,
                    unit_price=(total / qty).quantize(Decimal("0.0001")),
                    amount=total, source="inbound_auto", source_item_id=it.id,
                    note=f"由入库单 #{inbound_doc.id} 明细自动反填",
                ))

    audit(
        db, actor, "purchase.order.create_complete", "external_purchase_orders", po.id,
        {
            "orderNo": order_no, "platform": platform, "kind": order_kind,
            "lineCount": len(checked), "inboundNo": inbound_no,
            "inboundStatus": inbound_status, "consumablePurchaseId": consumable_purchase_id,
        }, commit=False,
    )
    # 若 1688 原始导入单已存在，工作台用原始源单 ID 展示合并后的单行。
    # 统一在提交前解析，避免数据库已落库但响应查不到订单的半成功体验。
    from app.services.procurement_chain_service import _source_pairs
    db.flush()
    workbench_id = next(
        (source.id for source, external in _source_pairs(db)
         if source is not None and external is not None and external.id == po.id),
        -po.id,
    )
    db.commit()
    return {
        "id": po.id,
        "workbenchOrderId": workbench_id,
        "externalOrderId": order_no,
        "purchaseStatus": po.purchase_status,
        "inboundNo": inbound_no,
        "inboundStatus": inbound_status,
        "inboundWarning": inbound_warning,
        "lineCount": len(checked),
        "consumablePurchaseId": consumable_purchase_id,
    }
