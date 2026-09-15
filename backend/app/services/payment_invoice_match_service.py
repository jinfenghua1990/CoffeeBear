"""付款↔发票匹配标记清单（财务月度资料）。

- 银行付款（bank_transactions.direction="out"）↔ 对方开来的进项发票（tax_invoices.direction="input"）
- 关联复用 tax_invoice_links（target_type="bank_transaction"），手工标记才落库；
  同名同金额只做"建议"展示（纯推导），不自动写库——遵循税务清单 _auto_link
  "只按明确依据关联"的先例。
- match_status 是跨业务共用的单字段：银行视角的已配/未配一律从 TaxInvoiceLink
  推导展示；写 match_status 仅在原值为 unmatched 时进行，且不清空已有 match_note。
"""
from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.audit import audit
from app.models.bank import BankTransaction
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.utils.money import quantize, to_decimal

TARGET_TYPE = "bank_transaction"
TOLERANCE = Decimal("0.01")
MONEY_QUANT = Decimal("0.01")


def _month_range(year: int, month: int) -> tuple[date, date]:
    if not (1 <= month <= 12):
        raise ValueError("非法账期")
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def _dec(value: Decimal | None) -> Decimal:
    return quantize(value, MONEY_QUANT) if value is not None else Decimal("0.0000")


def _link_amount(link: TaxInvoiceLink, invoice: TaxInvoice | None) -> Decimal:
    if link.allocated_amount is not None:
        return _dec(link.allocated_amount)
    if invoice is not None and invoice.total_amount is not None:
        return _dec(invoice.total_amount)
    return Decimal("0.0000")


def _invoice_brief(invoice: TaxInvoice, link: TaxInvoiceLink | None = None) -> dict[str, Any]:
    return {
        "linkId": link.id if link else None,
        "invoiceId": invoice.id,
        "invoiceNumber": invoice.invoice_number,
        "sellerName": invoice.seller_name,
        "issueDate": invoice.issue_date.isoformat()[:10] if invoice.issue_date else "",
        "totalAmount": str(_dec(invoice.total_amount)),
        "allocatedAmount": str(_dec(link.allocated_amount)) if link and link.allocated_amount is not None else None,
    }


def _status(remaining: Decimal, amount: Decimal) -> str:
    if remaining <= TOLERANCE:
        return "matched"
    if remaining < _dec(amount):
        return "partial"
    return "unmatched"


def overview(db: Session, year: int, month: int) -> dict[str, Any]:
    """当月银行付款清单 + 已挂发票 + 当月进项发票池 + 汇总（推导，不落库）。"""
    start, end = _month_range(year, month)

    txns = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.txn_date >= start,
            BankTransaction.txn_date <= end,
            BankTransaction.direction == "out",
        )
        .order_by(BankTransaction.txn_date, BankTransaction.id)
        .all()
    )
    txn_ids = [txn.id for txn in txns]

    links: list[TaxInvoiceLink] = []
    if txn_ids:
        links = (
            db.query(TaxInvoiceLink)
            .filter(
                TaxInvoiceLink.target_type == TARGET_TYPE,
                TaxInvoiceLink.target_id.in_(txn_ids),
                TaxInvoiceLink.match_method != "rejected",
            )
            .all()
        )
    invoice_ids = {link.invoice_id for link in links}
    invoices = (
        db.query(TaxInvoice).filter(TaxInvoice.id.in_(invoice_ids)).all()
        if invoice_ids
        else []
    )
    invoice_map = {row.id: row for row in invoices}
    links_by_txn: dict[int, list[TaxInvoiceLink]] = {}
    for link in links:
        links_by_txn.setdefault(link.target_id, []).append(link)

    payments: list[dict[str, Any]] = []
    matched_total = Decimal("0.0000")
    payment_total = Decimal("0.0000")
    counts = {"matched": 0, "partial": 0, "unmatched": 0}
    for txn in txns:
        amount = _dec(txn.amount)
        payment_total += amount
        txn_links = sorted(links_by_txn.get(txn.id, []), key=lambda row: row.id)
        briefs: list[dict[str, Any]] = []
        matched_amount = Decimal("0.0000")
        for link in txn_links:
            invoice = invoice_map.get(link.invoice_id)
            if invoice is None:
                continue
            matched_amount += _link_amount(link, invoice)
            briefs.append(_invoice_brief(invoice, link))
        matched_amount = min(matched_amount, amount) if amount else matched_amount
        remaining = amount - matched_amount
        status = _status(remaining, amount)
        counts[status] += 1
        matched_total += matched_amount
        payments.append({
            "id": txn.id,
            "txnDate": txn.txn_date.isoformat(),
            "counterpartyName": txn.counterparty_name or "",
            "amount": str(amount),
            "voucherNo": txn.voucher_no or "",
            "summary": txn.summary or "",
            "invoices": briefs,
            "matchedAmount": str(_dec(matched_amount)),
            "remaining": str(_dec(remaining)),
            "status": status,
            "suggestedInvoiceIds": [],
        })

    # 当月进项发票池：只统计 bank_transaction 链接口径，不与采购 FIFO 混算
    pool_rows = (
        db.query(TaxInvoice)
        .filter(
            TaxInvoice.direction == "input",
            TaxInvoice.issue_date >= start,
            TaxInvoice.issue_date <= end,
        )
        .order_by(TaxInvoice.issue_date, TaxInvoice.id)
        .all()
    )
    pool_ids = [row.id for row in pool_rows]
    pool_links: list[TaxInvoiceLink] = []
    if pool_ids:
        pool_links = (
            db.query(TaxInvoiceLink)
            .filter(
                TaxInvoiceLink.target_type == TARGET_TYPE,
                TaxInvoiceLink.invoice_id.in_(pool_ids),
                TaxInvoiceLink.match_method != "rejected",
            )
            .all()
        )
    pool_txn_ids = {link.target_id for link in pool_links}
    pool_link_txns = (
        db.query(BankTransaction).filter(BankTransaction.id.in_(pool_txn_ids)).all()
        if pool_txn_ids
        else []
    )
    pool_txn_map = {row.id: row for row in pool_link_txns}
    linked_by_invoice: dict[int, list[TaxInvoiceLink]] = {}
    for link in pool_links:
        linked_by_invoice.setdefault(link.invoice_id, []).append(link)

    invoice_pool: list[dict[str, Any]] = []
    pool_by_id: dict[int, dict[str, Any]] = {}
    for invoice in pool_rows:
        total = _dec(invoice.total_amount)
        linked_amount = Decimal("0.0000")
        briefs: list[dict[str, Any]] = []
        for link in sorted(linked_by_invoice.get(invoice.id, []), key=lambda row: row.id):
            linked_amount += _link_amount(link, invoice)
            txn = pool_txn_map.get(link.target_id)
            briefs.append({
                **_invoice_brief(invoice, link),
                "txnDate": txn.txn_date.isoformat() if txn else "",
                "counterpartyName": txn.counterparty_name if txn else "",
            })
        remaining = total - linked_amount
        row = {
            "id": invoice.id,
            "invoiceNumber": invoice.invoice_number,
            "sellerName": invoice.seller_name,
            "issueDate": invoice.issue_date.isoformat()[:10] if invoice.issue_date else "",
            "totalAmount": str(total),
            "bankLinkedAmount": str(_dec(linked_amount)),
            "remaining": str(_dec(remaining)),
            "matchStatus": invoice.match_status,
            "links": briefs,
            "suggested": False,
        }
        invoice_pool.append(row)
        pool_by_id[invoice.id] = row

    # 建议：对方户名 == 销方名 且 发票价税合计 == 付款剩余金额（同名同金额，够明确）
    for payment in payments:
        remaining = to_decimal(payment["remaining"]) or Decimal("0.0000")
        if remaining <= TOLERANCE:
            continue
        for row in invoice_pool:
            if row["suggested"]:
                continue
            if row["remaining"] == payment["remaining"] and row["sellerName"] and row["sellerName"] == payment["counterpartyName"]:
                row["suggested"] = True
                payment["suggestedInvoiceIds"].append(row["id"])

    return {
        "year": year,
        "month": month,
        "payments": payments,
        "invoicePool": invoice_pool,
        "summary": {
            "paymentTotal": str(_dec(payment_total)),
            "matchedTotal": str(_dec(matched_total)),
            "unmatchedTotal": str(_dec(payment_total - matched_total)),
            "txnCount": len(payments),
            "matchedCount": counts["matched"],
            "partialCount": counts["partial"],
            "unmatchedCount": counts["unmatched"],
        },
    }


def link(
    db: Session,
    *,
    txn_id: int,
    invoice_id: int,
    allocated_amount: Decimal | str | None = None,
    note: str = "",
    actor: str = "system",
) -> dict[str, Any]:
    """手工标记：把一笔银行付款挂到一张进项发票（存在即复活软删行）。"""
    txn = db.get(BankTransaction, txn_id)
    if txn is None:
        raise ValueError("银行流水不存在")
    if txn.direction != "out":
        raise ValueError("只能对支出流水标记发票")
    invoice = db.get(TaxInvoice, invoice_id)
    if invoice is None:
        raise ValueError("发票不存在")
    if invoice.direction != "input":
        raise ValueError("只能挂进项发票")

    amount = _dec(to_decimal(allocated_amount) if allocated_amount is not None else invoice.total_amount)
    link = (
        db.query(TaxInvoiceLink)
        .filter_by(invoice_id=invoice.id, target_type=TARGET_TYPE, target_id=txn.id)
        .first()
    )
    if link is None:
        link = TaxInvoiceLink(invoice_id=invoice.id, target_type=TARGET_TYPE, target_id=txn.id)
        db.add(link)
    link.allocated_amount = amount
    link.match_method = "manual"
    link.confidence = Decimal("1")
    link.confirmed = True
    link.note = note or "付款发票匹配清单手工标记"

    if invoice.match_status == "unmatched":
        invoice.match_status = "matched"
        msg = f"已匹配银行付款 {txn.txn_date.isoformat()} {_dec(txn.amount)}"
        invoice.match_note = f"{invoice.match_note}；{msg}" if invoice.match_note else msg

    db.commit()
    audit(
        db, actor, "payment_invoice_match.link", "tax_invoice_links", str(link.id),
        {"txnId": txn.id, "invoiceId": invoice.id, "allocatedAmount": str(amount)},
    )
    return {"ok": True, "id": link.id, "invoiceId": invoice.id, "txnId": txn.id}


def unlink(db: Session, link_id: int, actor: str = "system") -> dict[str, Any]:
    """解除标记（软删 match_method=rejected，保审计；同对可再次标记=复活）。"""
    row = db.get(TaxInvoiceLink, link_id)
    if row is None or row.target_type != TARGET_TYPE or row.match_method == "rejected":
        raise ValueError("匹配不存在或已解除")
    row.match_method = "rejected"
    row.confirmed = False
    row.confidence = None
    row.note = "解除银行付款匹配"

    invoice = db.get(TaxInvoice, row.invoice_id)
    if invoice is not None:
        others = (
            db.query(TaxInvoiceLink)
            .filter(
                TaxInvoiceLink.invoice_id == row.invoice_id,
                TaxInvoiceLink.target_type == TARGET_TYPE,
                TaxInvoiceLink.match_method != "rejected",
                TaxInvoiceLink.id != row.id,
            )
            .count()
        )
        if others == 0 and invoice.match_status == "matched" and "银行付款" in (invoice.match_note or ""):
            invoice.match_status = "unmatched"

    db.commit()
    audit(
        db, actor, "payment_invoice_match.unlink", "tax_invoice_links", str(row.id),
        {"invoiceId": row.invoice_id, "targetId": row.target_id},
    )
    return {"ok": True}
