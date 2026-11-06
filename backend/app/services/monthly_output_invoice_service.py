"""月结商品销项净额：按开票月/销方主体汇总，不依赖销售订单关联。"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.utils.money import quantize, to_decimal


def classify_output_line(tax_code: str, goods_name: str, rules: list[Any] | None = None) -> str:
    """以已有税收分类编码/官方项目名确定性识别；不确定的留空供人工核验。"""
    code = str(tax_code or "").strip()
    name = str(goods_name or "").strip()
    rule = next((row for row in (rules or []) if code and row.tax_code == code), None)
    if rule is not None:
        name += f" {rule.category_name} {rule.item_name}"
    if "服务费" in name or ("平台" in name and "服务" in name):
        return "platform_service"
    if code.startswith("1") and code.isdigit():
        return "buyer_sales"
    if "咖啡" in name and "服务" not in name:
        return "buyer_sales"
    return ""


def monthly_output_invoice_summary(db: Session, start, end, company: str) -> dict[str, Any]:
    """只抵扣当月有效商品销项发票；服务费、进项、未识别、其他主体不得抵扣。"""
    from app.models.finance import FinanceLegalEntity
    from app.models.tax import TaxAccountingCategoryRule, TaxInvoice
    from app.services import tax_invoice_service

    entity = db.query(FinanceLegalEntity).filter(FinanceLegalEntity.name == company).first()
    tax_id = str(entity.tax_id or "").strip() if entity else ""
    rules = (
        db.query(TaxAccountingCategoryRule)
        .filter(TaxAccountingCategoryRule.enabled.is_(True))
        .order_by(TaxAccountingCategoryRule.priority, TaxAccountingCategoryRule.id)
        .all()
    )
    invoices = (
        tax_invoice_service.filter_visible_invoices(db.query(TaxInvoice))
        .filter(
            TaxInvoice.source_system == "tax_export",
            TaxInvoice.direction == "output",
            TaxInvoice.status.in_(("issued", "red")),
            TaxInvoice.issue_date >= start,
            TaxInvoice.issue_date < end,
        )
        .all()
    )
    context = tax_invoice_service.red_accounting_context(db, invoices)
    invoiced, service_fee, unclassified = Decimal("0"), Decimal("0"), Decimal("0")
    pending_count = 0
    for inv in invoices:
        seller_tax = str(inv.seller_tax_id or "").strip()
        seller_name = str(inv.seller_name or "").strip()
        if tax_id and seller_tax:
            if seller_tax != tax_id:
                continue
        elif seller_name != company:
            continue
        red = context.get(inv.id, {})
        if not red.get("accountingNetIncluded", False):
            continue
        net = to_decimal(red.get("accountingNetAmount") or 0)
        if not net:
            continue

        category = str(inv.category or "").strip()
        raw = inv.raw if isinstance(inv.raw, dict) else {}
        lines = raw.get("_taxSummaryLines") or []
        # 红票未带明细时，仅继承已确认关联蓝票的类别/项目比例。
        if inv.status == "red" and not category and not lines:
            blue_id = red.get("redRelatedInvoiceId")
            if blue_id:
                blue = db.get(TaxInvoice, int(blue_id))
                if blue is not None:
                    category = str(blue.category or "").strip()
                    blue_raw = blue.raw if isinstance(blue.raw, dict) else {}
                    lines = blue_raw.get("_taxSummaryLines") or []
        if category == "buyer_sales":
            invoiced += net
            continue
        if category == "platform_service":
            service_fee += net
            continue
        if not isinstance(lines, list) or not lines:
            pending_count += 1
            unclassified += abs(net)
            continue

        total = goods = fees = unknown = Decimal("0")
        for line in lines:
            if not isinstance(line, dict):
                continue
            weight = abs(to_decimal(line.get("totalAmount") or 0))
            if weight <= 0:
                continue
            kind = classify_output_line(line.get("taxCode") or "", line.get("goodsName") or "", rules)
            total += weight
            if kind == "buyer_sales":
                goods += weight
            elif kind == "platform_service":
                fees += weight
            else:
                unknown += weight
        if total <= 0:
            pending_count += 1
            unclassified += abs(net)
            continue
        invoiced += net * goods / total
        service_fee += net * fees / total
        if unknown:
            pending_count += 1
            unclassified += abs(net) * unknown / total
    return {
        "invoiced": quantize(invoiced),
        "service": quantize(service_fee),
        "pendingCount": pending_count,
        "pendingAmount": quantize(unclassified),
    }
