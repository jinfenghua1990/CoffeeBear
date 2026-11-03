"""入库单人工更正：改单号 / 改入库日期 / 改明细含税单价。

- 单号：本系统与吉客云是两套独立系统，不互相联通。入库单在本系统生成后，
  单号由人工在吉客云建单时手抄保持一致（写错或后补都会不一致），
  因此必须允许人工更正，否则两个系统对不上账；
- 入库日期决定这批成本落在哪个报告期（``weighted_inbound_costs`` 按 ``document_at``
  截止取数），日期录错会让历史月份取不到成本；
- 含税单价决定加权成本本身，改价后同步重算明细金额与单据头金额。

三类更正对本系统入库单与吉客云历史导入单都开放（删除仍只允许本系统单据，
见 ``local_inbound_service.delete_local_purchase_inbound``）。
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.config import settings
from app.models.jackyun import JackyunGoodsDocument, JackyunGoodsDocumentItem
from app.utils.money import to_decimal

MONEY_QUANT = Decimal("0.0001")
MIN_YEAR = 2000
MAX_YEAR = 2100


def _aware(value: datetime) -> datetime:
    """前端 datetime-local 不带时区，按系统时区理解。"""
    if value.tzinfo is None:
        return value.replace(tzinfo=ZoneInfo(settings.TZ))
    return value


def _text(value) -> str | None:
    return None if value is None else str(value)


def set_document_no(db: Session, document_id: int, goodsdoc_no: str) -> dict:
    """更正入库单号，返回更正前后值供审计留痕。

    唯一性口径与模型约束一致：``(document_type, goodsdoc_no)`` 不能重复，
    所以要先查重再落库；改成同一个号视为无变化，直接返回。
    """
    document = db.get(JackyunGoodsDocument, document_id)
    if document is None or document.document_type != "inbound":
        raise ValueError("入库单不存在")

    target = (goodsdoc_no or "").strip()
    if not target:
        raise ValueError("入库单号不能为空")
    if len(target) > 128:
        raise ValueError("入库单号最长 128 个字符")

    before = document.goodsdoc_no
    if target == (before or ""):
        return {"ok": True, "documentId": document_id, "before": before, "after": target, "changed": False}

    occupied = (
        db.query(JackyunGoodsDocument.id)
        .filter(
            JackyunGoodsDocument.document_type == "inbound",
            JackyunGoodsDocument.goodsdoc_no == target,
            JackyunGoodsDocument.id != document.id,
        )
        .first()
    )
    if occupied is not None:
        raise ValueError(f"入库单号 {target} 已被另一张入库单占用，请确认后换一个")

    document.goodsdoc_no = target
    db.commit()
    return {"ok": True, "documentId": document_id, "before": before, "after": target, "changed": True}


def set_document_date(db: Session, document_id: int, inbound_at: datetime) -> dict:
    """更正入库单日期，返回更正前后值供审计留痕。"""
    document = db.get(JackyunGoodsDocument, document_id)
    if document is None or document.document_type != "inbound":
        raise ValueError("入库单不存在")
    if not isinstance(inbound_at, datetime):
        raise ValueError("入库时间格式不正确")
    if not MIN_YEAR <= inbound_at.year <= MAX_YEAR:
        raise ValueError(f"入库时间需在 {MIN_YEAR}-{MAX_YEAR} 年之间")

    before = document.document_at
    document.document_at = _aware(inbound_at)
    after = document.document_at
    db.commit()
    return {
        "ok": True,
        "documentId": document_id,
        "before": before.isoformat() if before is not None else None,
        "after": after.isoformat(),
    }


def set_item_unit_price(db: Session, document_id: int, item_id: int, unit_price_tax) -> dict:
    """更正入库明细含税单价，联动重算该行金额与单据头金额。"""
    document = db.get(JackyunGoodsDocument, document_id)
    if document is None or document.document_type != "inbound":
        raise ValueError("入库单不存在")
    item = db.get(JackyunGoodsDocumentItem, item_id)
    if item is None or item.document_id != document.id:
        raise ValueError("入库明细不存在或不属于该入库单")

    price = to_decimal(unit_price_tax)
    if not price.is_finite() or price < 0:
        raise ValueError("入库含税单价不能为负数")
    price = price.quantize(MONEY_QUANT)

    before_price = item.unit_price_tax
    before_amount = item.amount_tax
    quantity = to_decimal(item.quantity) if item.quantity is not None else None
    item.unit_price_tax = price
    if quantity is not None and quantity > 0:
        item.amount_tax = (quantity * price).quantize(MONEY_QUANT)
    db.flush()

    from app.services.inbound_allocation_seed import recalc_document_amount

    head = recalc_document_amount(db, document_id)
    return {
        "ok": True,
        "documentId": document_id,
        "itemId": item_id,
        "lineNo": item.line_no,
        "before": _text(before_price),
        "after": str(price),
        "amountTaxBefore": _text(before_amount),
        "amountTaxAfter": _text(item.amount_tax),
        "documentAmountBefore": head["before"],
        "documentAmountAfter": head["after"],
    }


def set_item_quantity(db: Session, document_id: int, item_id: int, quantity) -> dict:
    """更正入库明细数量，联动重算该行金额、单据头数量/金额，并重算耗材台账。

    数量直接决定库存数量与加权成本，故与改单价不同：
    - 改数量后按「新数量 × 含税单价」重算本行金额；单价缺失时用旧金额/旧数量反推，
      保证只改数量时单价不变；
    - 单据头 ``total_quantity`` 与 ``total_amount``（=Σ 明细金额）一并重算；
    - 库存（current_positions）与加权成本（weighted_inbound_costs）均为实时聚合，
      无需单独重算，下次读取自动对齐；
    - 耗材台账按 SKU 映射落库，需对每个指向本入库单的采购关联重跑 auto_apply_inbound_usage
      （与正常建链同一入口，幂等）。
    """
    document = db.get(JackyunGoodsDocument, document_id)
    if document is None or document.document_type != "inbound":
        raise ValueError("入库单不存在")
    item = db.get(JackyunGoodsDocumentItem, item_id)
    if item is None or item.document_id != document.id:
        raise ValueError("入库明细不存在或不属于该入库单")

    qty = to_decimal(quantity)
    if not qty.is_finite() or qty <= 0:
        raise ValueError("入库数量必须大于 0")

    before_qty = item.quantity
    before_amount = item.amount_tax

    # 单价优先用已记录的含税单价；缺失时用旧金额/旧数量反推，保证只改数量时单价不变
    price = item.unit_price_tax
    if price is None and before_qty is not None and before_qty > 0 and before_amount is not None:
        price = to_decimal(before_amount) / to_decimal(before_qty)

    item.quantity = qty.quantize(MONEY_QUANT)
    if price is not None:
        item.amount_tax = (qty * to_decimal(price)).quantize(MONEY_QUANT)
    db.flush()

    # 单据头：数量合计（recalc_document_amount 只重算金额头，这里补数量头）
    items = (
        db.query(JackyunGoodsDocumentItem)
        .filter(JackyunGoodsDocumentItem.document_id == document_id)
        .all()
    )
    new_total_qty = sum(
        (to_decimal(i.quantity) for i in items if i.quantity is not None),
        Decimal("0"),
    )
    document.total_quantity = new_total_qty.quantize(MONEY_QUANT)

    head = recalc_document_amount(db, document_id)

    # 耗材台账：对每个指向本入库单的采购关联重算（与正常建链同一入口，幂等）
    from app.models.procurement_chain import ProcurementChainLink
    from app.services.consumable_service import auto_apply_inbound_usage

    links = (
        db.query(ProcurementChainLink)
        .filter(
            ProcurementChainLink.target_type == "inbound",
            ProcurementChainLink.target_id == document.id,
        )
        .all()
    )
    for link in links:
        auto_apply_inbound_usage(db, link.id, note="入库数量更正后重算耗材台账", commit=False)
    db.commit()

    return {
        "ok": True,
        "documentId": document_id,
        "itemId": item_id,
        "lineNo": item.line_no,
        "before": _text(before_qty),
        "after": str(item.quantity),
        "amountTaxBefore": _text(before_amount),
        "amountTaxAfter": _text(item.amount_tax),
        "documentQuantityAfter": str(document.total_quantity),
        "documentAmountBefore": head["before"],
        "documentAmountAfter": head["after"],
    }