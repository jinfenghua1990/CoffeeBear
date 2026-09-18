"""可配置月度销售汇总。

原则：
- 字段、别名、顺序保存在数据库模板中；后台月度任务与前端共用同一模板。
- 有效销售订单口径 = 成交口径（sales_scope）：待发/已发/待确认收货/已完成计入，
  关闭/取消/作废/退货/退款/待审核/待付款单不计入。
- 销售金额取订单客户实付金额（与业绩总览/月结同口径）；往下拆到 税务编号/产品 时
  按明细行成本占比分摊，不再使用与实付对不上的吉客云行金额。
- 按仓库汇总：每行一个仓库，输出 月度时间 / 仓库 / 税务编号 / 发货总数量 / 销售总金额 / 销售总成本。
- 仓库取订单原始来源的 warehouseName；税务编号取货品档案，成本只取账期截止前
  采购入库明细的数量加权平均含税单价（与月结/利润中心同口径），不使用货品档案
  default_cost 兜底；个别 SKU 缺入库成本时按已覆盖部分出数，并在 summary 标记
  costIncomplete / costMissingDetail，提示补充采购入库成本后重新生成。
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.audit import audit
from app.models.catalog import ProductSku
from app.models.finance import ArchiveFile, FinanceSalesReportTemplate, FinanceUnbilledAdjustment
from app.models.sales import SalesOrder, SalesOrderItem
from app.services import finance_service
from app.services.inbound_cost_service import weighted_inbound_costs
from app.services.monthly_core import month_bounds
from app.services.sales_scope import deal_orders_condition
from app.utils.money import quantize, to_decimal

FIELD_REGISTRY: dict[str, dict[str, str]] = {
    "period": {"label": "月度时间", "type": "text"},
    "warehouse": {"label": "仓库", "type": "text"},
    "tax_code": {"label": "税务编号", "type": "text"},
    "total_quantity": {"label": "发货总数量", "type": "number"},
    "total_sales": {"label": "销售总金额", "type": "money"},
    "total_cost": {"label": "销售总成本", "type": "money"},
}

DEFAULT_FIELD_KEYS = [
    "period",
    "warehouse",
    "tax_code",
    "total_quantity",
    "total_sales",
    "total_cost",
]

DEFAULT_RULES: dict[str, Any] = {
    "valid_order_mode": "paid_or_completed",
    "refund_mode": "recorded_non_cancelled",
    "timezone": settings.TZ,
    "order_level_value_mode": "first_item_only",
}


def default_fields() -> list[dict[str, Any]]:
    return [
        {
            "key": key,
            "label": meta["label"],
            "enabled": key in DEFAULT_FIELD_KEYS,
        }
        for key, meta in FIELD_REGISTRY.items()
    ]


def _normalize_fields(value: Any) -> list[dict[str, Any]]:
    """只接收注册字段；保存数组顺序即导出顺序，同时自动补齐新版本新增字段。"""
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for raw in value if isinstance(value, list) else []:
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key") or "").strip()
        if key not in FIELD_REGISTRY or key in seen:
            continue
        label = str(raw.get("label") or FIELD_REGISTRY[key]["label"]).strip()[:80]
        result.append({"key": key, "label": label or FIELD_REGISTRY[key]["label"],
                       "enabled": bool(raw.get("enabled", True))})
        seen.add(key)
    for key, meta in FIELD_REGISTRY.items():
        if key not in seen:
            result.append({"key": key, "label": meta["label"], "enabled": False})
    return result or default_fields()


def _normalize_emails(value: Any) -> list[str]:
    result: list[str] = []
    for raw in value if isinstance(value, list) else []:
        email = str(raw).strip()
        if email and email not in result:
            result.append(email[:320])
    return result


def get_or_create_template(db: Session, company: str = finance_service.DEFAULT_COMPANY) -> FinanceSalesReportTemplate:
    row = (
        db.query(FinanceSalesReportTemplate)
        .filter_by(company=company, name="默认财务月报")
        .first()
    )
    if row is None:
        row = FinanceSalesReportTemplate(
            company=company,
            name="默认财务月报",
            enabled=True,
            fields=default_fields(),
            rules=dict(DEFAULT_RULES),
            to_addrs=[],
            cc_addrs=[],
            auto_send=False,
            send_day=3,
            send_hour=10,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    else:
        # 旧版本模板字段（订单明细口径）不是当前注册字段时，自动升级为仓库汇总默认字段。
        stored_keys = {f.get("key") for f in (row.fields or []) if isinstance(f, dict)}
        if not (stored_keys & set(FIELD_REGISTRY)):
            row.fields = default_fields()
            db.commit()
            db.refresh(row)
    return row


def serialize_template(row: FinanceSalesReportTemplate) -> dict[str, Any]:
    return {
        "id": row.id,
        "company": row.company,
        "name": row.name,
        "enabled": row.enabled,
        "fields": _normalize_fields(row.fields),
        "fieldRegistry": [
            {"key": key, "defaultLabel": meta["label"], "type": meta["type"]}
            for key, meta in FIELD_REGISTRY.items()
        ],
        "rules": {**DEFAULT_RULES, **(row.rules or {})},
        "toAddrs": list(row.to_addrs or []),
        "ccAddrs": list(row.cc_addrs or []),
        "autoSend": row.auto_send,
        "sendDay": row.send_day,
        "sendHour": row.send_hour,
    }


def save_template(
    db: Session,
    *,
    company: str,
    fields: list[dict[str, Any]],
    rules: dict[str, Any] | None,
    to_addrs: list[str] | None,
    cc_addrs: list[str] | None,
    auto_send: bool,
    send_day: int,
    send_hour: int,
    enabled: bool = True,
) -> FinanceSalesReportTemplate:
    if not 1 <= int(send_day) <= 28:
        raise ValueError("自动发送日期只能设置为每月 1-28 日")
    if not 0 <= int(send_hour) <= 23:
        raise ValueError("自动发送小时必须为 0-23")
    row = get_or_create_template(db, company)
    row.fields = _normalize_fields(fields)
    # 当前口径值是受控枚举；前端可调整时仍避免写入未知计算逻辑。
    normalized_rules = dict(DEFAULT_RULES)
    supplied = rules or {}
    if supplied.get("valid_order_mode") in {"paid_or_completed"}:
        normalized_rules["valid_order_mode"] = supplied["valid_order_mode"]
    if supplied.get("refund_mode") in {"recorded_non_cancelled", "ignore_refund"}:
        normalized_rules["refund_mode"] = supplied["refund_mode"]
    normalized_rules["timezone"] = settings.TZ
    normalized_rules["order_level_value_mode"] = "first_item_only"
    row.rules = normalized_rules
    row.to_addrs = _normalize_emails(to_addrs or [])
    row.cc_addrs = _normalize_emails(cc_addrs or [])
    row.auto_send = bool(auto_send)
    row.send_day = int(send_day)
    row.send_hour = int(send_hour)
    row.enabled = bool(enabled)
    db.commit()
    db.refresh(row)
    return row


def _valid_order_condition():
    """财务月报口径 = 成交口径（sales_scope）：待发/已发/待确认收货/已完成全部计入。

    关闭/取消/作废/退货/退款/待审核/待付款单不计入；不再额外叠加「已付款/已完成」，
    避免把发货在途、待发货等成交单排除在收入表之外（2026-09-17 与用户确认）。
    """
    return deal_orders_condition()


def _money(value: Decimal | None) -> Decimal:
    return value if value is not None else Decimal("0")


def _order_paid_shares(
    paid: Decimal, rows: list[tuple[SalesOrderItem, Decimal | None]]
) -> list[Decimal]:
    """把订单客户实付金额按行成本（数量 × 入库加权成本）占比分摊到明细行。

    个别行缺入库成本时退化为按销售数量占比；行数据完全不可用时均分。
    """
    if not rows:
        return []
    weights = [
        _money(item.quantity) * unit_cost if unit_cost is not None else _money(item.quantity)
        for item, unit_cost in rows
    ]
    total = sum(weights, Decimal("0"))
    if total <= 0:
        return [paid / len(rows)] * len(rows)
    return [paid * (weight / total) for weight in weights]


def _string_decimal(value: Decimal | None) -> str:
    return str(quantize(value or Decimal("0"), Decimal("0.01")))


UNBILLED_KEY_SEPARATOR = "\x1f"


def unbilled_detail_key(detail: dict[str, Any]) -> str:
    """返回可持久化的明细键；无票收入明细已按税务编号 + 产品聚合。"""
    return f"{str(detail.get('taxCode') or '').strip()}{UNBILLED_KEY_SEPARATOR}{str(detail.get('product') or '').strip()}"


def _warehouse_of(order: SalesOrder) -> str:
    raw = order.raw or {}
    name = str(raw.get("warehouseName") or raw.get("warehouse") or "").strip()
    return name or "未标记仓库"


def build_report(
    db: Session,
    year: int,
    month: int,
    template: FinanceSalesReportTemplate | None = None,
) -> dict[str, Any]:
    if not 1 <= month <= 12:
        raise ValueError("非法月份")
    template = template or get_or_create_template(db)
    rules = {**DEFAULT_RULES, **(template.rules or {})}
    start, nxt = month_bounds(year, month)
    orders = (
        db.query(SalesOrder)
        .filter(_valid_order_condition())
        .filter(SalesOrder.ordered_at >= start, SalesOrder.ordered_at < nxt)
        .order_by(SalesOrder.ordered_at, SalesOrder.id)
        .all()
    )
    order_ids = [row.id for row in orders]
    items_by_order: dict[int, list[SalesOrderItem]] = defaultdict(list)
    sku_codes: set[str] = set()
    if order_ids:
        for item in (
            db.query(SalesOrderItem)
            .filter(SalesOrderItem.order_id.in_(order_ids))
            .order_by(SalesOrderItem.order_id, SalesOrderItem.id)
            .all()
        ):
            items_by_order[item.order_id].append(item)
            if item.sku_code:
                sku_codes.add(item.sku_code)

    sku_meta: dict[str, dict[str, Any]] = {}
    if sku_codes:
        for sku in (
            db.query(ProductSku)
            .filter(ProductSku.sku_code.in_(sku_codes))
            .all()
        ):
            sku_meta[sku.sku_code] = {
                "id": sku.id,
                "name": sku.sku_name or sku.sku_code,
                "tax_code": (sku.tax_code or "").strip(),
            }
    inbound_costs = weighted_inbound_costs(
        db,
        as_of=nxt,
        sku_ids={int(meta["id"]) for meta in sku_meta.values()},
    )

    aggregates: dict[str, dict[str, Any]] = {}
    # 缺入库成本的明细（按 SKU 汇总），用于 summary 告警；不用 default_cost 兜底。
    cost_missing: dict[str, dict[str, Any]] = {}
    for order in orders:
        warehouse = _warehouse_of(order)
        agg = aggregates.setdefault(warehouse, {
            "quantity": Decimal("0"),
            "sales": Decimal("0"),
            "cost": Decimal("0"),
            "tax_codes": set(),
        })
        # 销售金额 = 订单客户实付金额（与业绩总览/月结同口径），订单级只累加一次；
        # 吉客云行金额与实付对不上（含 0 值与负数），不再作为收入基数。
        agg["sales"] += _money(order.paid_amount)
        for item in items_by_order.get(order.id) or []:
            quantity = _money(item.quantity)
            agg["quantity"] += quantity
            if item.sku_code:
                meta = sku_meta.get(item.sku_code)
                if meta:
                    unit_cost = inbound_costs.get(meta["id"])
                    if unit_cost is not None:
                        agg["cost"] += quantity * unit_cost
                    else:
                        missed = cost_missing.setdefault(item.sku_code, {
                            "skuCode": item.sku_code,
                            "skuName": meta["name"],
                            "quantity": Decimal("0"),
                        })
                        missed["quantity"] += quantity
                    if meta["tax_code"]:
                        agg["tax_codes"].add(meta["tax_code"])

    rows: list[dict[str, Any]] = []
    for warehouse, agg in sorted(aggregates.items(), key=lambda kv: kv[1]["sales"], reverse=True):
        rows.append({
            "period": f"{year}-{month:02d}",
            "warehouse": warehouse,
            "tax_code": " / ".join(sorted(agg["tax_codes"])),
            "total_quantity": str(agg["quantity"]),
            "total_sales": _string_decimal(agg["sales"]),
            "total_cost": _string_decimal(agg["cost"]),
        })

    enabled_fields = [f for f in _normalize_fields(template.fields) if f["enabled"]]
    summary = {
        "orderCount": len(orders),
        "warehouseCount": len(rows),
        "totalQuantity": str(sum((Decimal(row["total_quantity"] or "0") for row in rows), Decimal("0"))),
        "salesAmount": _string_decimal(sum((Decimal(row["total_sales"] or "0") for row in rows), Decimal("0"))),
        "costAmount": _string_decimal(sum((Decimal(row["total_cost"] or "0") for row in rows), Decimal("0"))),
        # 缺入库成本时成本只含已覆盖部分；前端据此提示去补充数据后重新生成。
        "costIncomplete": bool(cost_missing),
        "costMissingDetail": [
            {"skuCode": row["skuCode"], "skuName": row["skuName"], "quantity": str(row["quantity"])}
            for row in sorted(cost_missing.values(), key=lambda item: item["skuCode"])
        ],
    }
    return {
        "year": year,
        "month": month,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "template": serialize_template(template),
        "fields": enabled_fields,
        "rules": rules,
        "summary": summary,
        "rows": rows,
    }


def _as_excel_value(key: str, raw: Any) -> Any:
    if raw in (None, ""):
        return ""
    field_type = FIELD_REGISTRY.get(key, {}).get("type")
    if field_type in {"money", "number"}:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return raw
    return raw


def to_xlsx(report: dict[str, Any]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "销售汇总"
    fields = report.get("fields", [])
    ws.append([field["label"] for field in fields])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in report.get("rows", []):
        ws.append([_as_excel_value(field["key"], row.get(field["key"])) for field in fields])

    # 合计行：只对数值列累加，其余留空；仓库列显示「合计」。
    summary = report.get("summary", {})
    sum_by_key = {
        "total_quantity": summary.get("totalQuantity"),
        "total_sales": summary.get("salesAmount"),
        "total_cost": summary.get("costAmount"),
    }
    total_row = [""] * len(fields)
    for index, field in enumerate(fields):
        if field["key"] == "warehouse":
            total_row[index] = "合计"
        elif field["key"] in sum_by_key and sum_by_key[field["key"]] is not None:
            total_row[index] = float(sum_by_key[field["key"]])
    ws.append(total_row)
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)

    for idx, field in enumerate(fields, start=1):
        field_type = FIELD_REGISTRY.get(field["key"], {}).get("type")
        if field_type == "money":
            for row_idx in range(2, ws.max_row + 1):
                ws.cell(row=row_idx, column=idx).number_format = "0.00"
        max_len = max(
            len(str(ws.cell(row=r, column=idx).value or ""))
            for r in range(1, min(ws.max_row, 200) + 1)
        )
        ws.column_dimensions[get_column_letter(idx)].width = min(max(max_len + 2, 10), 28)
    ws.freeze_panes = "A2"

    output = BytesIO()
    wb.save(output)
    return output.getvalue()


def generated_filename(year: int, month: int) -> str:
    return f"销售汇总_{year}{month:02d}.xlsx"


def _tax_name_map(db: Session) -> dict[str, str]:
    """税务编号 → 税收分类名称。

    名称取自「税务做账 → 分类规则」中用户维护的 category_name / item_name
    （如 软饮料 · 咖啡），仅用已启用规则，不编造；同一编码取优先级最高的一条。
    """
    from app.models.tax import TaxAccountingCategoryRule

    names: dict[str, str] = {}
    rows = (
        db.query(TaxAccountingCategoryRule)
        .filter(TaxAccountingCategoryRule.enabled.is_(True))
        .order_by(TaxAccountingCategoryRule.priority, TaxAccountingCategoryRule.id)
        .all()
    )
    for row in rows:
        code = (row.tax_code or "").strip()
        if not code or code in names:
            continue
        parts: list[str] = []
        category = (row.category_name or "").strip()
        item = (row.item_name or "").strip()
        if category and category != "全部":
            parts.append(category)
        if item and item != "全部" and item != category:
            parts.append(item)
        if parts:
            names[code] = " · ".join(parts)
    return names


def _order_group_sales(db: Session, order_ids: list[int]) -> dict[int, dict[tuple[str, str], Decimal]]:
    """订单 → (税务编号, 产品) 组销售额；分组口径与 _unbilled_detail_rows 完全一致。

    每组金额 = 订单客户实付金额按明细行成本占比分摊（与总览/月结收入口径一致），
    不再使用与实付对不上的吉客云行金额。
    """
    from app.models.catalog import Product

    result: dict[int, dict[tuple[str, str], Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    if not order_ids:
        return result
    items = (
        db.query(SalesOrderItem)
        .filter(SalesOrderItem.order_id.in_(order_ids))
        .all()
    )
    sku_codes = {item.sku_code for item in items if item.sku_code}
    sku_info: dict[str, dict[str, Any]] = {}
    if sku_codes:
        for sku, goods_name in (
            db.query(ProductSku, Product.goods_name)
            .outerjoin(Product, Product.id == ProductSku.product_id)
            .filter(ProductSku.sku_code.in_(sku_codes))
            .all()
        ):
            sku_info[sku.sku_code] = {
                "id": sku.id,
                "tax_code": (sku.tax_code or "").strip(),
                "product": (sku.sku_name or goods_name or sku.sku_code).strip(),
            }
    inbound_costs = weighted_inbound_costs(
        db,
        as_of=datetime.now(timezone.utc),
        sku_ids={int(info["id"]) for info in sku_info.values()},
    )
    paid_by_order = {
        order_id: _money(paid)
        for order_id, paid in db.query(SalesOrder.id, SalesOrder.paid_amount)
        .filter(SalesOrder.id.in_(order_ids))
        .all()
    }
    rows_by_order: dict[int, list[SalesOrderItem]] = defaultdict(list)
    for item in items:
        rows_by_order[item.order_id].append(item)
    for order_id, order_items in rows_by_order.items():
        weight_rows: list[tuple[SalesOrderItem, Decimal | None]] = []
        for item in order_items:
            info = sku_info.get(item.sku_code or "")
            weight_rows.append((item, inbound_costs.get(int(info["id"])) if info else None))
        shares = _order_paid_shares(paid_by_order.get(order_id, Decimal("0")), weight_rows)
        for item, share in zip(order_items, shares):
            info = sku_info.get(item.sku_code or "")
            tax_code = (info or {}).get("tax_code", "")
            product = (info or {}).get("product") or (item.sku_code or "未匹配货品档案")
            result[order_id][(tax_code, product)] += share
    return result


def _remaining_invoice_amount(total: Decimal, links) -> Decimal:
    """整张发票扣除已显式分摊金额后，剩余可供空分摊关联自动分配的金额。"""
    explicitly_allocated = sum(
        (to_decimal(link.allocated_amount) for link in links if link.allocated_amount is not None),
        Decimal("0"),
    )
    return total - explicitly_allocated


def _output_invoiced_by_group(db: Session, start, nxt) -> dict[tuple[str, str], Decimal]:
    """当月销项发票落到 (税务编号, 产品) 组的已开票金额。

    - 发票口径与 build_unbilled_income_report 完全一致：
      tax_export / direction=output / status in (issued, red)，开票日期在月内；
    - 优先按已确认关联（TaxInvoiceLink.target_type="sales_order", confirmed=True）的
      allocated_amount 归集；同发票未带 allocated_amount 的关联，按所连订单销售额占比
      从发票价税合计分摊（整张发票都无 allocated_amount 时同理）；
    - 订单内再按明细行成本占比把订单实付金额落到 (税务编号, 产品) 组。
    """
    from app.models.tax import TaxInvoice, TaxInvoiceLink

    invoices = (
        db.query(TaxInvoice)
        .filter(
            TaxInvoice.source_system == "tax_export",
            TaxInvoice.direction == "output",
            TaxInvoice.status.in_(("issued", "red")),
            TaxInvoice.issue_date >= start,
            TaxInvoice.issue_date < nxt,
        )
        .all()
    )
    invoice_ids = [row.id for row in invoices]
    if not invoice_ids:
        return {}
    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.invoice_id.in_(invoice_ids),
            TaxInvoiceLink.target_type == "sales_order",
            TaxInvoiceLink.confirmed.is_(True),
        )
        .all()
    )
    links_by_invoice: dict[int, list[TaxInvoiceLink]] = defaultdict(list)
    order_ids: set[int] = set()
    for link in links:
        links_by_invoice[link.invoice_id].append(link)
        order_ids.add(int(link.target_id))
    group_sales_by_order = _order_group_sales(db, sorted(order_ids))
    order_sales = {
        order_id: sum(groups.values(), Decimal("0"))
        for order_id, groups in group_sales_by_order.items()
    }

    attributed: dict[tuple[str, str], Decimal] = defaultdict(Decimal)

    def _attribute(order_id: int, amount: Decimal) -> None:
        groups = group_sales_by_order.get(order_id) or {}
        total_sales = order_sales.get(order_id, Decimal("0"))
        if not groups or total_sales <= 0:
            return
        for key, sales in groups.items():
            attributed[key] += amount * sales / total_sales

    for invoice in invoices:
        invoice_links = links_by_invoice.get(invoice.id) or []
        if not invoice_links:
            continue
        total = to_decimal(invoice.total_amount)
        without_alloc = [ln for ln in invoice_links if ln.allocated_amount is None]
        remaining = _remaining_invoice_amount(total, invoice_links)
        for link in invoice_links:
            if link.allocated_amount is not None:
                _attribute(int(link.target_id), to_decimal(link.allocated_amount))
        if not without_alloc:
            continue
        # 只把剩余未分摊金额分给 allocated_amount 为空的订单，避免重复计算。
        denom = sum(
            (order_sales.get(int(ln.target_id), Decimal("0")) for ln in without_alloc),
            Decimal("0"),
        )
        if denom <= 0:
            continue
        for link in without_alloc:
            sales = order_sales.get(int(link.target_id), Decimal("0"))
            if sales > 0:
                _attribute(int(link.target_id), remaining * sales / denom)
    return dict(attributed)


def _unbilled_detail_rows(db: Session, year: int, month: int) -> list[dict[str, Any]]:
    """无票收入明细：按 税务编号 + 产品 聚合当月有效销售（与销售汇总同口径）。

    - 税务编号/产品/成本取自货品档案（ProductSku + Product.goods_name）；
    - 档案缺失的行保留 sku_code，税务编号显示空值，不编造；
    - 销售金额取订单客户实付并按明细成本/数量权重分摊，成本取采购入库加权成本；
    - invoiced = 当月销项发票按已确认关联分摊到该组的已开票金额；
      unbilled = max(sales − invoiced, 0)，超开的负差如实保留为 0。
    """
    from app.models.catalog import Product

    start, nxt = month_bounds(year, month)
    invoiced_by_group = _output_invoiced_by_group(db, start, nxt)
    orders = (
        db.query(SalesOrder)
        .filter(_valid_order_condition())
        .filter(SalesOrder.ordered_at >= start, SalesOrder.ordered_at < nxt)
        .all()
    )
    order_ids = [o.id for o in orders]
    items_by_order: dict[int, list[SalesOrderItem]] = defaultdict(list)
    sku_codes: set[str] = set()
    if order_ids:
        for item in (
            db.query(SalesOrderItem)
            .filter(SalesOrderItem.order_id.in_(order_ids))
            .all()
        ):
            items_by_order[item.order_id].append(item)
            if item.sku_code:
                sku_codes.add(item.sku_code)

    sku_info: dict[str, dict[str, Any]] = {}
    if sku_codes:
        for sku, goods_name, goods_category in (
            db.query(ProductSku, Product.goods_name, Product.category)
            .outerjoin(Product, Product.id == ProductSku.product_id)
            .filter(ProductSku.sku_code.in_(sku_codes))
            .all()
        ):
            sku_info[sku.sku_code] = {
                "id": sku.id,
                "tax_code": (sku.tax_code or "").strip(),
                "product": (sku.sku_name or goods_name or sku.sku_code).strip(),
                "category": (goods_category or "").strip(),
            }
    inbound_costs = weighted_inbound_costs(
        db,
        as_of=month_bounds(year, month)[1],
        sku_ids={int(info["id"]) for info in sku_info.values()},
    )

    tax_names = _tax_name_map(db)
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for order in orders:
        order_items = items_by_order.get(order.id) or []
        weight_rows: list[tuple[SalesOrderItem, Decimal | None]] = []
        for item in order_items:
            info = sku_info.get(item.sku_code or "")
            weight_rows.append(
                (item, inbound_costs.get(int(info["id"])) if info else None)
            )
        # 销售额 = 订单客户实付金额按明细行成本占比分摊（与总览/月结口径一致）
        shares = _order_paid_shares(_money(order.paid_amount), weight_rows)
        for item, share in zip(order_items, shares):
            info = sku_info.get(item.sku_code or "")
            tax_code = (info or {}).get("tax_code", "")
            product = (info or {}).get("product") or (item.sku_code or "未匹配货品档案")
            # 税收分类名称：优先分类规则（用户维护），无规则时兜底用货品档案品类。
            tax_name = tax_names.get(tax_code, "") or (info or {}).get("category", "")
            quantity = _money(item.quantity)
            cost = Decimal("0")
            if info:
                info_cost = inbound_costs.get(int(info["id"]))
                if info_cost is not None:
                    cost = quantity * info_cost
            agg = groups.setdefault(
                (tax_code, product),
                {"quantity": Decimal("0"), "sales": Decimal("0"), "cost": Decimal("0"), "tax_name": tax_name},
            )
            agg["quantity"] += quantity
            agg["sales"] += share
            agg["cost"] += cost

    rows: list[dict[str, Any]] = []
    for (tax_code, product), agg in sorted(groups.items(), key=lambda kv: kv[1]["sales"], reverse=True):
        invoiced = invoiced_by_group.get((tax_code, product), Decimal("0"))
        rows.append({
            "period": f"{year}-{month:02d}",
            "taxCode": tax_code,
            "taxName": agg["tax_name"],
            "product": product,
            "quantity": str(agg["quantity"]),
            "sales": _string_decimal(agg["sales"]),
            "invoiced": _string_decimal(invoiced),
            "unbilled": _string_decimal(max(agg["sales"] - invoiced, Decimal("0"))),
            "cost": _string_decimal(agg["cost"]),
        })
    return rows


def _latest_unbilled_adjustment(
    db: Session,
    *,
    company: str,
    year: int,
    month: int,
) -> FinanceUnbilledAdjustment | None:
    return (
        db.query(FinanceUnbilledAdjustment)
        .filter_by(company=company, period_year=year, period_month=month)
        .order_by(FinanceUnbilledAdjustment.version.desc())
        .first()
    )


def _unbilled_details_for_period(
    db: Session,
    *,
    company: str,
    year: int,
    month: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], FinanceUnbilledAdjustment | None]:
    """返回原始明细、当前明细和当前选择键；历史版本永远不改写。"""
    source_details = _unbilled_detail_rows(db, year, month)
    adjustment = _latest_unbilled_adjustment(db, company=company, year=year, month=month)
    source_keys = [unbilled_detail_key(row) for row in source_details]
    if adjustment is None:
        return source_details, source_details, source_keys, None

    selected_set = {str(key) for key in (adjustment.selected_keys or [])}
    selected_details = [row for row in source_details if unbilled_detail_key(row) in selected_set]
    current_keys = [unbilled_detail_key(row) for row in selected_details]
    return source_details, selected_details, current_keys, adjustment


def _latest_sales_summary_version(db: Session, *, company: str, year: int, month: int) -> int:
    value = (
        db.query(func.max(ArchiveFile.version))
        .filter_by(company=company, period_year=year, period_month=month, category="sales_summary")
        .scalar()
    )
    return int(value or 0)


def save_unbilled_adjustment(
    db: Session,
    *,
    company: str,
    year: int,
    month: int,
    selected_keys: list[str],
    actor: str = "system",
    note: str = "",
) -> dict[str, Any]:
    """保存本月保留的无票收入明细，并以新版本记录调整。"""
    if not 1 <= month <= 12:
        raise ValueError("非法月份")
    source_details = _unbilled_detail_rows(db, year, month)
    available = {unbilled_detail_key(row) for row in source_details}
    normalized = list(dict.fromkeys(str(key).strip() for key in selected_keys if str(key).strip()))
    unknown = [key for key in normalized if key not in available]
    if unknown:
        raise ValueError("明细已发生变化，请刷新后重新选择")
    if source_details and not normalized:
        raise ValueError("至少保留一条明细")

    previous = (
        db.query(func.max(FinanceUnbilledAdjustment.version))
        .filter_by(company=company, period_year=year, period_month=month)
        .scalar()
    )
    version = max(int(previous or 0), _latest_sales_summary_version(db, company=company, year=year, month=month)) + 1
    row = FinanceUnbilledAdjustment(
        company=company,
        period_year=year,
        period_month=month,
        version=version,
        selected_keys=normalized,
        actor=(actor or "system")[:64],
        note=(note or "")[:500],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    audit(
        db,
        actor,
        "finance.unbilled.adjustment",
        "finance_unbilled_adjustments",
        row.id,
        {"company": company, "year": year, "month": month, "version": version, "selectedCount": len(normalized)},
    )
    return {
        "id": row.id,
        "version": row.version,
        "selectedKeys": normalized,
        "selectedCount": len(normalized),
        "sourceCount": len(source_details),
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def build_unbilled_income_report(
    db: Session,
    year: int,
    month: int,
    company: str = finance_service.DEFAULT_COMPANY,
) -> dict[str, Any]:
    """无票收入 = 销售总金额 − 已开票金额（销项价税合计，含红字冲减）。

    - 销售总金额复用 build_report 的 summary.salesAmount（与发给财务的销售汇总同口径）。
    - 已开票金额直接汇总官方销项发票（tax_export，direction=output，issued/red）的
      价税合计，不依赖发票分类规则（分类缺失不应影响无票收入）。
    - 缺失发票导入时已开票金额为 0，无票收入等于销售总金额，不臆造。
    """
    from app.models.tax import TaxInvoice
    from app.services.monthly_core import month_bounds

    sales = build_report(db, year, month, get_or_create_template(db, company))
    start, nxt = month_bounds(year, month)
    invoiced_total = (
        db.query(func.coalesce(func.sum(TaxInvoice.total_amount), 0))
        .filter(
            TaxInvoice.source_system == "tax_export",
            TaxInvoice.direction == "output",
            TaxInvoice.status.in_(("issued", "red")),
            TaxInvoice.issue_date >= start,
            TaxInvoice.issue_date < nxt,
        )
        .scalar()
    )
    invoiced_total = Decimal(invoiced_total or "0")
    sales_total = Decimal(sales["summary"]["salesAmount"] or "0")
    unbilled = sales_total - invoiced_total
    source_details, details, selected_keys, adjustment = _unbilled_details_for_period(
        db, company=company, year=year, month=month,
    )
    version = adjustment.version if adjustment is not None else _latest_sales_summary_version(
        db, company=company, year=year, month=month,
    )
    row_invoiced_total = sum((Decimal(d.get("invoiced") or "0") for d in details), Decimal("0"))
    unattributed = invoiced_total - row_invoiced_total
    if unattributed < 0:
        unattributed = Decimal("0")
    return {
        "period": f"{year}-{month:02d}",
        "year": year,
        "month": month,
        "salesAmount": _string_decimal(sales_total),
        "invoicedAmount": _string_decimal(invoiced_total),
        "unbilledAmount": _string_decimal(unbilled),
        "rowInvoicedTotal": _string_decimal(row_invoiced_total),
        "unattributedInvoiced": _string_decimal(unattributed),
        "version": version or None,
        "adjusted": adjustment is not None,
        "selectedKeys": selected_keys,
        "sourceCount": len(source_details),
        "selectedCount": len(details),
        "updatedAt": adjustment.updated_at.isoformat() if adjustment and adjustment.updated_at else None,
        "details": details,
    }


def unbilled_income_xlsx(report: dict[str, Any]) -> bytes:
    """无票收入表：上半部分汇总（销售总额 − 已开票 = 无票收入），下半部分为
    「税务编号 + 产品」明细（月度时间/税务编号/税收分类名称/产品/发货数量/销售金额/
    已开票金额/无票收入/销售成本 + 合计）。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "无票收入"
    head = Font(bold=True, size=13)
    bold = Font(bold=True)
    gray = Font(size=9, color="999999")

    ws["A1"] = f"{report['year']}年{report['month']:02d}月销售出库-无票收入"
    ws["A1"].font = head
    summary_rows = [
        ("月度时间", report["period"], None),
        ("销售总金额", float(report["salesAmount"]), "0.00"),
        ("已开票金额", float(report["invoicedAmount"]), "0.00"),
        ("无票收入", float(report["unbilledAmount"]), "0.00"),
    ]
    for label, value, fmt in summary_rows:
        ws.append([label, value])
        ws.cell(row=ws.max_row, column=1).font = bold
        if fmt:
            ws.cell(row=ws.max_row, column=2).number_format = fmt
    ws.append(["口径：无票收入 = 销售总金额 − 已开票金额（销项发票价税合计）"])
    ws.cell(row=ws.max_row, column=1).font = gray
    ws.append([])

    details = report.get("details") or []
    ws.append(["月度时间", "税务编号", "税收分类名称", "产品", "发货数量", "销售金额", "已开票金额", "无票收入", "销售成本"])

    header_row = ws.max_row
    for cell in ws[header_row]:
        cell.font = bold
    totals = {"quantity": 0.0, "sales": 0.0, "invoiced": 0.0, "unbilled": 0.0, "cost": 0.0}
    for d in details:
        quantity, sales, cost = float(d["quantity"]), float(d["sales"]), float(d["cost"])
        invoiced = float(d.get("invoiced") or 0)
        unbilled = float(d.get("unbilled") or 0)
        totals["quantity"] += quantity
        totals["sales"] += sales
        totals["invoiced"] += invoiced
        totals["unbilled"] += unbilled
        totals["cost"] += cost
        ws.append([d["period"], d["taxCode"], d.get("taxName", ""), d["product"], quantity, sales, invoiced, unbilled, cost])
    ws.append(["", "", "", "合计", totals["quantity"], totals["sales"], totals["invoiced"], totals["unbilled"], totals["cost"]])
    for cell in ws[ws.max_row]:
        cell.font = bold
    for col in (5, 6, 7, 8, 9):
        for row_idx in range(header_row, ws.max_row + 1):
            ws.cell(row=row_idx, column=col).number_format = "0.00" if col != 5 else "0.####"

    for idx, width in ((1, 14), (2, 26), (3, 18), (4, 34), (5, 12), (6, 14), (7, 14), (8, 14), (9, 14)):
        ws.column_dimensions[get_column_letter(idx)].width = width
    ws.freeze_panes = f"A{header_row + 1}"

    output = BytesIO()
    wb.save(output)
    return output.getvalue()


def has_generated_report(db: Session, company: str, year: int, month: int) -> bool:
    return (
        db.query(ArchiveFile.id)
        .filter_by(
            company=company,
            period_year=year,
            period_month=month,
            category="sales_summary",
            original_name=generated_filename(year, month),
        )
        .first()
        is not None
    )


def generate_and_archive(
    db: Session,
    *,
    company: str,
    year: int,
    month: int,
    actor: str = "system",
    skip_if_exists: bool = False,
) -> dict[str, Any]:
    template = get_or_create_template(db, company)
    if not template.enabled:
        return {"status": "skipped", "reason": "template_disabled"}
    if skip_if_exists and has_generated_report(db, company, year, month):
        return {"status": "exists", "period": f"{year}-{month:02d}"}
    report = build_report(db, year, month, template)
    content = to_xlsx(report)
    archive = finance_service.store_upload(
        db,
        company=company,
        year=year,
        month=month,
        category="sales_summary",
        original_name=generated_filename(year, month),
        content=content,
        actor=actor,
    )
    return {
        "status": "ok",
        "period": f"{year}-{month:02d}",
        "archiveFileId": archive.id,
        "version": archive.version,
        "summary": report["summary"],
    }
