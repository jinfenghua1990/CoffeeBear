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
import re
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


def _dec(value: Decimal | None) -> Decimal:
    return quantize(value, MONEY_QUANT) if value is not None else Decimal("0.0000")


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
    return sum(
        (_dec(row.allocated_amount) for row in _active_bank_links(
            db, invoice_id=invoice_id, exclude_link_id=exclude_link_id
        )),
        Decimal("0.0000"),
    )


def _txn_bank_allocated(db: Session, txn_id: int, *, exclude_link_id: int | None = None) -> Decimal:
    return sum(
        (_dec(row.allocated_amount) for row in _active_bank_links(
            db, txn_id=txn_id, exclude_link_id=exclude_link_id
        )),
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


def _split_match_invoice_to_txns(
    db: Session, invoice: TaxInvoice, txns: list[BankTransaction],
    actor: str, target_type: str = "bank_transaction"
) -> tuple[int, Decimal]:
    """把一张发票拆给多笔流水（合计金额相等）。

    例：发票 ¥60288，被流水 ¥3306 + ¥5402 + ... 分次付完。
    返回 (匹配流水数, 已分配金额)。
    """
    target = _dec(invoice.total_amount)
    allocated = _invoice_bank_allocated(db, invoice.id)
    count = 0
    for txn in txns:
        if target - allocated <= TOLERANCE:
            break
        txn_amount = _dec(txn.amount)
        txn_used = _txn_bank_allocated(db, txn.id)
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
        count += 1
    if invoice.match_status == "unmatched" and target - allocated <= TOLERANCE:
        invoice.match_status = "matched"
    return count, allocated


def _split_match_txn_to_invoices(
    db: Session, txn: BankTransaction, invoices: list[TaxInvoice],
    actor: str, target_type: str = "bank_transaction"
) -> tuple[int, Decimal]:
    """把一笔流水拆给多张发票（合计金额相等）。

    例：流水 ¥5000，被发票 ¥3080 + ¥1920 分次开完。
    返回 (匹配发票数, 已分配金额)。
    """
    target = _dec(txn.amount)
    allocated = _txn_bank_allocated(db, txn.id)
    count = 0
    for invoice in invoices:
        if target - allocated <= TOLERANCE:
            break
        inv_amount = _dec(invoice.total_amount)
        inv_used = _invoice_bank_allocated(db, invoice.id)
        inv_remaining = inv_amount - inv_used
        if inv_remaining <= TOLERANCE:
            if invoice.match_status == "unmatched":
                invoice.match_status = "matched"
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
        count += 1
        if invoice.match_status == "unmatched" and inv_amount - (inv_used + portion) <= TOLERANCE:
            invoice.match_status = "matched"
    return count, allocated


def auto_match(db: Session, year: int, month: int, actor: str = "system") -> dict[str, Any]:
    """自动匹配当月银行付款 ↔ 进项发票。

    规则（与 overview 建议规则一致）：对方户名 == 销方名 AND 剩余金额相等。
    满足则直接落库（match_method=auto, confirmed=True），并把发票 match_status 推进为 matched。
    已有 manual 链路的发票不会被覆盖（confirmed 行的 link 一律跳过）。
    """
    start, end = _month_range(year, month)

    # 扩展窗口：发票前后 ±3 个月都算（避免用户上传延迟/账期错位）
    from datetime import timedelta
    win_start = date(start.year, start.month, 1) - timedelta(days=MATCH_WINDOW_MONTHS * 31)
    win_end = date(end.year, end.month, 1) + timedelta(days=MATCH_WINDOW_MONTHS * 31)
    # 当月 ±3 月支出流水
    txns = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.txn_date >= win_start,
            BankTransaction.txn_date <= win_end,
            BankTransaction.direction == "out",
        )
        .all()
    )
    if not txns:
        return {"year": year, "month": month, "matched": 0, "skipped": 0, "details": []}

    # 进项发票池：同样扩展窗口
    invoices = (
        db.query(TaxInvoice)
        .filter(
            TaxInvoice.direction == "input",
            TaxInvoice.issue_date >= win_start,
            TaxInvoice.issue_date <= win_end,
        )
        .all()
    )
    if not invoices:
        return {"year": year, "month": month, "matched": 0, "skipped": 0, "details": []}

    # 已存在的 link（避免重复创建）
    existing_links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.target_type == TARGET_TYPE,
            TaxInvoiceLink.match_method != "rejected",
        )
        .all()
    )
    allocated_by_txn: dict[int, Decimal] = {}
    allocated_by_invoice: dict[int, Decimal] = {}
    for link in existing_links:
        if not link.confirmed:
            continue
        amount = _dec(link.allocated_amount)
        allocated_by_txn[link.target_id] = allocated_by_txn.get(link.target_id, Decimal("0")) + amount
        allocated_by_invoice[link.invoice_id] = allocated_by_invoice.get(link.invoice_id, Decimal("0")) + amount
    txn_amount_by_id = {txn.id: _dec(txn.amount) for txn in txns}
    existing_txn_ids: set[int] = {
        txn_id for txn_id, allocated in allocated_by_txn.items()
        if allocated >= txn_amount_by_id.get(txn_id, Decimal("0")) - TOLERANCE
    }
    existing_invoice_txn: set[tuple[int, int]] = {(link.invoice_id, link.target_id) for link in existing_links}

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
            invoice_total = _dec(invoice.total_amount)
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
                if invoice.match_status == "unmatched" and invoice_total - allocated_by_invoice[invoice.id] <= TOLERANCE:
                    invoice.match_status = "matched"
                    msg = f"已匹配银行付款 {txn.txn_date.isoformat()} {portion}"
                    invoice.match_note = f"{invoice.match_note}；{msg}" if invoice.match_note else msg
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
        if _dec(inv.total_amount) - _invoice_bank_allocated(db, inv.id) > TOLERANCE
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
            inv_total = _dec(inv.total_amount)
            inv_remaining = inv_total - _invoice_bank_allocated(db, inv.id)
            if inv_remaining <= TOLERANCE:
                continue
            # 同名流水按“可用剩余额”累计；历史已部分分配的发票只补齐剩余部分。
            running = Decimal("0.0000")
            needed_txns = []
            for t in txn_list:
                txn_remaining = _dec(t.amount) - _txn_bank_allocated(db, t.id)
                if txn_remaining <= TOLERANCE:
                    continue
                if running >= inv_remaining - TOLERANCE:
                    break
                needed_txns.append(t)
                running += txn_remaining
            if running >= inv_remaining - TOLERANCE and needed_txns:
                cnt, allocated = _split_match_invoice_to_txns(db, inv, needed_txns, actor)
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
                        if _txn_bank_allocated(db, t.id) >= _dec(t.amount) - TOLERANCE:
                            existing_txn_ids.add(t.id)

    # 第三轮：把仍未配的"大流水"拆给多张同名小发票
    big_txn_split_matched = 0
    still_unmatched_txns = [t for t in leftover_txns if t.id not in existing_txn_ids]
    for txn in still_unmatched_txns:
        norm = _normalize_name(txn.counterparty_name)
        if norm not in inv_groups:
            continue
        candidates = [
            inv for inv in inv_groups[norm]
            if _dec(inv.total_amount) - _invoice_bank_allocated(db, inv.id) > TOLERANCE
        ]
        if len(candidates) >= 2:
            cnt, allocated = _split_match_txn_to_invoices(db, txn, candidates, actor)
            if cnt > 0:
                big_txn_split_matched += cnt
                split_details.append({
                    "txnId": txn.id,
                    "txnAmount": str(_dec(txn.amount)),
                    "invoiceIds": [c.id for c in candidates[:cnt]],
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
                inv_total = _dec(inv.total_amount)
                inv_remaining = inv_total - _invoice_bank_allocated(db, inv.id)
                txn_total = _dec(txn.amount)
                txn_remaining = txn_total - _txn_bank_allocated(db, txn.id)
                if inv_remaining <= TOLERANCE or txn_remaining <= TOLERANCE:
                    continue
                # 供应商银行账户是强证据，但仍只在双方“剩余金额”相等时自动落库。
                if supplier_norm == _normalize_name(inv.seller_name) and abs(inv_remaining - txn_remaining) <= TOLERANCE:
                    existing = db.query(TaxInvoiceLink).filter_by(
                        invoice_id=inv.id, target_type=TARGET_TYPE, target_id=txn.id
                    ).first()
                    if existing is None:
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
                        if inv.match_status == "unmatched" and inv_total - (_invoice_bank_allocated(db, inv.id)) <= TOLERANCE:
                            inv.match_status = "matched"
                            msg = f"已匹配（供应商银行账户强匹配）{txn.txn_date.isoformat()} ¥{portion}"
                            inv.match_note = f"{inv.match_note}；{msg}" if inv.match_note else msg
                        supplier_matched += 1
                        if _txn_bank_allocated(db, txn.id) >= txn_total - TOLERANCE:
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

    db.refresh(txn, with_for_update=True)
    db.refresh(invoice, with_for_update=True)
    link = (
        db.query(TaxInvoiceLink)
        .filter_by(invoice_id=invoice.id, target_type=TARGET_TYPE, target_id=txn.id)
        .first()
    )
    exclude_id = link.id if link is not None else None
    invoice_total = _dec(invoice.total_amount)
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

    if invoice.match_status == "unmatched" and invoice_total - (invoice_used + amount) <= TOLERANCE:
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
