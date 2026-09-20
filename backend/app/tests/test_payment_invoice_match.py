"""付款↔发票匹配标记清单（财务月度资料）服务层测试。

覆盖：overview 按月/方向过滤、matched/partial/unmatched 银行状态推导、
金额封顶、发票池统计、同名同金额建议、link 落库但不污染业务匹配状态、
软删复活、方向校验、unlink 与审计日志。
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.bank import BankTransaction
from app.models.org import AuditLog
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import payment_invoice_match_service as pm


def _txn(
    db_session,
    *,
    year=2026,
    month=8,
    day=5,
    direction="out",
    amount="1000.00",
    name="供货商甲",
    summary="货款",
    voucher="",
) -> BankTransaction:
    row = BankTransaction(
        txn_date=date(year, month, day),
        direction=direction,
        amount=Decimal(amount),
        counterparty_name=name,
        summary=summary,
        voucher_no=voucher,
        fingerprint=f"pytest-pim|{uuid4().hex}",
        raw={},
    )
    db_session.add(row)
    db_session.flush()
    return row


def _invoice(
    db_session,
    *,
    seller="供货商甲",
    amount="1000.00",
    year=2026,
    month=8,
    day=10,
    direction="input",
) -> TaxInvoice:
    row = TaxInvoice(
        invoice_key=f"pytest-pim|{uuid4().hex}",
        invoice_number=f"PIM-{uuid4().hex[:12]}",
        direction=direction,
        status="issued",
        issue_date=datetime(year, month, day, tzinfo=timezone.utc),
        seller_name=seller,
        total_amount=Decimal(amount),
        source_system="tax_export",
        raw={},
    )
    db_session.add(row)
    db_session.flush()
    return row


# ---------- 纯函数 / 过滤 ----------

def test_month_range_rejects_invalid_month():
    with pytest.raises(ValueError):
        pm._month_range(2026, 0)
    with pytest.raises(ValueError):
        pm._month_range(2026, 13)
    assert pm._month_range(2026, 2) == (date(2026, 2, 1), date(2026, 2, 28))


def test_overview_filters_by_month_and_out_direction(db_session):
    in_month = _txn(db_session, amount="500.00")
    _txn(db_session, month=7, amount="900.00")  # 跨月不进清单
    _txn(db_session, direction="in", amount="700.00")  # 收款不进清单
    _invoice(db_session, amount="500.00")

    data = pm.overview(db_session, 2026, 8)
    assert [row["id"] for row in data["payments"]] == [in_month.id]
    assert data["summary"]["paymentTotal"] == "500.00"
    assert data["summary"]["txnCount"] == 1
    assert data["summary"]["unmatchedCount"] == 1


def test_status_never_calls_zero_allocation_matched():
    assert pm._status(Decimal("0.01"), Decimal("0.01")) == "unmatched"
    assert pm._status(Decimal("100.00"), Decimal("100.00")) == "unmatched"
    assert pm._status(Decimal("0.00"), Decimal("100.00")) == "matched"
    assert pm._status(Decimal("40.00"), Decimal("100.00")) == "partial"


def test_overview_status_matched_after_link(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")
    pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)

    data = pm.overview(db_session, 2026, 8)
    row = data["payments"][0]
    assert row["status"] == "matched"
    assert row["matchedAmount"] == "1000.00"
    assert row["remaining"] == "0.00"
    assert row["invoices"][0]["invoiceId"] == inv.id
    assert data["summary"]["matchedCount"] == 1
    assert data["summary"]["matchedTotal"] == "1000.00"


def test_overview_status_partial(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="600.00")
    pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)

    row = pm.overview(db_session, 2026, 8)["payments"][0]
    assert row["status"] == "partial"
    assert row["matchedAmount"] == "600.00"
    assert row["remaining"] == "400.00"


def test_overview_status_unmatched_no_links(db_session):
    _txn(db_session, amount="300.00")
    data = pm.overview(db_session, 2026, 8)
    row = data["payments"][0]
    assert row["status"] == "unmatched"
    assert row["invoices"] == []
    assert data["summary"]["unmatchedTotal"] == "300.00"


def test_overview_matched_amount_capped_at_txn_amount(db_session):
    txn = _txn(db_session, amount="100.00")
    inv_a = _invoice(db_session, seller="供货商甲", amount="80.00")
    inv_b = _invoice(db_session, seller="供货商乙", amount="80.00")
    pm.link(db_session, txn_id=txn.id, invoice_id=inv_a.id)
    pm.link(db_session, txn_id=txn.id, invoice_id=inv_b.id)

    row = pm.overview(db_session, 2026, 8)["payments"][0]
    assert len(row["invoices"]) == 2
    assert row["matchedAmount"] == "100.00"  # 封顶不超付款金额
    assert row["remaining"] == "0.00"
    assert row["status"] == "matched"


def test_overview_invoice_pool_counts_bank_links_only(db_session):
    txn = _txn(db_session, amount="400.00")
    linked = _invoice(db_session, amount="400.00")
    other_month = _invoice(db_session, amount="100.00", month=7)
    output = _invoice(db_session, amount="200.00", direction="output")
    pm.link(db_session, txn_id=txn.id, invoice_id=linked.id)

    data = pm.overview(db_session, 2026, 8)
    pool_ids = {row["id"] for row in data["invoicePool"]}
    assert linked.id in pool_ids
    assert other_month.id not in pool_ids
    assert output.id not in pool_ids
    row = next(r for r in data["invoicePool"] if r["id"] == linked.id)
    assert row["bankLinkedAmount"] == "400.00"
    assert row["remaining"] == "0.00"
    assert row["bankMatchStatus"] == "matched"
    assert row["links"][0]["counterpartyName"] == "供货商甲"
    assert row["links"][0]["txnId"] == txn.id
    assert data["summary"]["invoiceTotal"] == "400.00"
    assert data["summary"]["invoiceMatchedTotal"] == "400.00"
    assert data["summary"]["invoiceOutstandingTotal"] == "0.00"
    assert data["summary"]["invoiceMatchedCount"] == 1




def test_red_or_non_positive_invoice_never_enters_bank_reconciliation(db_session):
    """负数/红冲票属于会计事实，不属于银行付款待核对项。"""
    txn = _txn(db_session, amount="1518.00", name="龙港市丽峰包装有限公司")
    inv = _invoice(
        db_session,
        seller="龙港市丽峰包装有限公司",
        amount="-1518.00",
        month=7,
        day=8,
    )
    txn.txn_date = date(2026, 7, 9)
    inv.status = "red"
    db_session.commit()

    data = pm.overview(db_session, 2026, 7)
    assert inv.id not in {row["id"] for row in data["invoicePool"]}
    assert data["summary"]["invoiceCount"] == 0
    assert data["summary"]["invoiceTotal"] == "0.00"
    assert data["summary"]["invoiceMatchedCount"] == 0

    with pytest.raises(ValueError, match="不参与银行付款核对"):
        pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)

    auto = pm.auto_match(db_session, 2026, 7)
    assert auto["matched"] == 0
    assert db_session.query(TaxInvoiceLink).filter_by(
        invoice_id=inv.id, target_type="bank_transaction"
    ).count() == 0


def test_positive_red_invoice_also_stays_out_of_bank_reconciliation(db_session):
    """已红冲的正数蓝字票也不能重新进入付款核对。"""
    txn = _txn(db_session, amount="500.00", name="已红冲供应商")
    inv = _invoice(db_session, seller="已红冲供应商", amount="500.00")
    inv.status = "red"
    db_session.commit()

    data = pm.overview(db_session, 2026, 8)
    assert inv.id not in {row["id"] for row in data["invoicePool"]}
    with pytest.raises(ValueError, match="红冲相关发票不参与银行付款核对"):
        pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)


def test_txn_reconciliation_statuses_require_confirmed_amount_coverage(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")
    link = TaxInvoiceLink(
        invoice_id=inv.id,
        target_type="bank_transaction",
        target_id=txn.id,
        allocated_amount=Decimal("1000.00"),
        match_method="manual",
        confirmed=False,
    )
    db_session.add(link)
    db_session.flush()

    status = pm.txn_reconciliation_statuses(db_session, [txn.id])[txn.id]
    assert status["status"] == "unmatched"
    assert status["allocatedAmount"] == "0.00"
    assert status["remainingAmount"] == "1000.00"

    link.confirmed = True
    link.allocated_amount = Decimal("400.00")
    db_session.flush()
    status = pm.txn_reconciliation_statuses(db_session, [txn.id])[txn.id]
    assert status["status"] == "partial"
    assert status["allocatedAmount"] == "400.00"
    assert status["remainingAmount"] == "600.00"

    link.allocated_amount = Decimal("1000.00")
    db_session.flush()
    status = pm.txn_reconciliation_statuses(db_session, [txn.id])[txn.id]
    assert status["status"] == "matched"
    assert status["allocatedAmount"] == "1000.00"
    assert status["remainingAmount"] == "0.00"


def test_pending_invoice_pool_ignores_business_match_status_and_uses_bank_remaining(db_session):
    txn = _txn(db_session, amount="400.00", month=7)
    inv = _invoice(db_session, amount="1000.00", month=6)
    inv.match_status = "matched"  # 已和采购单配平，也仍然需要独立做银行付款核对。
    db_session.flush()

    pm.link(db_session, txn_id=txn.id, invoice_id=inv.id, allocated_amount="400.00")

    rows = pm.pending_invoices(db_session)
    row = next(item for item in rows if item["id"] == inv.id)
    assert row["bankLinkedAmount"] == "400.00"
    assert row["remaining"] == "600.00"
    assert row["bankMatchStatus"] == "partial"

    db_session.refresh(inv)
    assert inv.match_status == "matched"


def test_suggestion_same_name_and_equal_remaining(db_session):
    txn = _txn(db_session, amount="500.00", name="杭州纸箱厂")
    hit = _invoice(db_session, seller="杭州纸箱厂", amount="500.00")
    miss = _invoice(db_session, seller="别的公司", amount="500.00")

    data = pm.overview(db_session, 2026, 8)
    assert hit.id in data["payments"][0]["suggestedInvoiceIds"]
    assert miss.id not in data["payments"][0]["suggestedInvoiceIds"]
    row = next(r for r in data["invoicePool"] if r["id"] == hit.id)
    assert row["suggested"] is True
    assert row["suggestedPaymentIds"] == [txn.id]


# ---------- link / unlink ----------

def test_bank_link_does_not_mutate_business_match_status_or_note(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")

    result = pm.link(db_session, txn_id=txn.id, invoice_id=inv.id, actor="pytest-admin")
    assert result["ok"] is True

    row = db_session.get(TaxInvoiceLink, result["id"])
    assert row.match_method == "manual"
    assert row.confirmed is True
    assert row.allocated_amount == Decimal("1000.0000")

    db_session.refresh(inv)
    assert inv.match_status == "unmatched"
    assert inv.match_note == ""

    log = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "payment_invoice_match.link")
    )
    assert log is not None


def test_link_revives_rejected_link_and_validates_direction(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")

    first = pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)
    link_row = db_session.get(TaxInvoiceLink, first["id"])
    pm.unlink(db_session, link_row.id)
    assert link_row.match_method == "rejected"

    again = pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)
    assert again["id"] == first["id"]  # 同对复活软删行，不新开记录

    income = _txn(db_session, direction="in")
    with pytest.raises(ValueError, match="支出"):
        pm.link(db_session, txn_id=income.id, invoice_id=inv.id)

    output_inv = _invoice(db_session, direction="output")
    with pytest.raises(ValueError, match="进项"):
        pm.link(db_session, txn_id=txn.id, invoice_id=output_inv.id)


def test_unlink_keeps_business_status_untouched_and_rejects_double_unlink(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")
    first = pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)
    link_row = db_session.get(TaxInvoiceLink, first["id"])

    assert pm.unlink(db_session, link_row.id, actor="pytest-admin")["ok"] is True
    db_session.refresh(inv)
    assert inv.match_status == "unmatched"
    assert link_row.match_method == "rejected"
    assert link_row.confirmed is False

    log = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "payment_invoice_match.unlink")
    )
    assert log is not None

    with pytest.raises(ValueError, match="已解除"):
        pm.unlink(db_session, link_row.id)



def test_legacy_bank_link_without_allocated_amount_uses_same_full_amount_everywhere(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")
    db_session.add(TaxInvoiceLink(
        invoice_id=inv.id,
        target_type="bank_transaction",
        target_id=txn.id,
        allocated_amount=None,
        match_method="manual",
        confirmed=True,
    ))
    db_session.commit()

    status = pm.txn_reconciliation_statuses(db_session, [txn.id])[txn.id]
    assert status["status"] == "matched"
    assert status["allocatedAmount"] == "1000.00"
    assert status["remainingAmount"] == "0.00"

    pending_ids = {row["id"] for row in pm.pending_invoices(db_session)}
    assert inv.id not in pending_ids

    # 同一 invoice/txn 的历史 NULL 分摊链接再次确认时，应该复用原 link 并规范化为明确金额，
    # 不能新建重复链接，也不能错误提示“无剩余额度”。
    normalized = pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)
    legacy_link = db_session.get(TaxInvoiceLink, normalized["id"])
    assert legacy_link is not None
    assert legacy_link.allocated_amount == Decimal("1000.0000")
    assert db_session.query(TaxInvoiceLink).filter_by(
        invoice_id=inv.id,
        target_type="bank_transaction",
        target_id=txn.id,
    ).count() == 1

    # 但这笔付款已被完整占用，不能再分摊给另一张发票。
    other = _invoice(db_session, seller="另一供应商", amount="100.00")
    with pytest.raises(ValueError, match="分摊金额必须大于 0"):
        pm.link(db_session, txn_id=txn.id, invoice_id=other.id)



def test_transaction_api_legacy_matched_follows_direction_specific_domain(client, db_session):
    """旧 matched 字段也必须按方向映射，不能让已核对发票的支出继续显示未匹配。"""
    txn = _txn(db_session, amount="321.00", name="兼容字段供应商")
    inv = _invoice(db_session, seller="兼容字段供应商", amount="321.00")
    pm.link(db_session, txn_id=txn.id, invoice_id=inv.id)
    db_session.commit()

    response = client.get(
        "/api/v1/reconciliation/transactions",
        params={
            "direction": "out",
            "start_date": "2026-08-05",
            "end_date": "2026-08-05",
            "q": "兼容字段供应商",
        },
    )
    assert response.status_code == 200
    row = next(item for item in response.json() if item["id"] == txn.id)
    assert row["matched"] is True
    assert row["settlementMatched"] is False
    assert row["settlementMatchStatus"] == "not_applicable"
    assert row["invoicePaymentMatched"] is True
    assert row["invoicePaymentMatchStatus"] == "matched"
    assert row["matchStatus"] == "matched"
    assert row["settlementMatchedAt"] is None
    assert row["invoicePaymentMatchedAt"]
    assert row["matchedAt"] == row["invoicePaymentMatchedAt"]
