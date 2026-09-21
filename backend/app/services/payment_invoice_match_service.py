"""付款↔发票匹配标记清单（财务月度资料）。

- 银行付款（bank_transactions.direction="out"）↔ 对方开来的进项发票（tax_invoices.direction="input"）
- 关联复用 tax_invoice_links（target_type="bank_transaction"），手工标记才落库；
  同名同金额只做"建议"展示（纯推导），不自动写库——遵循税务清单 _auto_link
  "只按明确依据关联"的先例。
- 银行付款核对状态只从 target_type="bank_transaction" 的 TaxInvoiceLink 推导；
  绝不读写 TaxInvoice.match_status / match_note，避免污染采购/销售业务匹配状态。
"""
from __future__ import annotations

import calendar
import re
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.audit import audit
from app.models.bank import BankAccount, BankTransaction
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import tax_invoice_service
from app.services.monthly_core import month_bounds
from app.utils.money import quantize, to_decimal

TARGET_TYPE = "bank_transaction"
TOLERANCE = Decimal("0.01")
MONEY_QUANT = Decimal("0.01")
# 匹配窗口：发票日期 ±3 个月内的流水都视为同一笔交易
MATCH_WINDOW_MONTHS = 3


def _normalize_name(name: str | None) -> str:
    """统一名称：去全/半角括号差异、去所有空白，便于匹配。"""
    if not name:
        return ""
    text = str(name).strip()
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"\s+", "", text)
    return text


def _month_range(year: int, month: int) -> tuple[date, date]:
    if not (1 <= month <= 12):
        raise ValueError("非法账期")
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def _offset_month(year: int, month: int, offset: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + offset
    target_year, zero_based_month = divmod(index, 12)
    return target_year, zero_based_month + 1


def _invoice_candidate_window(year: int, month: int):
    """当前账期银行流水可匹配的发票窗口，统一使用业务时区 [start, end)。"""
    start_year, start_month = _offset_month(year, month, -MATCH_WINDOW_MONTHS)
    end_year, end_month = _offset_month(year, month, MATCH_WINDOW_MONTHS)
    start, _ = month_bounds(start_year, start_month)
    _, end = month_bounds(end_year, end_month)
    return start, end


def _dec(value: Decimal | int | str | None) -> Decimal:
    return quantize(to_decimal(value), MONEY_QUANT)

def _invoice_target_amount(db: Session, invoice: TaxInvoice) -> Decimal:
    """银行付款核对以红冲后的有效蓝字余额为上限，原票金额仍保留在发票台账。"""
    return _dec(tax_invoice_service.effective_invoice_amount_after_red(db, invoice))



def _link_amount(link: TaxInvoiceLink, invoice: TaxInvoice | None) -> Decimal:
    if link.allocated_amount is not None:
        return _dec(link.allocated_amount)
    if invoice is not None and invoice.total_amount is not None:
        return _dec(invoice.total_amount)
    return Decimal("0.0000")


def _active_bank_links(db: Session, *, invoice_id: int | None = None, txn_id: int | None = None,
                       exclude_link_id: int | None = None) -> list[TaxInvoiceLink]:
    q = db.query(TaxInvoiceLink).filter(
        TaxInvoiceLink.target_type == TARGET_TYPE,
        TaxInvoiceLink.match_method != "rejected",
        TaxInvoiceLink.confirmed.is_(True),
    )
    if invoice_id is not None:
        q = q.filter(TaxInvoiceLink.invoice_id == invoice_id)
    if txn_id is not None:
        q = q.filter(TaxInvoiceLink.target_id == txn_id)
    if exclude_link_id is not None:
        q = q.filter(TaxInvoiceLink.id != exclude_link_id)
    return q.all()


def _invoice_bank_allocated(db: Session, invoice_id: int, *, exclude_link_id: int | None = None) -> Decimal:
    links = _active_bank_links(db, invoice_id=invoice_id, exclude_link_id=exclude_link_id)
    invoice = db.get(TaxInvoice, invoice_id)
    return sum(
        (_link_amount(row, invoice) for row in links),
        Decimal("0.0000"),
    )


def _txn_bank_allocated(db: Session, txn_id: int, *, exclude_link_id: int | None = None) -> Decimal:
    links = _active_bank_links(db, txn_id=txn_id, exclude_link_id=exclude_link_id)
    invoice_ids = {row.invoice_id for row in links if row.allocated_amount is None}
    invoice_map = {
        row.id: row
        for row in db.query(TaxInvoice).filter(TaxInvoice.id.in_(invoice_ids)).all()
    } if invoice_ids else {}
    return sum(
        (_link_amount(row, invoice_map.get(row.invoice_id)) for row in links),
        Decimal("0.0000"),
    )


def _invoice_brief(invoice: TaxInvoice, link: TaxInvoiceLink | None = None) -> dict[str, Any]:
    return {
        "linkId": link.id if link else None,
        "invoiceId": invoice.id,
        "invoiceNumber": invoice.invoice_number,
        "sellerName": invoice.seller_name,
        "issueDate": invoice.issue_date.isoformat()[:10] if invoice.issue_date else "",
        "totalAmount": str(_dec(invoice.total_amount)),
        "allocatedAmount": str(_link_amount(link, invoice)) if link else None,
        "legacyAllocatedAmountMissing": bool(link and link.allocated_amount is None),
    }


def _status(remaining: Decimal, amount: Decimal) -> str:
    """按实际已分摊金额判断，不能把“0 元已匹配”因容差误判为 matched。"""
    amount = _dec(amount)
    remaining = _dec(remaining)
    matched_amount = amount - remaining
    if matched_amount <= 0:
        return "unmatched"
    if remaining <= TOLERANCE:
        return "matched"
    return "partial"


def overview(db: Session, year: int, month: int) -> dict[str, Any]:
    """当月银行付款清单 + 已挂发票 + 当月进项发票池 + 汇总（推导，不落库）。"""
    start, end = _month_range(year, month)
    invoice_start, invoice_end = month_bounds(year, month)

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
    account_ids = {txn.account_id for txn in txns if txn.account_id is not None}
    account_map = {
        row.id: row
        for row in db.query(BankAccount).filter(BankAccount.id.in_(account_ids)).all()
    } if account_ids else {}

    links: list[TaxInvoiceLink] = []
    if txn_ids:
        links = (
            db.query(TaxInvoiceLink)
            .filter(
                TaxInvoiceLink.target_type == TARGET_TYPE,
                TaxInvoiceLink.target_id.in_(txn_ids),
                TaxInvoiceLink.confirmed.is_(True),
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
        account = account_map.get(txn.account_id)
        payments.append({
            "id": txn.id,
            "txnDate": txn.txn_date.isoformat(),
            "counterpartyName": txn.counterparty_name or "",
            "counterpartyAccount": txn.counterparty_account or "",
            "amount": str(amount),
            "voucherNo": txn.voucher_no or "",
            "summary": txn.summary or "",
            "accountNo": account.account_no if account else "",
            "accountName": account.account_name if account else "",
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
            TaxInvoice.issue_date >= invoice_start,
            TaxInvoice.issue_date < invoice_end,
        )
        .order_by(TaxInvoice.issue_date, TaxInvoice.id)
        .all()
    )
    # 红冲、作废、待确认和非正数金额发票仍保留在发票/会计模块，
    # 但不能进入“银行付款核对”池，更不能因金额 <= 0 被推导成 matched。
    pool_rows = [row for row in pool_rows if tax_invoice_service.is_bank_payment_reconciliation_eligible(row, db=db)]
    pool_ids = [row.id for row in pool_rows]
    pool_links: list[TaxInvoiceLink] = []
    if pool_ids:
        pool_links = (
            db.query(TaxInvoiceLink)
            .filter(
                TaxInvoiceLink.target_type == TARGET_TYPE,
                TaxInvoiceLink.invoice_id.in_(pool_ids),
                TaxInvoiceLink.confirmed.is_(True),
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
    linked_account_ids = {row.account_id for row in pool_link_txns if row.account_id is not None}
    missing_account_ids = linked_account_ids.difference(account_map)
    if missing_account_ids:
        for account in db.query(BankAccount).filter(BankAccount.id.in_(missing_account_ids)).all():
            account_map[account.id] = account
    linked_by_invoice: dict[int, list[TaxInvoiceLink]] = {}
    for link in pool_links:
        linked_by_invoice.setdefault(link.invoice_id, []).append(link)

    invoice_bank_context = tax_invoice_service._invoice_bank_payment_context(db, pool_rows)
    invoice_pool: list[dict[str, Any]] = []
    pool_by_id: dict[int, dict[str, Any]] = {}
    for invoice in pool_rows:
        total = _invoice_target_amount(db, invoice)
        linked_amount = Decimal("0.0000")
        briefs: list[dict[str, Any]] = []
        for link in sorted(linked_by_invoice.get(invoice.id, []), key=lambda row: row.id):
            linked_amount += _link_amount(link, invoice)
            txn = pool_txn_map.get(link.target_id)
            account = account_map.get(txn.account_id) if txn else None
            briefs.append({
                **_invoice_brief(invoice, link),
                "txnId": txn.id if txn else None,
                "txnDate": txn.txn_date.isoformat() if txn else "",
                "txnAmount": str(_dec(txn.amount)) if txn else "0.00",
                "counterpartyName": txn.counterparty_name if txn else "",
                "counterpartyAccount": txn.counterparty_account if txn else "",
                "voucherNo": txn.voucher_no if txn else "",
                "summary": txn.summary if txn else "",
                "accountNo": account.account_no if account else "",
                "accountName": account.account_name if account else "",
            })
        derived_bank = invoice_bank_context.get(invoice.id, {})
        overpaid = _dec(derived_bank.get("bankOverpaidAmount", max(linked_amount - total, Decimal("0"))))
        overpaid_settled = _dec(derived_bank.get("bankOverpaidSettledAmount"))
        overpaid_unsettled = _dec(derived_bank.get("bankOverpaidUnsettledAmount", overpaid))
        remaining = _dec(derived_bank.get("bankRemainingAmount", max(total - linked_amount, Decimal("0"))))
        bank_status = str(derived_bank.get("bankPaymentStatus") or _status(remaining, total))
        row = {
            "id": invoice.id,
            "invoiceNumber": invoice.invoice_number,
            "sellerName": invoice.seller_name,
            "issueDate": invoice.issue_date.isoformat()[:10] if invoice.issue_date else "",
            "totalAmount": str(total),
            "bankLinkedAmount": str(_dec(linked_amount)),
            "remaining": str(_dec(remaining)),
            "overpaidAfterRedAmount": str(_dec(overpaid)),
            "overpaidSettledAmount": str(_dec(overpaid_settled)),
            "overpaidUnsettledAmount": str(_dec(overpaid_unsettled)),
            "bankMatchStatus": bank_status,
            "links": briefs,
            "suggested": False,
            "suggestedPaymentIds": [],
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
            if row["remaining"] == payment["remaining"] and row["sellerName"] and _normalize_name(row["sellerName"]) == _normalize_name(payment["counterpartyName"]):
                row["suggested"] = True
                row["suggestedPaymentIds"].append(payment["id"])
                payment["suggestedInvoiceIds"].append(row["id"])

    invoice_total = sum((_dec(row["totalAmount"]) for row in invoice_pool), Decimal("0.0000"))
    invoice_matched_total = sum(
        (min(_dec(row["bankLinkedAmount"]), _dec(row["totalAmount"])) for row in invoice_pool),
        Decimal("0.0000"),
    )
    invoice_overpaid_total = sum(
        (_dec(row.get("overpaidUnsettledAmount")) for row in invoice_pool),
        Decimal("0.0000"),
    )
    invoice_historical_overpaid_total = sum(
        (_dec(row.get("overpaidAfterRedAmount")) for row in invoice_pool),
        Decimal("0.0000"),
    )
    invoice_settled_overpaid_total = sum(
        (_dec(row.get("overpaidSettledAmount")) for row in invoice_pool),
        Decimal("0.0000"),
    )
    invoice_counts = {
        "matched": sum(1 for row in invoice_pool if row["bankMatchStatus"] == "matched"),
        "partial": sum(1 for row in invoice_pool if row["bankMatchStatus"] == "partial"),
        "unmatched": sum(1 for row in invoice_pool if row["bankMatchStatus"] == "unmatched"),
        "overpaid_after_red": sum(1 for row in invoice_pool if row["bankMatchStatus"] == "overpaid_after_red"),
        "red_overpayment_settled": sum(1 for row in invoice_pool if row["bankMatchStatus"] == "red_overpayment_settled"),
    }

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
            "invoiceTotal": str(_dec(invoice_total)),
            "invoiceMatchedTotal": str(_dec(invoice_matched_total)),
            "invoiceOutstandingTotal": str(_dec(max(invoice_total - invoice_matched_total, Decimal("0")))),
            "invoiceOverpaidAfterRedTotal": str(_dec(invoice_overpaid_total)),
            "invoiceHistoricalOverpaidAfterRedTotal": str(_dec(invoice_historical_overpaid_total)),
            "invoiceSettledOverpaidAfterRedTotal": str(_dec(invoice_settled_overpaid_total)),
            "invoiceCount": len(invoice_pool),
            "invoiceMatchedCount": invoice_counts["matched"],
            "invoicePartialCount": invoice_counts["partial"],
            "invoiceUnmatchedCount": invoice_counts["unmatched"],
            "invoiceOverpaidAfterRedCount": invoice_counts["overpaid_after_red"],
            "invoiceResolvedRedOverpaymentCount": invoice_counts["red_overpayment_settled"],
        },
    }


def txn_reconciliation_statuses(db: Session, txn_ids: list[int]) -> dict[int, dict[str, Any]]:
    """按确认分摊金额返回银行支出流水的核对状态。"""
    if not txn_ids:
        return {}
    txns = db.query(BankTransaction).filter(BankTransaction.id.in_(txn_ids)).all()
    txn_map = {row.id: row for row in txns if row.direction == "out"}
    if not txn_map:
        return {}

    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.target_type == TARGET_TYPE,
            TaxInvoiceLink.target_id.in_(list(txn_map)),
            TaxInvoiceLink.confirmed.is_(True),
            TaxInvoiceLink.match_method != "rejected",
        )
        .all()
    )
    invoice_ids = {row.invoice_id for row in links if row.allocated_amount is None}
    invoice_map = {
        row.id: row
        for row in db.query(TaxInvoice).filter(TaxInvoice.id.in_(invoice_ids)).all()
    } if invoice_ids else {}

    allocated_by_txn: dict[int, Decimal] = {}
    matched_at_by_txn: dict[int, Any] = {}
    for link in links:
        allocated_by_txn[link.target_id] = (
            allocated_by_txn.get(link.target_id, Decimal("0"))
            + _link_amount(link, invoice_map.get(link.invoice_id))
        )
        link_time = link.updated_at or link.created_at
        current_time = matched_at_by_txn.get(link.target_id)
        if link_time is not None and (current_time is None or link_time > current_time):
            matched_at_by_txn[link.target_id] = link_time

    result: dict[int, dict[str, Any]] = {}
    for txn_id, txn in txn_map.items():
        total = _dec(txn.amount)
        allocated = min(allocated_by_txn.get(txn_id, Decimal("0")), total)
        remaining = total - allocated
        matched_at = matched_at_by_txn.get(txn_id)
        result[txn_id] = {
            "allocatedAmount": str(_dec(allocated)),
            "remainingAmount": str(_dec(remaining)),
            "status": _status(remaining, total),
            "matchedAt": matched_at.isoformat() if matched_at is not None else None,
        }
    return result


def fully_reconciled_txn_ids(db: Session, txn_ids: list[int]) -> set[int]:
    """返回银行付款金额已被确认发票分摊完整覆盖的支出流水 ID。"""
    statuses = txn_reconciliation_statuses(db, txn_ids)
    return {txn_id for txn_id, row in statuses.items() if row["status"] == "matched"}


def pending_invoices(db: Session, limit: int = 500) -> list[dict[str, Any]]:
    """跨账期返回仍有银行付款待核对余额的有效进项发票。

    只使用 bank_transaction 链接计算已核对金额；采购/销售 match_status 与本列表完全无关。
    """
    limit = max(1, min(int(limit), 500))
    rows = (
        db.query(TaxInvoice)
        .filter(
            TaxInvoice.direction == "input",
            TaxInvoice.status == "issued",
        )
        .order_by(TaxInvoice.issue_date.desc(), TaxInvoice.id.desc())
        .all()
    )
    rows = [row for row in rows if tax_invoice_service.is_bank_payment_reconciliation_eligible(row, db=db)]
    invoice_ids = [row.id for row in rows]
    allocated_by_invoice: dict[int, Decimal] = {}
    if invoice_ids:
        links = (
            db.query(TaxInvoiceLink)
            .filter(
                TaxInvoiceLink.target_type == TARGET_TYPE,
                TaxInvoiceLink.invoice_id.in_(invoice_ids),
                TaxInvoiceLink.confirmed.is_(True),
                TaxInvoiceLink.match_method != "rejected",
            )
            .all()
        )
        invoice_map = {row.id: row for row in rows}
        for link in links:
            allocated_by_invoice[link.invoice_id] = (
                allocated_by_invoice.get(link.invoice_id, Decimal("0"))
                + _link_amount(link, invoice_map.get(link.invoice_id))
            )

    result: list[dict[str, Any]] = []
    for invoice in rows:
        total = _invoice_target_amount(db, invoice)
        linked = allocated_by_invoice.get(invoice.id, Decimal("0"))
        remaining = total - linked
        if remaining <= TOLERANCE:
            continue
        result.append({
            "id": invoice.id,
            "invoiceNumber": invoice.invoice_number,
            "sellerName": invoice.seller_name,
            "issueDate": invoice.issue_date.isoformat()[:10] if invoice.issue_date else "",
            "totalAmount": str(total),
            "bankLinkedAmount": str(_dec(linked)),
            "remaining": str(_dec(remaining)),
            "bankMatchStatus": _status(remaining, total),
        })
        if len(result) >= limit:
            break
    return result


def _split_match_invoice_to_txns(
    db: Session, invoice: TaxInvoice, txns: list[BankTransaction],
    actor: str, target_type: str = "bank_transaction",
    allocated_by_invoice: dict[int, Decimal] | None = None,
    allocated_by_txn: dict[int, Decimal] | None = None,
) -> tuple[int, Decimal]:
    """把一张发票拆给多笔流水（合计金额相等）。

    例：发票 ¥60288，被流水 ¥3306 + ¥5402 + ... 分次付完。
    返回 (匹配流水数, 已分配金额)。
    """
    target = _invoice_target_amount(db, invoice)
    allocated = (
        allocated_by_invoice.get(invoice.id, Decimal("0.0000"))
        if allocated_by_invoice is not None
        else _invoice_bank_allocated(db, invoice.id)
    )
    if not tax_invoice_service.is_bank_payment_reconciliation_eligible(invoice, db=db):
        return 0, allocated
    count = 0
    for txn in txns:
        if target - allocated <= TOLERANCE:
            break
        txn_amount = _dec(txn.amount)
        txn_used = (
            allocated_by_txn.get(txn.id, Decimal("0.0000"))
            if allocated_by_txn is not None
            else _txn_bank_allocated(db, txn.id)
        )
        txn_remaining = txn_amount - txn_used
        if txn_remaining <= TOLERANCE:
            continue
        existing = (
            db.query(TaxInvoiceLink)
            .filter_by(invoice_id=invoice.id, target_type=target_type, target_id=txn.id)
            .first()
        )
        # 已存在（包括 rejected）就不自动复活；人工拒绝必须继续受尊重。
        if existing is not None:
            continue
        portion = min(target - allocated, txn_remaining)
        if portion <= TOLERANCE:
            continue
        link_row = TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type=target_type,
            target_id=txn.id,
            allocated_amount=portion,
            match_method="auto_split",
            confidence=Decimal("0.85"),
            confirmed=True,
            note=f"系统拆分匹配：发票 ¥{_dec(invoice.total_amount)} 拆给多笔流水",
        )
        db.add(link_row)
        db.flush()
        allocated += portion
        if allocated_by_invoice is not None:
            allocated_by_invoice[invoice.id] = allocated
        if allocated_by_txn is not None:
            allocated_by_txn[txn.id] = txn_used + portion
        count += 1
    return count, allocated


def _split_match_txn_to_invoices(
    db: Session, txn: BankTransaction, invoices: list[TaxInvoice],
    actor: str, target_type: str = "bank_transaction",
    allocated_by_invoice: dict[int, Decimal] | None = None,
    allocated_by_txn: dict[int, Decimal] | None = None,
) -> tuple[int, Decimal]:
    """把一笔流水拆给多张发票（合计金额相等）。

    例：流水 ¥5000，被发票 ¥3080 + ¥1920 分次开完。
    返回 (匹配发票数, 已分配金额)。
    """
    target = _dec(txn.amount)
    allocated = (
        allocated_by_txn.get(txn.id, Decimal("0.0000"))
        if allocated_by_txn is not None
        else _txn_bank_allocated(db, txn.id)
    )
    count = 0
    for invoice in invoices:
        if target - allocated <= TOLERANCE:
            break
        if not tax_invoice_service.is_bank_payment_reconciliation_eligible(invoice, db=db):
            continue
        inv_amount = _invoice_target_amount(db, invoice)
        inv_used = (
            allocated_by_invoice.get(invoice.id, Decimal("0.0000"))
            if allocated_by_invoice is not None
            else _invoice_bank_allocated(db, invoice.id)
        )
        inv_remaining = inv_amount - inv_used
        if inv_remaining <= TOLERANCE:
            continue
        existing = (
            db.query(TaxInvoiceLink)
            .filter_by(invoice_id=invoice.id, target_type=target_type, target_id=txn.id)
            .first()
        )
        if existing is not None:
            continue
        portion = min(target - allocated, inv_remaining)
        if portion <= TOLERANCE:
            continue
        link_row = TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type=target_type,
            target_id=txn.id,
            allocated_amount=portion,
            match_method="auto_split",
            confidence=Decimal("0.85"),
            confirmed=True,
            note=f"系统拆分匹配：流水 ¥{_dec(txn.amount)} 拆给多张发票",
        )
        db.add(link_row)
        db.flush()
        allocated += portion
        if allocated_by_txn is not None:
            allocated_by_txn[txn.id] = allocated
        if allocated_by_invoice is not None:
            allocated_by_invoice[invoice.id] = inv_used + portion
        count += 1
    return count, allocated


def auto_match(db: Session, year: int, month: int, actor: str = "system") -> dict[str, Any]:
    """自动匹配当月银行付款 ↔ 进项发票。

    规则（与 overview 建议规则一致）：对方户名 == 销方名 AND 剩余金额相等。
    满足则只写 bank_transaction 关联（match_method=auto, confirmed=True）；
    不改变发票台账的采购/销售 match_status。已有 manual 链路不会被覆盖。
    """
    start, end = _month_range(year, month)
    invoice_window_start, invoice_window_end = _invoice_candidate_window(year, month)

    # 操作边界必须锁定当前账期：点“8 月自动匹配”只能修改 8 月银行支出。
    # 为兼容开票/付款跨月，只有候选发票允许向前后各扩 3 个完整自然月。
    txns = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.txn_date >= start,
            BankTransaction.txn_date <= end,
            BankTransaction.direction == "out",
        )
        .all()
    )
    if not txns:
        return {"year": year, "month": month, "matched": 0, "skipped": 0, "details": []}

    # 候选进项发票允许跨月，但自动落库的银行流水仍严格属于当前账期。
    invoices = (
        db.query(TaxInvoice)
        .filter(
            TaxInvoice.direction == "input",
            TaxInvoice.issue_date >= invoice_window_start,
            TaxInvoice.issue_date < invoice_window_end,
        )
        .all()
    )
    invoices = [invoice for invoice in invoices if tax_invoice_service.is_bank_payment_reconciliation_eligible(invoice, db=db)]
    if not invoices:
        return {"year": year, "month": month, "matched": 0, "skipped": 0, "details": []}

    # 所有历史 pair 都要读取：rejected 不参与金额，但必须阻止自动复活。
    # 只有人工 link() 才允许用户明确把 rejected pair 重新启用。
    all_existing_links = (
        db.query(TaxInvoiceLink)
        .filter(TaxInvoiceLink.target_type == TARGET_TYPE)
        .all()
    )
    existing_links = [link for link in all_existing_links if link.match_method != "rejected"]
    allocated_by_txn: dict[int, Decimal] = {}
    allocated_by_invoice: dict[int, Decimal] = {}
    existing_invoice_ids = {link.invoice_id for link in existing_links if link.allocated_amount is None}
    existing_invoice_map = {
        row.id: row
        for row in db.query(TaxInvoice).filter(TaxInvoice.id.in_(existing_invoice_ids)).all()
    } if existing_invoice_ids else {}
    for link in existing_links:
        if not link.confirmed:
            continue
        amount = _link_amount(link, existing_invoice_map.get(link.invoice_id))
        allocated_by_txn[link.target_id] = allocated_by_txn.get(link.target_id, Decimal("0")) + amount
        allocated_by_invoice[link.invoice_id] = allocated_by_invoice.get(link.invoice_id, Decimal("0")) + amount
    txn_amount_by_id = {txn.id: _dec(txn.amount) for txn in txns}
    existing_txn_ids: set[int] = {
        txn_id for txn_id, allocated in allocated_by_txn.items()
        if allocated >= txn_amount_by_id.get(txn_id, Decimal("0")) - TOLERANCE
    }
    existing_invoice_txn: set[tuple[int, int]] = {
        (link.invoice_id, link.target_id) for link in all_existing_links
    }

    matched = 0
    skipped = 0
    details: list[dict] = []

    for txn in txns:
        txn_total = _dec(txn.amount)
        txn_remaining = txn_total - allocated_by_txn.get(txn.id, Decimal("0"))
        if txn_remaining <= TOLERANCE:
            skipped += 1
            existing_txn_ids.add(txn.id)
            continue
        for invoice in invoices:
            if (invoice.id, txn.id) in existing_invoice_txn:
                continue
            invoice_total = _invoice_target_amount(db, invoice)
            invoice_remaining = invoice_total - allocated_by_invoice.get(invoice.id, Decimal("0"))
            if invoice_remaining <= TOLERANCE:
                continue
            # 规则：销方名 == 对方户名 + “双方剩余金额”相等。
            # 用剩余金额而不是原始票面/付款金额，才能正确补齐历史部分匹配。
            if (
                invoice.seller_name
                and txn.counterparty_name
                and _normalize_name(invoice.seller_name) == _normalize_name(txn.counterparty_name)
                and abs(invoice_remaining - txn_remaining) <= TOLERANCE
            ):
                portion = min(invoice_remaining, txn_remaining)
                link_row = TaxInvoiceLink(
                    invoice_id=invoice.id,
                    target_type=TARGET_TYPE,
                    target_id=txn.id,
                    allocated_amount=portion,
                    match_method="auto",
                    confidence=Decimal("1"),
                    confirmed=True,
                    note="系统按同名同剩余金额自动匹配",
                )
                db.add(link_row)
                db.flush()
                allocated_by_txn[txn.id] = allocated_by_txn.get(txn.id, Decimal("0")) + portion
                allocated_by_invoice[invoice.id] = allocated_by_invoice.get(invoice.id, Decimal("0")) + portion
                matched += 1
                if txn_total - allocated_by_txn[txn.id] <= TOLERANCE:
                    existing_txn_ids.add(txn.id)
                existing_invoice_txn.add((invoice.id, txn.id))
                details.append({
                    "invoiceId": invoice.id,
                    "invoiceNumber": invoice.invoice_number,
                    "sellerName": invoice.seller_name,
                    "txnId": txn.id,
                    "txnDate": txn.txn_date.isoformat(),
                    "amount": str(portion),
                })
                break  # 一笔付款的当前剩余额只配一张同额发票

    # 第二轮：拆分匹配 — 把未配的发票按"同名 + 多笔流水合计 == 发票金额"找出来
    split_matched = 0
    split_details: list[dict] = []
    # 银行付款维度按“剩余未分摊金额”判断，不依赖跨业务共用的 match_status。
    leftover_invoices = [
        inv for inv in invoices
        if _invoice_target_amount(db, inv) - allocated_by_invoice.get(inv.id, Decimal("0")) > TOLERANCE
    ]
    # 仍未配的流水
    leftover_txns = [t for t in txns if t.id not in existing_txn_ids]
    # 按规范化名分组
    inv_groups: dict[str, list[TaxInvoice]] = {}
    for inv in leftover_invoices:
        norm = _normalize_name(inv.seller_name)
        if norm:
            inv_groups.setdefault(norm, []).append(inv)
    txn_groups: dict[str, list[BankTransaction]] = {}
    for txn in leftover_txns:
        norm = _normalize_name(txn.counterparty_name)
        if norm:
            txn_groups.setdefault(norm, []).append(txn)
    for norm, inv_list in inv_groups.items():
        if norm not in txn_groups:
            continue
        txn_list = sorted(txn_groups[norm], key=lambda x: x.txn_date)
        for inv in inv_list:
            inv_total = _invoice_target_amount(db, inv)
            inv_remaining = inv_total - allocated_by_invoice.get(inv.id, Decimal("0"))
            if inv_remaining <= TOLERANCE:
                continue
            # 同名流水按“可用剩余额”累计；历史已部分分配的发票只补齐剩余部分。
            running = Decimal("0.0000")
            needed_txns = []
            for t in txn_list:
                txn_remaining = _dec(t.amount) - allocated_by_txn.get(t.id, Decimal("0"))
                if txn_remaining <= TOLERANCE:
                    continue
                if running >= inv_remaining - TOLERANCE:
                    break
                needed_txns.append(t)
                running += txn_remaining
            # 自动拆分必须“组合金额精确对上”；只因为同名且金额够大，不能自动切一部分。
            if abs(running - inv_remaining) <= TOLERANCE and needed_txns:
                cnt, allocated = _split_match_invoice_to_txns(
                    db, inv, needed_txns, actor,
                    allocated_by_invoice=allocated_by_invoice,
                    allocated_by_txn=allocated_by_txn,
                )
                if cnt > 0:
                    split_matched += cnt
                    split_details.append({
                        "invoiceId": inv.id,
                        "invoiceNumber": inv.invoice_number,
                        "invoiceAmount": str(inv_total),
                        "txnIds": [t.id for t in needed_txns],
                        "txnDates": [t.txn_date.isoformat() for t in needed_txns],
                    })
                    for t in needed_txns:
                        if allocated_by_txn.get(t.id, Decimal("0")) >= _dec(t.amount) - TOLERANCE:
                            existing_txn_ids.add(t.id)

    # 第三轮：把仍未配的"大流水"拆给多张同名小发票
    big_txn_split_matched = 0
    still_unmatched_txns = [t for t in leftover_txns if t.id not in existing_txn_ids]
    for txn in still_unmatched_txns:
        norm = _normalize_name(txn.counterparty_name)
        if norm not in inv_groups:
            continue
        candidates = sorted(
            [
                inv for inv in inv_groups[norm]
                if _invoice_target_amount(db, inv) - allocated_by_invoice.get(inv.id, Decimal("0")) > TOLERANCE
            ],
            key=lambda inv: (inv.issue_date or date.min, inv.id),
        )
        txn_remaining = _dec(txn.amount) - allocated_by_txn.get(txn.id, Decimal("0"))
        selected: list[TaxInvoice] = []
        selected_total = Decimal("0.0000")
        for inv in candidates:
            if selected_total >= txn_remaining - TOLERANCE:
                break
            selected.append(inv)
            selected_total += _invoice_target_amount(db, inv) - allocated_by_invoice.get(inv.id, Decimal("0"))
        # 同名多票只有合计金额精确等于当前流水剩余金额时才允许自动拆分。
        if len(selected) >= 2 and abs(selected_total - txn_remaining) <= TOLERANCE:
            cnt, allocated = _split_match_txn_to_invoices(
                db, txn, selected, actor,
                allocated_by_invoice=allocated_by_invoice,
                allocated_by_txn=allocated_by_txn,
            )
            if cnt > 0:
                big_txn_split_matched += cnt
                split_details.append({
                    "txnId": txn.id,
                    "txnAmount": str(_dec(txn.amount)),
                    "invoiceIds": [c.id for c in selected[:cnt]],
                })

    # 第四轮：通过 Supplier 银行账户强匹配
    from app.models.purchase import Supplier as SupplierModel
    supplier_matched = 0
    supplier_details: list[dict] = []
    all_suppliers = db.query(SupplierModel).all()
    # 流水对方账号 → Supplier
    supplier_by_account: dict[str, list] = {}
    for s in all_suppliers:
        if s.bank_account_no:
            supplier_by_account.setdefault(s.bank_account_no, []).append(s)
    # 重新扫描未配流水
    still_unmatched_after_split = [t for t in leftover_txns if t.id not in existing_txn_ids]
    for txn in still_unmatched_after_split:
        account = (getattr(txn, 'counterparty_account', '') or '').strip()
        if not account or account not in supplier_by_account:
            continue
        # 找到 supplier；通过 supplier.name → 找对应进项发票
        suppliers = supplier_by_account[account]
        for s in suppliers:
            supplier_norm = _normalize_name(s.name)
            for inv in leftover_invoices:
                inv_total = _invoice_target_amount(db, inv)
                inv_remaining = inv_total - allocated_by_invoice.get(inv.id, Decimal("0"))
                txn_total = _dec(txn.amount)
                txn_remaining = txn_total - allocated_by_txn.get(txn.id, Decimal("0"))
                if inv_remaining <= TOLERANCE or txn_remaining <= TOLERANCE:
                    continue
                # 供应商银行账户是强证据，但仍只在双方“剩余金额”相等时自动落库。
                if supplier_norm == _normalize_name(inv.seller_name) and abs(inv_remaining - txn_remaining) <= TOLERANCE:
                    if (inv.id, txn.id) not in existing_invoice_txn:
                        portion = min(inv_remaining, txn_remaining)
                        link_row = TaxInvoiceLink(
                            invoice_id=inv.id,
                            target_type=TARGET_TYPE,
                            target_id=txn.id,
                            allocated_amount=portion,
                            match_method="supplier_account",
                            confidence=Decimal("0.95"),
                            confirmed=True,
                            note=f"通过供应商银行账户强匹配：#{s.id} {s.name} 账号 {account}",
                        )
                        db.add(link_row)
                        db.flush()
                        allocated_by_invoice[inv.id] = allocated_by_invoice.get(inv.id, Decimal("0")) + portion
                        allocated_by_txn[txn.id] = allocated_by_txn.get(txn.id, Decimal("0")) + portion
                        existing_invoice_txn.add((inv.id, txn.id))
                        supplier_matched += 1
                        if allocated_by_txn.get(txn.id, Decimal("0")) >= txn_total - TOLERANCE:
                            existing_txn_ids.add(txn.id)
                        supplier_details.append({
                            "invoiceId": inv.id,
                            "supplierId": s.id,
                            "supplierName": s.name,
                            "bankAccount": account,
                            "txnId": txn.id,
                            "amount": str(portion),
                        })
                        break
            if txn.id in existing_txn_ids:
                break

    db.commit()
    audit(
        db, actor, "payment_invoice_match.auto", "tax_invoice_links", "",
        {"year": year, "month": month, "matched": matched, "skipped": skipped,
         "splitMatched": split_matched, "bigTxnSplitMatched": big_txn_split_matched,
         "supplierMatched": supplier_matched},
    )
    return {
        "year": year, "month": month,
        "matched": matched, "skipped": skipped,
        "splitMatched": split_matched, "bigTxnSplitMatched": big_txn_split_matched,
        "supplierMatched": supplier_matched,
        "details": details, "splitDetails": split_details, "supplierDetails": supplier_details,
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
    if not tax_invoice_service.is_bank_payment_reconciliation_eligible(invoice, db=db):
        raise ValueError(tax_invoice_service.bank_payment_reconciliation_ineligible_reason(invoice, db=db))

    db.refresh(txn, with_for_update=True)
    db.refresh(invoice, with_for_update=True)
    link = (
        db.query(TaxInvoiceLink)
        .filter_by(invoice_id=invoice.id, target_type=TARGET_TYPE, target_id=txn.id)
        .first()
    )
    exclude_id = link.id if link is not None else None
    invoice_total = _invoice_target_amount(db, invoice)
    txn_total = _dec(txn.amount)
    invoice_used = _invoice_bank_allocated(db, invoice.id, exclude_link_id=exclude_id)
    txn_used = _txn_bank_allocated(db, txn.id, exclude_link_id=exclude_id)
    if allocated_amount is None:
        amount = min(invoice_total - invoice_used, txn_total - txn_used)
    else:
        amount = _dec(to_decimal(allocated_amount))

    if amount <= TOLERANCE:
        raise ValueError("分摊金额必须大于 0")
    if invoice_used + amount > invoice_total + TOLERANCE:
        raise ValueError(f"该发票银行付款累计分摊 {invoice_used + amount} 超过票面金额 {invoice_total}")
    if txn_used + amount > txn_total + TOLERANCE:
        raise ValueError(f"该笔付款累计分摊 {txn_used + amount} 超过付款金额 {txn_total}")

    if link is None:
        link = TaxInvoiceLink(invoice_id=invoice.id, target_type=TARGET_TYPE, target_id=txn.id)
        db.add(link)
    link.allocated_amount = amount
    link.match_method = "manual"
    link.confidence = Decimal("1")
    link.confirmed = True
    link.note = note or "付款发票匹配清单手工标记"

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

    db.commit()
    audit(
        db, actor, "payment_invoice_match.unlink", "tax_invoice_links", str(row.id),
        {"invoiceId": row.invoice_id, "targetId": row.target_id},
    )
    return {"ok": True}
