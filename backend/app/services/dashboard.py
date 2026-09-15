"""经营看板（规格 6）：销售趋势 / 平台店铺排行 / SKU 排行 / 订单 / 售后 / 库存。

原则：
- 页面只查本地库（吉客云同步副本），不触发外部查询（规格 5）
- 数据未落地时如实返回空集，不伪造数字
- 全部金额 Decimal，输出 str
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.catalog import Product, ProductSku, Store, Warehouse
from app.models.consumable import Consumable, ConsumableSkuMapping
from app.models.sales import AftersalesOrder, SalesOrder, SalesOrderItem
from app.models.tax import TaxAccountingCategoryRule
from app.services.inventory_position_service import current_positions
from app.utils.money import quantize, to_decimal


def _money(value: Decimal | None) -> str | None:
    return f"{quantize(to_decimal(value), Decimal('0.01')):f}" if value is not None else None


def _quantity(value: Decimal | None) -> str | None:
    return f"{to_decimal(value):f}" if value is not None else None


def _tax_rule_label(row: TaxAccountingCategoryRule | None) -> str:
    if row is None:
        return ""
    return f"{row.category_name} · {row.item_name}"


def _tax_rule_map(db: Session) -> dict[int, TaxAccountingCategoryRule]:
    return {row.id: row for row in db.query(TaxAccountingCategoryRule).all()}


def _valid_sales():
    """业绩口径：剔除取消/作废/待审核订单（2026-09-07 与销售清单导入通道对齐）。"""
    o = SalesOrder
    return ~or_(
        o.order_status.like("已取消%"),
        o.order_status.like("作废%"),
        o.order_status == "待审核",
    )


def _range_conds(start: date | None, end: date | None) -> list[Any]:
    """ordered_at 闭区间过滤（含 end 当天；end 缺省不设上限），叠加业绩口径。"""
    conds = [_valid_sales()]
    if start is not None:
        conds.append(SalesOrder.ordered_at >= start)
    if end is not None:
        conds.append(SalesOrder.ordered_at < end + timedelta(days=1))
    return conds


def sales_trend(db: Session, days: int = 30, start: date | None = None, end: date | None = None) -> list[dict[str, Any]]:
    """区间内每日销售额/订单数/退款率。按 ordered_at 分组（本地库）。
    start 传入时按 [start, end] 闭区间，否则取近 N 天。"""
    if start is not None:
        conds = _range_conds(start, end)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        conds = [SalesOrder.ordered_at >= since, _valid_sales()]
    rows = (
        db.query(
            func.date(SalesOrder.ordered_at),
            func.count(SalesOrder.id),
            func.coalesce(func.sum(SalesOrder.paid_amount), 0),
        )
        .filter(*conds)
        .group_by(func.date(SalesOrder.ordered_at))
        .order_by(func.date(SalesOrder.ordered_at))
        .all()
    )
    out = []
    for day, cnt, amt in rows:
        out.append({"date": day.isoformat(), "orders": int(cnt), "salesAmount": _money(amt)})
    return out


def platform_ranking(db: Session, start: date | None = None, end: date | None = None) -> list[dict[str, Any]]:
    """平台/店铺销售排行。无平台字段的订单归入 unknown。"""
    rows = (
        db.query(SalesOrder.platform, func.count(SalesOrder.id), func.coalesce(func.sum(SalesOrder.paid_amount), 0))
        .filter(*_range_conds(start, end))
        .group_by(SalesOrder.platform)
        .order_by(func.sum(SalesOrder.paid_amount).desc())
        .all()
    )
    out = []
    for platform, cnt, amt in rows:
        out.append({"platform": platform or "unknown", "orders": int(cnt), "salesAmount": _money(amt)})
    return out


def sku_ranking(db: Session, limit: int = 20, start: date | None = None, end: date | None = None) -> list[dict[str, Any]]:
    """SKU 销售额排行（来自订单明细本地副本）。"""
    rows = (
        db.query(
            SalesOrderItem.sku_code,
            SalesOrderItem.goods_name,
            func.count(SalesOrderItem.id),
            func.coalesce(func.sum(SalesOrderItem.amount), 0),
        )
        .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
        .filter(*_range_conds(start, end))
        .group_by(SalesOrderItem.sku_code, SalesOrderItem.goods_name)
        .order_by(func.sum(SalesOrderItem.amount).desc())
        .limit(limit)
        .all()
    )
    out = []
    for sku_code, goods_name, cnt, amt in rows:
        out.append({
            "skuCode": sku_code or "",
            "goodsName": goods_name or "",
            "orders": int(cnt),
            "salesAmount": _money(amt),
        })
    return out


def inventory_summary(db: Session) -> dict[str, Any]:
    """库存概览：独立运算 Σ采购入库 − Σ销售出库，仓库按本系统仓库档案归属。"""
    skus = db.query(ProductSku).count()
    positions = current_positions(db)
    last_at = positions["last_document_at"]
    if last_at is None:
        return {"skuCount": skus, "lastDocumentAt": None, "totalQuantity": None,
                "byWarehouse": [], "note": "暂无出入库单据；导入采购入库/销售出库单后自动累计"}
    by_warehouse_values: dict[int | None, dict[int, Decimal]] = {}
    for sku_id, per_warehouse in positions["by_sku_warehouse"].items():
        for warehouse_id, quantity in per_warehouse.items():
            by_warehouse_values.setdefault(warehouse_id, {})[sku_id] = quantity
    wh_names = {row.id: row.name for row in db.query(Warehouse).all()}
    total = sum(positions["by_sku"].values(), Decimal("0"))
    by_warehouse = [
        {
            "warehouseId": warehouse_id,
            "warehouseName": wh_names.get(warehouse_id) or "未映射仓库",
            "quantity": _quantity(sum(values.values(), Decimal("0"))),
            "skus": len(values),
        }
        for warehouse_id, values in sorted(by_warehouse_values.items(), key=lambda item: (item[0] is None, item[0] or 0))
    ]
    return {
        "skuCount": skus,
        "lastDocumentAt": last_at.isoformat(),
        "totalQuantity": _quantity(total),
        "byWarehouse": by_warehouse,
        "positionSource": positions["source"],
        "appliedDocumentCount": positions["applied_document_count"],
    }


def inventory_skus(db: Session, search: str = "", limit: int = 1000) -> list[dict[str, Any]]:
    """SKU 级库存清单：独立运算（采购入库 − 销售出库）的总量与仓库分布。

    返回全部 SKU 档案（含无单据的），带 hasMovement=false 标记；金额/数量输出 str。
    """
    positions = current_positions(db)
    last_at = positions["last_document_at"]
    agg = positions["by_sku_warehouse"]
    wh_names = {w.id: w.name for w in db.query(Warehouse).all()}

    q = (
        db.query(ProductSku, Product)
        .outerjoin(Product, Product.id == ProductSku.product_id)
        .order_by(ProductSku.sku_code, ProductSku.id)
    )
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        q = q.filter(or_(
            ProductSku.sku_code.ilike(pattern),
            ProductSku.sku_name.ilike(pattern),
            ProductSku.barcode.ilike(pattern),
            Product.goods_name.ilike(pattern),
        ))

    out: list[dict[str, Any]] = []
    for sku, product in q.limit(limit).all():
        per = agg.get(sku.id, {})
        total = positions["by_sku"].get(sku.id, Decimal("0"))
        warehouses = [
            {"warehouseId": wid, "warehouseName": wh_names.get(wid) or "未映射仓库", "quantity": _quantity(qty)}
            for wid, qty in per.items()
        ]
        out.append({
            "skuId": sku.id,
            "jackyunSkuId": sku.jackyun_sku_id,
            "skuCode": sku.sku_code,
            "productType": sku.product_type or ("virtual_bundle" if sku.sku_code.upper().startswith("ES") else "single"),
            "skuName": sku.sku_name,
            "goodsName": product.goods_name if product else "",
            "barcode": sku.barcode,
            "unit": sku.unit,
            "status": sku.status,
            "quantity": _quantity(total),
            "hasMovement": sku.id in positions["seen_skus"],
            "warehouses": warehouses,
            "lastDocumentAt": last_at.isoformat() if last_at is not None else None,
        })
    return out


def list_products(db: Session, search: str = "", limit: int = 200) -> list[dict[str, Any]]:
    """吉客云商品/SKU 本地主档；供商品页和采购 SKU 选择器复用。"""
    q = (
        db.query(ProductSku, Product)
        .outerjoin(Product, Product.id == ProductSku.product_id)
        .order_by(ProductSku.sku_code, ProductSku.id)
    )
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        q = q.filter(or_(
            ProductSku.sku_code.ilike(pattern),
            ProductSku.sku_name.ilike(pattern),
            ProductSku.barcode.ilike(pattern),
            Product.goods_name.ilike(pattern),
        ))
    tax_rules = _tax_rule_map(db)
    return [
        {
            "id": sku.id,
            "jackyunSkuId": sku.jackyun_sku_id,
            "skuCode": sku.sku_code,
            "productType": sku.product_type or ("virtual_bundle" if sku.sku_code.upper().startswith("ES") else "single"),
            "skuName": sku.sku_name,
            "goodsName": product.goods_name if product else "",
            "barcode": sku.barcode,
            "unit": sku.unit,
            "salePrice": _money(sku.sale_price),
            "defaultCost": _money(sku.default_cost),
            "costMode": sku.cost_mode or "fixed",
            "costTolerancePct": str(sku.cost_tolerance_pct) if sku.cost_tolerance_pct is not None else "0.0200",
            "taxCode": sku.tax_code or "",
            "taxCategoryRuleId": sku.tax_category_rule_id,
            "taxCategoryRuleName": _tax_rule_label(tax_rules.get(sku.tax_category_rule_id)),
            "status": sku.status,
        }
        for sku, product in q.limit(limit).all()
    ]


def catalog_unified(db: Session, kind: str = "all", search: str = "", limit: int = 500) -> list[dict[str, Any]]:
    """统一货品档案：正品（吉客云 SKU）+ 耗材（本平台档案）合成一份列表。

    - kind=all/goods/consumable；search 命中编码/名称/条码。
    - 正品行库存由本系统独立运算：采购入库 − 销售出库；
    - 耗材行返回 自有仓/工厂/在途 三口径 + 安全库存预警 + 关联正品。
    - 条形码允许正品/耗材相同：系统内以 (kind, id) 独立 ID 区分，不以条码作主键。
    """
    term = search.strip()
    pattern = f"%{term}%" if term else None
    items: list[dict[str, Any]] = []
    tax_rules = _tax_rule_map(db)

    if kind in {"all", "goods"}:
        positions = current_positions(db)
        agg = positions["by_sku"]
        q = (
            db.query(ProductSku, Product)
            .outerjoin(Product, Product.id == ProductSku.product_id)
            .order_by(ProductSku.sku_code, ProductSku.id)
        )
        if pattern:
            q = q.filter(or_(
                ProductSku.sku_code.ilike(pattern),
                ProductSku.sku_name.ilike(pattern),
                ProductSku.barcode.ilike(pattern),
                Product.goods_name.ilike(pattern),
                Product.category.ilike(pattern),
            ))
        for sku, product in q.limit(limit).all():
            items.append({
                "kind": "goods",
                "id": sku.id,
                "code": sku.sku_code,
                "jackyunSkuId": sku.jackyun_sku_id,
                "name": sku.sku_name or (product.goods_name if product else ""),
                "goodsName": product.goods_name if product else "",
                "barcode": sku.barcode or "",
                "unit": sku.unit or "",
                "category": sku.product_type or "single",
                "goodsCategory": (product.category if product else "") or ((product.raw or {}).get("cateName", "") if product else "") or ((sku.raw or {}).get("goodsCategory", "")) or ((sku.raw or {}).get("cateName", "")),
                "status": sku.status,
                "stockOwn": _quantity(agg.get(sku.id)),
                "stockFactory": None,
                "stockTransit": None,
                "minStock": None,
                "lowStock": False,
                "hasMovement": sku.id in positions["seen_skus"],
                "linkedSkus": [],
                "costMode": sku.cost_mode or "fixed",
                "costTolerancePct": str(sku.cost_tolerance_pct) if sku.cost_tolerance_pct is not None else "0.0200",
                "taxCode": sku.tax_code or "",
                "taxCategoryRuleId": sku.tax_category_rule_id,
                "taxCategoryRuleName": _tax_rule_label(tax_rules.get(sku.tax_category_rule_id)),
                "salePrice": _money(sku.sale_price),
                "defaultCost": _money(sku.default_cost),
            })

    if kind in {"all", "consumable"}:
        cq = db.query(Consumable).order_by(Consumable.code, Consumable.id)
        if pattern:
            cq = cq.filter(or_(
                Consumable.code.ilike(pattern),
                Consumable.name.ilike(pattern),
                Consumable.barcode.ilike(pattern),
            ))
        consumables = cq.limit(limit).all()
        link_rows = (
            db.query(ConsumableSkuMapping, ProductSku)
            .join(ProductSku, ProductSku.id == ConsumableSkuMapping.sku_id)
            .filter(ConsumableSkuMapping.consumable_id.in_([c.id for c in consumables]))
            .all()
        ) if consumables else []
        links: dict[int, list[dict[str, Any]]] = {}
        for mapping, sku in link_rows:
            links.setdefault(mapping.consumable_id, []).append(
                {"skuId": sku.id, "skuCode": sku.sku_code, "skuName": sku.sku_name}
            )
        for row in consumables:
            available = to_decimal(row.stock_qty) + to_decimal(row.factory_qty)
            min_qty = to_decimal(row.min_stock_qty)
            items.append({
                "kind": "consumable",
                "id": row.id,
                "code": row.code,
                "name": row.name,
                "goodsName": "",
                "barcode": row.barcode or "",
                "unit": row.unit,
                "category": row.category,
                "goodsCategory": row.category,
                "status": row.status,
                "stockOwn": _quantity(row.stock_qty),
                "stockFactory": _quantity(row.factory_qty),
                "stockTransit": _quantity(row.transit_qty),
                "minStock": _quantity(row.min_stock_qty),
                "lowStock": (min_qty > 0 and available <= min_qty)
                or to_decimal(row.stock_qty) < 0
                or to_decimal(row.factory_qty) < 0,
                "hasSnapshot": None,
                "linkedSkus": links.get(row.id, []),
                "costMode": None,
                "costTolerancePct": None,
                "taxCode": row.tax_code or "",
                "taxCategoryRuleId": row.tax_category_rule_id,
                "taxCategoryRuleName": _tax_rule_label(tax_rules.get(row.tax_category_rule_id)),
                "salePrice": None,
                "defaultCost": None,
                "purchaseUnitCost": _money(row.purchase_unit_cost),
            })

    items.sort(key=lambda r: (r["kind"], r["code"]))
    return items


def overview_metrics(db: Session) -> dict[str, Any]:
    """总览首屏 9 指标（规格 4）。全部来自本地库聚合，数据为空如实 None。"""
    paid_orders = (
        db.query(SalesOrder)
        .filter(SalesOrder.paid_amount.isnot(None))
        .all()
    )
    sales_amount = sum((to_decimal(o.paid_amount) for o in paid_orders), Decimal("0"))
    order_count = db.query(SalesOrder).count()

    refunds = db.query(AftersalesOrder).filter(AftersalesOrder.type == "refund").all()
    refund_amount = sum((to_decimal(r.refund_amount) for r in refunds), Decimal("0"))
    net_sales = sales_amount - refund_amount
    refund_rate = None
    if sales_amount > 0:
        refund_rate = f"{((refund_amount / sales_amount) * 100).quantize(Decimal('0.01'))}"

    from app.models.profit import ProfitSnapshot
    from app.services import reconciliation as rc

    recon = rc.overview(db)
    receivable = to_decimal(recon["receivable"])
    received = to_decimal(recon["received"])
    gross = db.query(ProfitSnapshot).filter(ProfitSnapshot.gross_profit.isnot(None)).order_by(ProfitSnapshot.id.desc()).first()

    return {
        "salesAmount": _money(sales_amount) if order_count else None,
        "netSales": _money(net_sales) if order_count else None,
        "orderCount": order_count if order_count else None,
        "refundRate": refund_rate,
        "grossProfit": _money(gross.gross_profit) if gross else None,
        "receivable": _money(receivable) if receivable else None,
        "received": _money(received) if received else None,
        "pendingReceive": _money(receivable - received) if receivable else None,
    }


def list_orders(db: Session, status: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    q = db.query(SalesOrder).order_by(SalesOrder.ordered_at.desc().nullslast(), SalesOrder.id.desc())
    if status:
        q = q.filter(SalesOrder.order_status == status)
    rows = q.limit(limit).all()
    # Bulk fetch stores to avoid N+1 (was one db.get per order)
    store_ids = {o.store_id for o in rows if o.store_id}
    store_map: dict[int, Store] = {}
    if store_ids:
        store_map = {s.id: s for s in db.query(Store).filter(Store.id.in_(store_ids)).all()}
    order_ids = [o.id for o in rows]
    item_map: dict[int, dict[str, Any]] = {}
    item_counts: dict[int, int] = {}
    if order_ids:
        item_rows = (
            db.query(SalesOrderItem)
            .filter(SalesOrderItem.order_id.in_(order_ids))
            .order_by(SalesOrderItem.order_id, SalesOrderItem.id)
            .all()
        )
        for item in item_rows:
            item_counts[item.order_id] = item_counts.get(item.order_id, 0) + 1
            summary = item_map.setdefault(item.order_id, {
                "name": (item.goods_name or "").strip() or (item.sku_code or "").strip(),
                "quantity": Decimal("0"),
                "has_quantity": False,
            })
            if item.quantity is not None:
                summary["quantity"] += to_decimal(item.quantity)
                summary["has_quantity"] = True
    out = []
    for o in rows:
        store = store_map.get(o.store_id) if o.store_id else None
        item = item_map.get(o.id, {})
        out.append({
            "id": o.id, "orderNo": o.order_no, "platform": o.platform,
            "storeName": store.name if store else "",
            "orderStatus": o.order_status, "payStatus": o.pay_status,
            "orderAmount": _money(o.order_amount), "paidAmount": _money(o.paid_amount),
            "itemName": item.get("name", ""),
            "quantity": _quantity(item["quantity"]) if item.get("has_quantity") else None,
            "itemCount": item_counts.get(o.id, 0),
            "orderedAt": o.ordered_at.isoformat() if o.ordered_at else None,
        })
    return out


def list_aftersales(db: Session, limit: int = 200) -> list[dict[str, Any]]:
    rows = db.query(AftersalesOrder).order_by(AftersalesOrder.created_at_src.desc().nullslast(),
                                              AftersalesOrder.id.desc()).limit(limit).all()
    return [
        {
            "id": r.id, "aftersaleNo": r.aftersale_no, "orderNo": r.order_no,
            "type": r.type, "status": r.status,
            "refundAmount": _money(r.refund_amount), "reason": r.reason,
            "createdAt": r.created_at_src.isoformat() if r.created_at_src else None,
        }
        for r in rows
    ]
