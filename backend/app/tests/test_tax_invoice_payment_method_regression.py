from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.models.bank import BankTransaction
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import tax_invoice_service as service


def _invoice(db, direction: str) -> TaxInvoice:
    token = uuid4().hex[:10]
    row = TaxInvoice(
        invoice_key=f"payment-method-{direction}-{token}",
        invoice_number=f"PM-{direction}-{token}",
        direction=direction,
        status="issued",
        total_amount=Decimal("100"),
    )
    db.add(row)
    db.flush()
    return row


def test_output_invoice_payment_method_survives_serialization_and_list(db_session):
    invoice = _invoice(db_session, "output")

    service.set_invoice_payment_methods(
        db_session, [invoice.id], "corporate", actor="pytest"
    )

    db_session.refresh(invoice)
    assert invoice.payment_method == "corporate"
    assert service.serialize_invoice(invoice)["paymentMethod"] == "corporate"

    listed = {
        item["id"]: item
        for item in service.list_invoices(db_session, direction="output", limit=500)
    }
    assert listed[invoice.id]["paymentMethod"] == "corporate"


def test_input_invoice_payment_method_is_derived_from_bank_link(db_session):
    invoice = _invoice(db_session, "input")
    txn = BankTransaction(
        txn_date=date(2026, 9, 1),
        direction="out",
        amount=Decimal("100"),
        counterparty_name="支付方式测试供应商",
        fingerprint=f"payment-method-{uuid4().hex}",
    )
    db_session.add(txn)
    db_session.flush()
    db_session.add(
        TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type="bank_transaction",
            target_id=txn.id,
            allocated_amount=Decimal("100"),
            match_method="manual",
            confirmed=True,
        )
    )
    db_session.commit()

    listed = {
        item["id"]: item
        for item in service.list_invoices(db_session, direction="input", limit=500)
    }
    assert listed[invoice.id]["paymentMethod"] == "corporate"

    link = db_session.query(TaxInvoiceLink).filter_by(
        invoice_id=invoice.id, target_type="bank_transaction"
    ).one()
    link.match_method = "rejected"
    db_session.commit()

    listed = {
        item["id"]: item
        for item in service.list_invoices(db_session, direction="input", limit=500)
    }
    assert listed[invoice.id]["paymentMethod"] == "personal"
