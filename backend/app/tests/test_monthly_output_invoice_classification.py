"""销项按开票月分类汇总，与订单下单月独立；税局信息汇总表必须可识别。"""
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from uuid import uuid4
from zoneinfo import ZoneInfo

from openpyxl import Workbook

from app.config import settings
from app.models.catalog import ProductSku
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.tax import TaxInvoice, TaxInvoiceImportRecord
from app.services import finance_sales_report_service as finance
from app.services import tax_invoice_service as tax


GOODS_CODE = "1030307060000000000"
SERVICE_CODE = "3040203000000000000"
COMPANY = "浙江柴本网络科技有限公司"


def _tax_export_bytes(*, invoice_specs):
    """模拟税局导出：发票头在基础信息，项目和税收编码在信息汇总表。"""
    workbook = Workbook()
    summary = workbook.active
    summary.title = "信息汇总表"
    summary.append([
        "序号", "数电发票号码", "销方识别号", "销方名称", "购方识别号",
        "购买方名称", "开票日期", "税收分类编码", "货物或应税劳务名称",
        "金额", "税额", "价税合计",
    ])
    base = workbook.create_sheet("发票基础信息")
    base.append([
        "序号", "数电发票号码", "销方识别号", "销方名称", "购方识别号",
        "购买方名称", "开票日期", "金额", "税额", "价税合计",
        "发票状态", "是否正数发票",
    ])
    for i, (invoice_no, lines) in enumerate(invoice_specs, start=1):
        total = sum((amount for _, _, amount in lines), Decimal("0"))
        base.append([i, invoice_no, "91330000000000001X", COMPANY, "91330100123456789X",
                     "示例客户", "2097-10-13", float(total), 0, float(total), "正常", "是"])
        for code, name, amount in lines:
            summary.append([i, invoice_no, "91330000000000001X", COMPANY,
                            "91330100123456789X", "示例客户", "2097-10-13",
                            code, name, float(amount), 0, float(amount)])
    summary.append(["合计行", None, None, None, None, None, None, None, None,
                    float(sum((sum((v for _, _, v in lines), Decimal("0")) for _, lines in invoice_specs), Decimal("0"))), 0, None])
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def test_official_summary_sheet_auto_classifies_goods_and_services(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(tax.settings, "DATA_DIR", str(tmp_path))
    token = uuid4().hex[:10]
    goods_no = f"GOOD-{token}"
    service_no = f"SERVICE-{token}"
    payload = _tax_export_bytes(invoice_specs=[
        (goods_no, [(GOODS_CODE, "*软饮料*咖啡", Decimal("80.00"))]),
        (service_no, [(SERVICE_CODE, "*生产生活服务*信息技术服务费", Decimal("20.00"))]),
    ])
    batch, duplicate = tax.import_export(
        db_session, content=payload, original_name=f"category-{token}.xlsx",
        actor="test", auto_confirm=True,
    )
    assert not duplicate
    assert batch.row_count == 2
    goods = db_session.query(TaxInvoice).filter_by(invoice_number=goods_no).one()
    service = db_session.query(TaxInvoice).filter_by(invoice_number=service_no).one()
    assert goods.direction == service.direction == "output"
    assert goods.category == "buyer_sales"
    assert service.category == "platform_service"
    lines = tax.invoice_detail_lines(db_session, goods.id)["items"]
    assert lines[0]["taxCode"] == GOODS_CODE
    assert db_session.query(TaxInvoiceImportRecord).filter_by(import_id=batch.id, recognition_status="detail").count() == 2
    report = finance.build_unbilled_income_report(db_session, 2097, 10, company=COMPANY)
    assert report["salesAmount"] == "0.00"
    assert report["invoicedAmount"] == "80.00"
    assert report["serviceInvoiceAmount"] == "20.00"
    assert report["unbilledAmount"] == "-80.00"


def test_mixed_invoice_splits_goods_and_services_without_order_links(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(tax.settings, "DATA_DIR", str(tmp_path))
    token = uuid4().hex[:10]
    number = f"MIXED-{token}"
    payload = _tax_export_bytes(invoice_specs=[(
        number, [
            (GOODS_CODE, "*软饮料*咖啡", Decimal("80.00")),
            (SERVICE_CODE, "*生产生活服务*信息技术服务费", Decimal("20.00")),
        ],
    )])
    tax.import_export(
        db_session, content=payload, original_name=f"mixed-{token}.xlsx",
        actor="test", auto_confirm=True,
    )
    invoice = db_session.query(TaxInvoice).filter_by(invoice_number=number).one()
    assert invoice.category == ""  # 整票混合：按明细拆分，不能强行整票归一类
    report = finance.build_unbilled_income_report(db_session, 2097, 10, company=COMPANY)
    assert report["invoicedAmount"] == "80.00"
    assert report["serviceInvoiceAmount"] == "20.00"
    assert report["pendingInvoiceAmount"] == "0.00"
    assert report["unbilledAmount"] == "-80.00"


def test_independent_sales_and_invoice_months_with_entity_filter(db_session):
    company = f"示例经营主体-{uuid4().hex[:8]}"
    tz = ZoneInfo(settings.TZ)
    sku = ProductSku(
        jackyun_sku_id=f"sku-{uuid4().hex}", sku_code=f"COFFEE-{uuid4().hex[:8]}",
        sku_name="咖啡", tax_code=GOODS_CODE,
    )
    order = SalesOrder(
        order_no=f"SALE-{uuid4().hex}", order_status="已完成",
        paid_amount=Decimal("200.00"),
        ordered_at=datetime(2096, 10, 5, 9, 0, tzinfo=tz),
    )
    db_session.add_all([sku, order])
    db_session.flush()
    db_session.add(SalesOrderItem(
        order_id=order.id, sku_id=sku.id, sku_code=sku.sku_code,
        goods_name="咖啡", quantity=Decimal("1"), amount=Decimal("200.00"),
    ))

    def invoice(tag, *, month, amount, category, seller=company, code=GOODS_CODE):
        return TaxInvoice(
            invoice_key=f"{tag}-{uuid4().hex}", invoice_number=f"{tag}-{uuid4().hex[:10]}",
            source_system="tax_export", direction="output", status="issued",
            issue_date=datetime(2096, month, 12, 9, 0, tzinfo=tz),
            seller_name=seller, category=category, total_amount=Decimal(str(amount)),
            raw={} if tag == "unclassified" else {
                "货物或应税劳务名称": "*软饮料*咖啡" if code == GOODS_CODE else "*生产生活服务*信息技术服务费",
                "税收分类编码": code, "价税合计": str(amount),
            },
        )

    db_session.add_all([
        invoice("goods", month=10, amount="70.00", category="buyer_sales"),
        invoice("service", month=10, amount="30.00", category="platform_service", code=SERVICE_CODE),
        invoice("unclassified", month=10, amount="9.00", category=""),
        invoice("other-owner", month=10, amount="20.00", category="buyer_sales", seller="其他公司"),
        invoice("cross-month", month=11, amount="50.00", category="buyer_sales"),
    ])
    db_session.commit()
    october = finance.build_unbilled_income_report(db_session, 2096, 10, company=company)
    assert october["salesAmount"] == "200.00"
    assert october["invoicedAmount"] == "70.00"
    assert october["serviceInvoiceAmount"] == "30.00"
    assert october["unbilledAmount"] == "130.00"
    november = finance.build_unbilled_income_report(db_session, 2096, 11, company=company)
    assert november["salesAmount"] == "0.00"
    assert november["invoicedAmount"] == "50.00"
    assert november["unbilledAmount"] == "-50.00"
    assert any(row["product"].startswith("本月商品已开票") for row in november["details"])


def test_cross_month_red_invoice_affects_its_own_invoice_month_only(db_session):
    tz = ZoneInfo(settings.TZ)
    company = f"示例公司-{uuid4().hex[:8]}"
    key = uuid4().hex[:10]
    blue = TaxInvoice(
        invoice_key=f"BLUE-{key}", invoice_number=f"BLUE-{key}",
        source_system="tax_export", direction="output", status="issued",
        issue_date=datetime(2095, 10, 10, tzinfo=tz),
        seller_name=company, category="buyer_sales",
        total_amount=Decimal("70.00"), raw={"是否正数发票": "是"},
    )
    red = TaxInvoice(
        invoice_key=f"RED-{key}", invoice_number=f"RED-{key}",
        source_system="tax_export", direction="output", status="red",
        issue_date=datetime(2095, 11, 11, tzinfo=tz),
        seller_name=company, total_amount=Decimal("-20.00"),
        raw={"是否正数发票": "否", "备注": f"被红冲蓝字发票号码：{blue.invoice_number}"},
    )
    db_session.add_all([blue, red])
    db_session.commit()
    october = finance.build_unbilled_income_report(db_session, 2095, 10, company=company)
    november = finance.build_unbilled_income_report(db_session, 2095, 11, company=company)
    assert october["invoicedAmount"] == "70.00"
    assert october["unbilledAmount"] == "-70.00"
    assert november["invoicedAmount"] == "-20.00"
    assert november["unbilledAmount"] == "20.00"
    assert november["redSalesAdjustmentAmount"] == "0.00"
