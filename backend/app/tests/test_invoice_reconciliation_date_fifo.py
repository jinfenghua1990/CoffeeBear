from datetime import datetime
from decimal import Decimal

from app.models.purchase import ExternalPurchaseOrder
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import invoice_reconciliation
from app.services.invoice_reconciliation import reconcile


SUPPLIER = "日期匹配测试供应商"


def _po(db, no: str, ordered_at: datetime, amount: str):
    row = ExternalPurchaseOrder(
        external_order_id=no,
        platform="other",
        supplier_name=SUPPLIER,
        ordered_at=ordered_at,
        order_amount=Decimal(amount),
        paid_amount=Decimal(amount),
    )
    db.add(row)
    db.flush()
    return row


def _invoice(db, key: str, issue_date: datetime, amount: str):
    row = TaxInvoice(
        invoice_key=key,
        direction="input",
        invoice_number=key,
        status="issued",
        issue_date=issue_date,
        seller_name=SUPPLIER,
        total_amount=Decimal(amount),
    )
    db.add(row)
    db.flush()
    return row


def test_one_invoice_can_cover_multiple_prior_orders_in_order_date_sequence(db_session):
    _po(db_session, "DATE-FIFO-PO-1", datetime(2026, 1, 1, 10, 0), "40")
    _po(db_session, "DATE-FIFO-PO-2", datetime(2026, 1, 10, 10, 0), "60")
    _po(db_session, "DATE-FIFO-PO-3", datetime(2026, 2, 1, 10, 0), "50")
    invoice = _invoice(db_session, "DATE-FIFO-INV-1", datetime(2026, 1, 15, 12, 0), "100")

    result = reconcile(db_session, supplier=SUPPLIER)
    entry = result["suppliers"][0]
    invoices = [item for month in entry["months"] for item in month["invoices"]]
    matched = next(item for item in invoices if item["invoiceId"] == invoice.id)

    assert result["matchingRule"] == "invoice_issue_date_cutoff_then_order_date_fifo"
    assert matched["status"] == "matched"
    assert matched["coveredTotal"] == 100.0
    assert [item["orderNo"] for item in matched["covered"]] == [
        "DATE-FIFO-PO-1",
        "DATE-FIFO-PO-2",
    ]
    assert [item["consumed"] for item in matched["covered"]] == [40.0, 60.0]

    pending_by_no = {item["orderNo"]: item for item in entry["pendingOrders"]}
    assert pending_by_no["DATE-FIFO-PO-3"]["remaining"] == 50.0


def test_invoice_never_consumes_orders_created_after_issue_date(db_session):
    _po(db_session, "DATE-CUTOFF-PO-1", datetime(2026, 3, 1, 10, 0), "40")
    _po(db_session, "DATE-CUTOFF-PO-2", datetime(2026, 3, 10, 10, 0), "60")
    _po(db_session, "DATE-CUTOFF-PO-3", datetime(2026, 4, 1, 10, 0), "50")
    invoice = _invoice(db_session, "DATE-CUTOFF-INV-1", datetime(2026, 3, 5, 12, 0), "100")

    result = reconcile(db_session, supplier=SUPPLIER)
    entry = result["suppliers"][0]
    invoices = [item for month in entry["months"] for item in month["invoices"]]
    matched = next(item for item in invoices if item["invoiceId"] == invoice.id)

    assert matched["status"] == "short"
    assert matched["shortReason"] == "date_cutoff"
    assert matched["futureOrderCount"] == 2
    assert matched["coveredTotal"] == 40.0
    assert [item["orderNo"] for item in matched["covered"]] == ["DATE-CUTOFF-PO-1"]

    pending_by_no = {item["orderNo"]: item for item in entry["pendingOrders"]}
    assert pending_by_no["DATE-CUTOFF-PO-2"]["remaining"] == 60.0
    assert pending_by_no["DATE-CUTOFF-PO-3"]["remaining"] == 50.0

def test_manual_allocation_amount_is_respected_exactly(db_session):
    first = _po(db_session, "MANUAL-PO-1", datetime(2026, 5, 1, 10, 0), "1000")
    second = _po(db_session, "MANUAL-PO-2", datetime(2026, 5, 2, 10, 0), "1000")
    invoice = _invoice(db_session, "MANUAL-INV-1", datetime(2026, 5, 10, 12, 0), "1000")
    db_session.add_all([
        TaxInvoiceLink(
            invoice_id=invoice.id, target_type="external_purchase_order", target_id=first.id,
            allocated_amount=Decimal("300"), match_method="manual", confirmed=True,
        ),
        TaxInvoiceLink(
            invoice_id=invoice.id, target_type="external_purchase_order", target_id=second.id,
            allocated_amount=Decimal("700"), match_method="manual", confirmed=True,
        ),
    ])
    db_session.flush()

    result = reconcile(db_session, supplier=SUPPLIER)
    invoices = [item for month in result["suppliers"][0]["months"] for item in month["invoices"]]
    matched = next(item for item in invoices if item["invoiceId"] == invoice.id)
    assert [item["consumed"] for item in matched["covered"]] == [300.0, 700.0]
    assert matched["status"] == "matched"


def test_supplier_match_does_not_accept_arbitrary_prefix():
    assert invoice_reconciliation.normalize_supplier("河北鸿鲲食品有限公司") == invoice_reconciliation.normalize_supplier("河北鸿鲲食品")
    assert not invoice_reconciliation._matches(
        invoice_reconciliation.normalize_supplier("北京华"),
        invoice_reconciliation.normalize_supplier("北京华贸世纪"),
    )
