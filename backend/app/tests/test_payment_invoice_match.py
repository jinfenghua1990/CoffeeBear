"""付款↔发票匹配标记清单（财务月度资料）服务层测试。

覆盖：overview 按月/方向过滤、matched/partial/unmatched 状态推导、
金额封顶、发票池统计、同名同金额建议、link 落库与状态推进、
软删复活、方向校验、unlink 恢复状态与审计日志。
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

def test_link_sets_invoice_status_and_note(db_session):
    txn = _txn(db_session, amount="1000.00")
    inv = _invoice(db_session, amount="1000.00")

    result = pm.link(db_session, txn_id=txn.id, invoice_id=inv.id, actor="pytest-admin")
    assert result["ok"] is True

    row = db_session.get(TaxInvoiceLink, result["id"])
    assert row.match_method == "manual"
    assert row.confirmed is True
    assert row.allocated_amount == Decimal("1000.0000")

    db_session.refresh(inv)
    assert inv.match_status == "matched"
    assert "银行付款" in inv.match_note

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


def test_unlink_restores_status_and_rejects_double_unlink(db_session):
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
