from datetime import date, datetime
from decimal import Decimal

import pytest

from app.models.bank import BankTransaction
from app.models.finance import ArchiveFile, FinanceDeliveryFile, FinanceDeliveryPackage, MonthlyFinancePeriod
from app.models.purchase import ExternalPurchaseOrder, PurchaseInvoice, PurchaseInvoiceLink
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import finance_service, purchase_service, tax_invoice_service
from app.services.consumable_service import _coverage_metrics
from app.services.payment_invoice_match_service import (
    _split_match_invoice_to_txns,
    _split_match_txn_to_invoices,
)


def test_consumable_coverage_uses_consumable_units():
    support, coverage, gap = _coverage_metrics(
        Decimal("1000"),
        Decimal("1000"),
        Decimal("2"),
    )
    assert support == Decimal("500")
    assert coverage == Decimal("100")
    assert gap == Decimal("0")


def test_sent_finance_package_cannot_be_deleted(db_session):
    period = MonthlyFinancePeriod(
        company="pytest-company",
        period_year=2026,
        period_month=8,
        status="SENT",
    )
    db_session.add(period)
    db_session.flush()
    package = FinanceDeliveryPackage(period_id=period.id, version=1, status="SENT")
    db_session.add(package)
    db_session.flush()

    with pytest.raises(ValueError, match="禁止删除"):
        finance_service.delete_delivery_package(db_session, package.id)


def test_archive_used_by_delivery_package_cannot_be_deleted(db_session):
    period = MonthlyFinancePeriod(
        company="pytest-company",
        period_year=2026,
        period_month=8,
        status="PACKAGED",
    )
    db_session.add(period)
    db_session.flush()
    archive = ArchiveFile(
        company="pytest-company",
        category="bank",
        original_name="test.xlsx",
        stored_path="/tmp/not-used-because-delete-is-blocked.xlsx",
        sha256="a" * 64,
        period_year=2026,
        period_month=8,
        version=1,
    )
    db_session.add(archive)
    db_session.flush()
    package = FinanceDeliveryPackage(period_id=period.id, version=1, status="PACKAGED")
    db_session.add(package)
    db_session.flush()
    db_session.add(FinanceDeliveryFile(package_id=package.id, archive_file_id=archive.id))
    db_session.flush()

    with pytest.raises(ValueError, match="已被财务交付包引用"):
        finance_service.delete_archive_file(db_session, archive.id)


def test_purchase_invoice_cumulative_order_limit(db_session):
    po = ExternalPurchaseOrder(
        external_order_id="AUDIT-PO-100",
        platform="other",
        paid_amount=Decimal("100"),
        order_amount=Decimal("100"),
    )
    invoice_a = PurchaseInvoice(invoice_no="AUDIT-A", invoice_amount=Decimal("100"))
    invoice_b = PurchaseInvoice(invoice_no="AUDIT-B", invoice_amount=Decimal("100"))
    db_session.add_all([po, invoice_a, invoice_b])
    db_session.flush()
    db_session.add(PurchaseInvoiceLink(invoice_id=invoice_a.id, po_id=po.id, allocated_amount=Decimal("80")))
    db_session.flush()

    with pytest.raises(ValueError, match="累计发票分摊"):
        purchase_service.link_invoice(db_session, invoice_b, po, Decimal("30"))


def test_tax_invoice_cumulative_invoice_limit(db_session):
    po1 = ExternalPurchaseOrder(
        external_order_id="AUDIT-TAX-PO-1",
        platform="other",
        paid_amount=Decimal("100"),
        order_amount=Decimal("100"),
    )
    po2 = ExternalPurchaseOrder(
        external_order_id="AUDIT-TAX-PO-2",
        platform="other",
        paid_amount=Decimal("100"),
        order_amount=Decimal("100"),
    )
    invoice = TaxInvoice(
        invoice_key="AUDIT-TAX-INV-1",
        direction="input",
        invoice_number="AUDIT-TAX-INV-1",
        total_amount=Decimal("100"),
    )
    db_session.add_all([po1, po2, invoice])
    db_session.flush()
    db_session.add(
        TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type="external_purchase_order",
            target_id=po1.id,
            allocated_amount=Decimal("80"),
            match_method="manual",
            confirmed=True,
        )
    )
    db_session.flush()

    with pytest.raises(ValueError, match="超过票面金额"):
        tax_invoice_service.link_purchase_order(
            db_session,
            invoice_id=invoice.id,
            target_type="external_purchase_order",
            target_id=po2.id,
            allocated_amount=Decimal("30"),
        )


def test_bank_split_allocation_is_independent_of_business_match_status(db_session):
    txn1 = BankTransaction(
        txn_date=date(2026, 8, 1),
        direction="out",
        amount=Decimal("5000"),
        counterparty_name="测试供应商",
        fingerprint="audit-payment-1",
    )
    txn2 = BankTransaction(
        txn_date=date(2026, 8, 2),
        direction="out",
        amount=Decimal("1080"),
        counterparty_name="测试供应商",
        fingerprint="audit-payment-2",
    )
    inv1 = TaxInvoice(
        invoice_key="AUDIT-PAY-INV-1",
        direction="input",
        invoice_number="AUDIT-PAY-INV-1",
        issue_date=datetime(2026, 8, 1),
        seller_name="测试供应商",
        total_amount=Decimal("3080"),
        status="issued",
        match_status="unmatched",
    )
    inv2 = TaxInvoice(
        invoice_key="AUDIT-PAY-INV-2",
        direction="input",
        invoice_number="AUDIT-PAY-INV-2",
        issue_date=datetime(2026, 8, 1),
        seller_name="测试供应商",
        total_amount=Decimal("3000"),
        status="issued",
        match_status="unmatched",
    )
    db_session.add_all([txn1, txn2, inv1, inv2])
    db_session.flush()

    count, allocated = _split_match_txn_to_invoices(db_session, txn1, [inv1, inv2], "pytest")
    assert count == 2
    assert allocated == Decimal("5000.0000")
    assert inv1.match_status == "unmatched"
    assert inv2.match_status == "unmatched"

    count2, allocated2 = _split_match_invoice_to_txns(db_session, inv2, [txn2], "pytest")
    assert count2 == 1
    assert allocated2 == Decimal("3000.0000")
    assert inv2.match_status == "unmatched"


def test_unlink_purchase_recalculates_only_business_domain(db_session):
    po1 = ExternalPurchaseOrder(
        external_order_id="AUDIT-UNLINK-PO-1",
        platform="other",
        paid_amount=Decimal("60"),
        order_amount=Decimal("60"),
    )
    po2 = ExternalPurchaseOrder(
        external_order_id="AUDIT-UNLINK-PO-2",
        platform="other",
        paid_amount=Decimal("40"),
        order_amount=Decimal("40"),
    )
    invoice = TaxInvoice(
        invoice_key="AUDIT-UNLINK-INV",
        direction="input",
        invoice_number="AUDIT-UNLINK-INV",
        status="issued",
        total_amount=Decimal("100"),
        match_status="unmatched",
    )
    txn = BankTransaction(
        txn_date=date(2026, 8, 3),
        direction="out",
        amount=Decimal("100"),
        counterparty_name="测试供应商",
        fingerprint="audit-unlink-bank",
    )
    db_session.add_all([po1, po2, invoice, txn])
    db_session.flush()

    first = tax_invoice_service.link_purchase_order(
        db_session,
        invoice_id=invoice.id,
        target_type="external_purchase_order",
        target_id=po1.id,
        allocated_amount=Decimal("60"),
    )
    second = tax_invoice_service.link_purchase_order(
        db_session,
        invoice_id=invoice.id,
        target_type="external_purchase_order",
        target_id=po2.id,
        allocated_amount=Decimal("40"),
    )
    db_session.refresh(invoice)
    assert invoice.match_status == "matched"

    # 银行链接存在也不能让采购匹配状态继续保持 matched。
    db_session.add(TaxInvoiceLink(
        invoice_id=invoice.id,
        target_type="bank_transaction",
        target_id=txn.id,
        allocated_amount=Decimal("100"),
        match_method="manual",
        confirmed=True,
    ))
    db_session.commit()

    tax_invoice_service.unlink_purchase(db_session, second["id"], actor="pytest")
    db_session.refresh(invoice)
    assert invoice.match_status == "unmatched"

    active_purchase = db_session.query(TaxInvoiceLink).filter(
        TaxInvoiceLink.invoice_id == invoice.id,
        TaxInvoiceLink.target_type == "external_purchase_order",
        TaxInvoiceLink.match_method != "rejected",
    ).all()
    assert sum((row.allocated_amount for row in active_purchase), Decimal("0")) == Decimal("60")
    assert first["id"] == active_purchase[0].id
