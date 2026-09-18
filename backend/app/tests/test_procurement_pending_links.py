from decimal import Decimal

from app.models.purchase import ExternalPurchaseOrder
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services.procurement_chain_service import list_pending


def test_pending_invoice_for_workflow_only_order_uses_negative_workbench_id(db_session):
    po = ExternalPurchaseOrder(
        external_order_id="PDD-PENDING-001",
        platform="pdd",
        supplier_name="待确认供应商",
        paid_amount=Decimal("100"),
    )
    invoice = TaxInvoice(
        invoice_key="PENDING-INV-001",
        direction="input",
        invoice_number="PENDING-INV-001",
        status="issued",
        seller_name="待确认供应商",
        total_amount=Decimal("100"),
    )
    db_session.add_all([po, invoice])
    db_session.flush()
    db_session.add(
        TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type="external_purchase_order",
            target_id=po.id,
            allocated_amount=Decimal("100"),
            match_method="auto",
            confirmed=False,
        )
    )
    db_session.flush()

    result = list_pending(db_session)

    item = next(row for row in result["items"] if row["orderNo"] == "PDD-PENDING-001")
    assert item["kind"] == "invoice"
    assert item["orderId"] == -po.id
    assert item["orderNo"] == "PDD-PENDING-001"
