"""月度已收票对公付款清单。"""
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from uuid import uuid4

from openpyxl import load_workbook

from app.models.bank import BankAccount, BankTransaction
from app.models.purchase import ExternalPurchaseOrder, PurchaseAllocationItem, Supplier
from app.models.tax import TaxInvoice, TaxInvoiceLink
from app.services import finance_corporate_payment_report_service as service


def test_build_report_links_bank_invoice_purchase_and_product(db_session):
    token = uuid4().hex[:10]
    seller = f"测试供应商-{token}"
    company = f"测试公司-{token}"

    account = BankAccount(
        account_no=f"ACCT-{token}",
        account_name=company,
        bank_name="测试银行",
        currency="CNY",
    )
    db_session.add(account)
    db_session.flush()

    supplier = Supplier(
        platform="other",
        external_shop_id=f"SUP-{token}",
        name=seller,
        tax_no=f"TAX-{token}",
    )
    db_session.add(supplier)

    po = ExternalPurchaseOrder(
        external_order_id=f"PO-{token}",
        platform="1688",
        supplier_name=seller,
        ordered_at=datetime(2026, 8, 2, tzinfo=timezone.utc),
        order_amount=Decimal("1000.00"),
        paid_amount=Decimal("1000.00"),
        currency="CNY",
        order_status="paid",
        pay_status="paid",
        raw={},
    )
    db_session.add(po)
    db_session.flush()

    item = PurchaseAllocationItem(
        po_id=po.id,
        sku_code=f"SKU-{token}",
        goods_name="测试商品",
        quantity=Decimal("10"),
        unit_price=Decimal("100"),
        amount=Decimal("1000"),
        source="manual",
    )
    db_session.add(item)

    txn = BankTransaction(
        account_id=account.id,
        txn_date=date(2026, 8, 15),
        direction="out",
        amount=Decimal("1000.00"),
        counterparty_name=seller,
        counterparty_account=f"CP-{token}",
        summary="采购货款",
        voucher_no=f"V-{token}",
        fingerprint=f"pytest-corp-pay-{token}",
        raw={},
    )
    db_session.add(txn)

    invoice = TaxInvoice(
        invoice_key=f"pytest-corp-pay-{token}",
        invoice_number=f"INV-{token}",
        direction="input",
        status="issued",
        issue_date=datetime(2026, 8, 10, tzinfo=timezone.utc),
        seller_name=seller,
        seller_tax_id=f"TAX-{token}",
        buyer_name=company,
        amount_excl_tax=Decimal("884.96"),
        tax_amount=Decimal("115.04"),
        total_amount=Decimal("1000.00"),
        source_system="tax_export",
        raw={},
    )
    db_session.add(invoice)
    db_session.flush()

    db_session.add(TaxInvoiceLink(
        invoice_id=invoice.id,
        target_type="bank_transaction",
        target_id=txn.id,
        allocated_amount=Decimal("1000.00"),
        match_method="manual",
        confirmed=True,
        note="pytest",
    ))
    db_session.commit()

    report = service.build_report(db_session, 2026, 8, company=company)

    assert report["summary"]["paymentCount"] == 1
    assert report["summary"]["invoiceCount"] == 1
    assert Decimal(report["summary"]["allocatedTotal"]) == Decimal("1000.00")
    assert report["invoiceRows"][0]["invoiceNumber"] == invoice.invoice_number
    assert report["invoiceRows"][0]["payments"][0]["voucherNo"] == txn.voucher_no
    assert po.external_order_id in report["invoiceRows"][0]["purchaseOrderNos"]
    assert report["productDetails"][0]["skuCode"] == item.sku_code
    assert Decimal(report["productDetails"][0]["unitPrice"]) == Decimal("100")

    blob = service.corporate_payment_xlsx(report)
    wb = load_workbook(BytesIO(blob), read_only=True)
    assert wb.sheetnames == ["月度汇总", "已收票对公核对", "商品明细"]
    assert wb["已收票对公核对"]["D2"].value == invoice.invoice_number
    assert wb["商品明细"]["G2"].value == item.sku_code


def test_report_keeps_received_invoice_even_when_bank_link_is_unconfirmed(db_session):
    token = uuid4().hex[:10]
    seller = f"未确认供应商-{token}"

    txn = BankTransaction(
        txn_date=date(2026, 8, 5),
        direction="out",
        amount=Decimal("300.00"),
        counterparty_name=seller,
        fingerprint=f"pytest-corp-unconfirmed-{token}",
        raw={},
    )
    db_session.add(txn)
    invoice = TaxInvoice(
        invoice_key=f"pytest-corp-unconfirmed-{token}",
        invoice_number=f"INV-U-{token}",
        direction="input",
        status="issued",
        issue_date=datetime(2026, 8, 3, tzinfo=timezone.utc),
        seller_name=seller,
        total_amount=Decimal("300.00"),
        source_system="tax_export",
        raw={},
    )
    db_session.add(invoice)
    db_session.flush()
    db_session.add(TaxInvoiceLink(
        invoice_id=invoice.id,
        target_type="bank_transaction",
        target_id=txn.id,
        allocated_amount=Decimal("300.00"),
        match_method="manual",
        confirmed=False,
    ))
    db_session.commit()

    report = service.build_report(db_session, 2026, 8)

    assert [row["invoiceId"] for row in report["invoiceRows"]] == [invoice.id]
    assert report["invoiceRows"][0]["invoiceStatus"] == "unpaid"
    assert report["invoiceRows"][0]["payments"] == []
    assert Decimal(report["summary"]["invoiceTotal"]) == Decimal("300.00")
    assert Decimal(report["summary"]["outstandingTotal"]) == Decimal("300.00")


def test_corporate_payment_xlsx_keeps_one_row_per_invoice_with_multiple_payments():
    report = {
        "summary": {
            "paymentCount": 2,
            "invoiceCount": 1,
            "paymentTotal": "1000.00",
            "allocatedTotal": "1000.00",
            "invoiceTotal": "1000.00",
            "outstandingTotal": "0.00",
            "paidInvoiceCount": 1,
            "partialInvoiceCount": 0,
            "unpaidInvoiceCount": 0,
            "productRowCount": 0,
        },
        "invoiceRows": [
            {
                "invoiceId": 1,
                "invoiceDate": "2026-08-10",
                "supplierName": "供应商甲",
                "supplierTaxId": "TAX-A",
                "invoiceNumber": "INV-A",
                "invoiceType": "增值税专用发票",
                "invoiceAmountExclTax": "884.96",
                "invoiceTaxAmount": "115.04",
                "invoiceTotalAmount": "1000.00",
                "invoiceCorporatePaidTotal": "1000.00",
                "invoiceOutstandingAmount": "0.00",
                "invoiceStatus": "paid",
                "purchaseOrderNos": ["PO-A", "PO-B"],
                "payments": [
                    {
                        "linkId": 10,
                        "paymentId": 20,
                        "paymentDate": "2026-08-15",
                        "paymentAccount": "ZJRC-001",
                        "paymentAccountName": "测试账户",
                        "counterpartyAccount": "CP-001",
                        "voucherNo": "V-001",
                        "summary": "货款",
                        "paymentAmount": "400.00",
                        "allocatedAmount": "400.00",
                        "paymentMatchedTotal": "400.00",
                        "paymentStatus": "matched",
                    },
                    {
                        "linkId": 11,
                        "paymentId": 21,
                        "paymentDate": "2026-08-20",
                        "paymentAccount": "ZJRC-001",
                        "paymentAccountName": "测试账户",
                        "counterpartyAccount": "CP-001",
                        "voucherNo": "V-002",
                        "summary": "货款",
                        "paymentAmount": "600.00",
                        "allocatedAmount": "600.00",
                        "paymentMatchedTotal": "600.00",
                        "paymentStatus": "matched",
                    },
                ],
            }
        ],
        "rows": [],
        "productDetails": [],
    }

    wb = load_workbook(BytesIO(service.corporate_payment_xlsx(report)), read_only=True)
    ws = wb["已收票对公核对"]

    assert ws.max_row == 2
    assert ws["D2"].value == "INV-A"
    assert ws["H2"].value == 1000
    assert ws["I2"].value == 1000
    assert ws["J2"].value == 0
    assert ws["L2"].value == "2026-08-15、2026-08-20"
    assert ws["N2"].value == "V-001、V-002"
    assert ws["P2"].value == "PO-A、PO-B"


def test_negative_red_invoice_is_not_misclassified_as_bank_reconciled(db_session):
    """红字负数票保留在月度财务清单，但绝不能因为 outstanding 被截成 0 就显示已核对。"""
    token = uuid4().hex[:10]
    invoice = TaxInvoice(
        invoice_key=f"pytest-corp-red-{token}",
        invoice_number=f"INV-RED-{token}",
        direction="input",
        status="red",
        issue_date=datetime(2026, 7, 8, tzinfo=timezone.utc),
        seller_name=f"红冲供应商-{token}",
        amount_excl_tax=Decimal("-1343.36"),
        tax_amount=Decimal("-174.64"),
        total_amount=Decimal("-1518.00"),
        source_system="tax_export",
        raw={},
    )
    db_session.add(invoice)
    db_session.commit()

    report = service.build_report(db_session, 2026, 7)
    row = next(item for item in report["invoiceRows"] if item["invoiceId"] == invoice.id)

    assert row["invoiceTotalAmount"] == "-1518.00"
    assert row["invoiceCorporatePaidTotal"] == "0"
    assert row["invoiceOutstandingAmount"] == "0"
    assert row["invoiceStatus"] == "not_applicable"
    assert row["bankReconciliationStatus"] == "not_applicable"
    assert row["bankReconciliationApplicable"] is False
    assert "不参与银行付款核对" in row["bankReconciliationReason"]
    assert row["payments"] == []

    assert report["summary"]["paidInvoiceCount"] == 0
    assert report["summary"]["partialInvoiceCount"] == 0
    assert report["summary"]["unpaidInvoiceCount"] == 0
    assert report["summary"]["notApplicableInvoiceCount"] == 1
    assert Decimal(report["summary"]["outstandingTotal"]) == Decimal("0")

    wb = load_workbook(BytesIO(service.corporate_payment_xlsx(report)), read_only=True)
    assert wb["已收票对公核对"]["K2"].value == "无需核对银行付款"


def test_small_positive_invoice_without_payment_stays_unpaid(db_session):
    """状态不能仅由“剩余金额落入容差”决定；没有银行付款就绝不能显示已核对。"""
    token = uuid4().hex[:10]
    invoice = TaxInvoice(
        invoice_key=f"pytest-corp-small-{token}",
        invoice_number=f"INV-SMALL-{token}",
        direction="input",
        status="issued",
        issue_date=datetime(2026, 7, 9, tzinfo=timezone.utc),
        seller_name=f"小额供应商-{token}",
        total_amount=Decimal("0.03"),
        source_system="tax_export",
        raw={},
    )
    db_session.add(invoice)
    db_session.commit()

    report = service.build_report(db_session, 2026, 7)
    row = next(item for item in report["invoiceRows"] if item["invoiceId"] == invoice.id)

    assert row["bankReconciliationApplicable"] is True
    assert row["bankReconciliationStatus"] == "unpaid"
    assert row["invoiceCorporatePaidTotal"] == "0"
    assert Decimal(row["invoiceOutstandingAmount"]) == Decimal("0.03")
    assert report["summary"]["paidInvoiceCount"] == 0
    assert report["summary"]["unpaidInvoiceCount"] == 1
