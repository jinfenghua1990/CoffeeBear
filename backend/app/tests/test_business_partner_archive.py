from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.models.bank import BankTransaction
from app.models.business_partner import BusinessPartnerLink
from app.models.purchase import ExternalPurchaseOrder, Supplier
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import business_partner_service as service


def _invoice(db_session, *, seller: str, tax_no: str = "", amount: str = "100.00") -> TaxInvoice:
    row = TaxInvoice(
        invoice_key=f"partner-archive|{uuid4().hex}",
        invoice_number=f"PA-{uuid4().hex[:12]}",
        direction="input",
        status="issued",
        issue_date=datetime(2026, 9, 20, tzinfo=timezone.utc),
        seller_name=seller,
        seller_tax_id=tax_no,
        buyer_name="浙江柴本网络科技有限公司",
        total_amount=Decimal(amount),
        raw={},
    )
    db_session.add(row)
    db_session.flush()
    return row


def _bank_txn(db_session, *, name: str, account: str = "", amount: str = "100.00") -> BankTransaction:
    row = BankTransaction(
        txn_date=date(2026, 9, 21),
        direction="out",
        amount=Decimal(amount),
        counterparty_name=name,
        counterparty_account=account,
        serial_no=f"PA-{uuid4().hex[:12]}",
        fingerprint=f"partner-archive|{uuid4().hex}",
        raw={"fields": {"对方户名": name, "对方账号": account}},
    )
    db_session.add(row)
    db_session.flush()
    return row


def test_partner_archive_links_purchase_invoice_and_bank_by_canonical_identity(db_session):
    supplier = Supplier(
        name="归档供应商甲",
        tax_no="91330100PARTNER001",
        bank_account_no="6222 0000 0001",
        bank_account_name="归档供应商甲",
    )
    purchase = ExternalPurchaseOrder(
        external_order_id=f"PA-PO-{uuid4().hex[:10]}",
        platform="1688",
        supplier_name="归档供应商甲",
        order_amount=Decimal("100.00"),
        paid_amount=Decimal("100.00"),
    )
    invoice = _invoice(db_session, seller="归档供应商甲", tax_no="91330100PARTNER001")
    txn = _bank_txn(db_session, name="归档供应商甲", account="622200000001")
    db_session.add_all([supplier, purchase])
    db_session.flush()

    service.sync_business_partners(db_session)
    detail_rows = service.list_partners(db_session, keyword="归档供应商甲")["items"]
    assert len(detail_rows) == 1
    partner_id = detail_rows[0]["id"]
    detail = service.partner_detail(db_session, partner_id)
    assert detail is not None
    assert detail["summary"]["purchaseOrderCount"] == 1
    assert detail["summary"]["invoiceCount"] == 1
    assert detail["summary"]["bankTransactionCount"] == 1
    assert detail["summary"]["bankPaidAmount"] == 100.0
    assert detail["taxNo"] == "91330100PARTNER001"
    assert {row["id"] for row in detail["invoices"]} == {invoice.id}
    assert {row["id"] for row in detail["payments"]} == {txn.id}


def test_similar_legal_name_needs_manual_confirmation_then_becomes_alias(db_session):
    supplier = Supplier(name="义乌市档案注塑厂")
    purchase = ExternalPurchaseOrder(
        external_order_id=f"PA-SAFE-{uuid4().hex[:10]}",
        platform="1688",
        supplier_name="义乌市档案注塑厂",
        order_amount=Decimal("241.92"),
        paid_amount=Decimal("241.92"),
    )
    db_session.add_all([supplier, purchase])
    db_session.flush()
    invoice = _invoice(
        db_session,
        seller="义乌市档案注塑厂（个体工商户）",
        tax_no="92330782PARTNER001",
        amount="241.92",
    )

    service.sync_business_partners(db_session)
    partner = service.list_partners(db_session, keyword="义乌市档案注塑厂")["items"][0]
    detail = service.partner_detail(db_session, partner["id"])
    assert detail is not None
    assert detail["summary"]["invoiceCount"] == 0
    assert len(detail["reviewItems"]) == 1
    review = detail["reviewItems"][0]
    assert review["sourceType"] == "tax_invoice"
    assert review["sourceId"] == invoice.id

    service.claim_review_link(
        db_session,
        partner_id=partner["id"],
        link_id=review["linkId"],
        note="人工确认同一供应商主体",
    )
    detail = service.partner_detail(db_session, partner["id"])
    assert detail is not None
    assert detail["summary"]["invoiceCount"] == 1
    aliases = [item["value"] for item in detail["identifiers"] if item["kind"] == "alias"]
    assert "义乌市档案注塑厂（个体工商户）" in aliases


def test_confirmed_invoice_payment_relation_connects_bank_when_names_differ(db_session):
    supplier = Supplier(name="付款关联供应商", tax_no="91330100PARTNER002")
    db_session.add(supplier)
    db_session.flush()
    invoice = _invoice(db_session, seller="付款关联供应商", tax_no="91330100PARTNER002", amount="3080.00")
    txn = _bank_txn(db_session, name="代付结算主体", account="666576427385", amount="3080.00")
    db_session.add(
        TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type="bank_transaction",
            target_id=txn.id,
            allocated_amount=Decimal("3080.00"),
            match_method="manual",
            confirmed=True,
        )
    )
    db_session.flush()

    service.sync_business_partners(db_session)
    partner = service.list_partners(db_session, keyword="付款关联供应商")["items"][0]
    detail = service.partner_detail(db_session, partner["id"])
    assert detail is not None
    assert detail["summary"]["bankTransactionCount"] == 1
    assert detail["payments"][0]["counterpartyName"] == "代付结算主体"
    link = db_session.query(BusinessPartnerLink).filter_by(
        source_type="bank_transaction", source_id=txn.id, relation_role="counterparty"
    ).one()
    assert link.partner_id == partner["id"]
    assert link.match_method == "invoice_payment_link"


def test_bank_row_without_counterparty_identity_is_skipped(db_session):
    """利息、手续费等没有对方户名和账号的流水不能建档，也不能让同步报错。"""
    txn = _bank_txn(db_session, name="", account="", amount="1.26")
    txn.summary = "利息"
    db_session.flush()

    service.sync_business_partners(db_session)

    assert service.list_partners(db_session)["total"] == 0
    assert (
        db_session.query(BusinessPartnerLink)
        .filter_by(source_type="bank_transaction", source_id=txn.id)
        .count()
        == 0
    )
