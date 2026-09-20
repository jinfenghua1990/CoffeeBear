from decimal import Decimal

import pytest

from app.adapters.tax_invoice_file import parse_tax_invoice_export
from app.services import tax_invoice_service as service
from uuid import uuid4


CSV = """税务系统发票清单
发票号码,发票代码,开票日期,销售方名称,销售方识别号,购买方名称,购买方识别号,金额,税额,价税合计,发票状态,进销项,关联订单号
INV-001, CODE-1,2026-09-01,供应商甲,91330000000000001A,本公司,91330000000000002B,100,13,113,正常,进项,PO-001
INV-002,CODE-2,2026-09-02,本公司,91330000000000002B,客户乙,91330000000000003C,200,26,226,正常,销项,
"""


def test_tax_export_auto_detects_fields_and_direction():
    parsed = parse_tax_invoice_export(CSV.encode(), "tax-list.csv", max_rows=100)

    assert parsed.sheet_name == "CSV"
    assert parsed.mapping["invoice_number"] == "发票号码"
    assert parsed.mapping["total_amount"] == "价税合计"
    assert parsed.direction_hint == "unknown"
    assert len(parsed.rows) == 2


def test_tax_import_normalizes_rows_is_idempotent_and_links_explicit_order(
    db_session, monkeypatch, tmp_path
):
    from app.models.purchase import ExternalPurchaseOrder
    from app.models.tax import TaxInvoice, TaxInvoiceImport, TaxInvoiceImportRecord, TaxInvoiceLink

    monkeypatch.setattr(service.settings, "DATA_DIR", str(tmp_path))
    token = uuid4().hex[:10]
    order_no = f"PO-TEST-{token}"
    invoice_1 = f"INV-TEST-A-{token}"
    invoice_2 = f"INV-TEST-B-{token}"
    content = CSV.replace("PO-001", order_no).replace("INV-001", invoice_1).replace("INV-002", invoice_2).encode()
    baseline_invoices = db_session.query(TaxInvoice).count()
    po = ExternalPurchaseOrder(external_order_id=order_no, paid_amount="113")
    db_session.add(po)
    db_session.commit()

    batch, duplicate = service.import_export(
        db_session,
        content=content,
        original_name="tax-list.csv",
        actor="pytest",
        period_year=2026,
        period_month=9,
    )
    same_batch, same_duplicate = service.import_export(
        db_session,
        content=content,
        original_name="tax-list.csv",
        actor="pytest",
    )

    assert duplicate is False
    assert same_duplicate is True
    assert same_batch.id == batch.id
    assert batch.row_count == 2
    assert batch.recognized_row_count == 2
    assert batch.needs_review_count == 0
    assert db_session.query(TaxInvoice).count() == baseline_invoices + 2
    assert db_session.query(TaxInvoiceImport).filter_by(id=batch.id).one().status == "parsed"
    assert db_session.query(TaxInvoiceImportRecord).filter_by(import_id=batch.id).count() == 2
    invoice = db_session.query(TaxInvoice).filter_by(invoice_number=invoice_1).one()
    assert invoice.direction == "input"
    assert invoice.status == "issued"
    assert str(invoice.total_amount) == "113.0000"
    assert invoice.match_status == "matched"
    assert db_session.query(TaxInvoiceLink).filter_by(invoice_id=invoice.id).count() == 1

    db_session.query(TaxInvoiceLink).filter_by(invoice_id=invoice.id).delete()
    db_session.query(TaxInvoiceImportRecord).filter_by(import_id=batch.id).delete()
    db_session.query(TaxInvoice).filter(TaxInvoice.id.in_((
        row.id for row in db_session.query(TaxInvoice).filter_by(source_import_id=batch.id).all()
    ))).delete(synchronize_session=False)
    db_session.delete(batch)
    db_session.delete(po)
    db_session.commit()


def test_tax_import_keeps_unrecognized_row_for_review(db_session, monkeypatch, tmp_path):
    from app.models.tax import TaxInvoice, TaxInvoiceImportRecord

    monkeypatch.setattr(service.settings, "DATA_DIR", str(tmp_path))
    content = "发票号码,开票日期,价税合计\nINV-003,,\n".encode()
    batch, _ = service.import_export(
        db_session, content=content, original_name="needs-review.csv", actor="pytest"
    )

    assert batch.status == "needs_review"
    assert batch.recognized_row_count == 0
    assert batch.needs_review_count == 1
    row = db_session.query(TaxInvoiceImportRecord).filter_by(import_id=batch.id).one()
    assert row.recognition_status == "needs_review"
    assert row.invoice_id is None
    assert db_session.query(TaxInvoice).filter_by(invoice_number="INV-003").count() == 0

    db_session.query(TaxInvoiceImportRecord).filter_by(import_id=batch.id).delete()
    db_session.delete(batch)
    db_session.commit()


def test_invoice_category_is_single_source_of_truth_for_processing_status(db_session):
    """category 是唯一事实：写 v2 分类后 processing_status 同步派生
    （运营成本三分类→required；报销两分类与 excluded→not_required；空→pending）。"""
    from app.models.tax import TaxInvoice, TaxInvoiceImport

    batch = TaxInvoiceImport(
        original_name=f"derive-{uuid4().hex}.xlsx",
        stored_path=f"/tmp/derive-{uuid4().hex}.xlsx",
        sha256=uuid4().hex + uuid4().hex,
        lifecycle="active",
    )
    db_session.add(batch)
    db_session.flush()

    def _invoice(prefix: str) -> TaxInvoice:
        row = TaxInvoice(
            invoice_key=f"pytest|{prefix}-{uuid4().hex[:8]}",
            invoice_number=f"{prefix}-{uuid4().hex[:8]}",
            direction="input",
            seller_name="供应商丙",
            total_amount=Decimal("113"),
            source_import_id=batch.id,
            source_row_index=1,
        )
        db_session.add(row)
        return row

    goods = _invoice("DERIVE-GOODS")
    reimb = _invoice("DERIVE-REIMB")
    platform = _invoice("DERIVE-PLAT")
    excluded = _invoice("DERIVE-EXCLUDED")
    empty = _invoice("DERIVE-EMPTY")
    db_session.flush()

    service.set_invoice_categories(db_session, [goods.id], "goods", actor="pytest")
    service.set_invoice_categories(db_session, [reimb.id], "reimburse_operating", actor="pytest")
    service.set_invoice_categories(db_session, [platform.id], "platform_fee", actor="pytest")
    service.set_invoice_categories(db_session, [excluded.id], "excluded", actor="pytest")
    # 旧四值 key 已废弃，必须拒绝。
    with pytest.raises(ValueError):
        service.set_invoice_categories(db_session, [goods.id], "goods_payment", actor="pytest")

    rows = {row.id: row for row in db_session.query(TaxInvoice).filter(TaxInvoice.id.in_(
        [goods.id, reimb.id, platform.id, excluded.id, empty.id]
    )).all()}
    assert rows[goods.id].processing_status == "required"
    assert rows[reimb.id].processing_status == "not_required"
    assert rows[platform.id].processing_status == "required"
    assert rows[excluded.id].processing_status == "not_required"
    assert rows[empty.id].category == ""
    assert rows[empty.id].processing_status == "pending"

    listed = {item["id"]: item for item in service.list_invoices(db_session, direction="input", limit=500)}
    assert listed[goods.id]["processingStatus"] == "required"
    assert listed[goods.id]["category"] == "goods"
    assert listed[goods.id]["categoryLabel"] == "运营成本：货款发票"
    assert listed[reimb.id]["processingStatus"] == "not_required"
    assert listed[platform.id]["processingStatus"] == "required"
    assert listed[excluded.id]["processingStatus"] == "not_required"
    assert listed[empty.id]["processingStatus"] == "pending"
    assert listed[empty.id]["categoryLabel"] == "待判断（未分类）"

    # 旧状态按钮接口行为等价：设状态时按映射写 v2 分类，处理结论保持一致。
    service.set_processing_status(db_session, reimb.id, "required", actor="pytest")
    assert db_session.get(TaxInvoice, reimb.id).category == "goods"
    assert service.serialize_invoice(db_session.get(TaxInvoice, reimb.id))["processingStatus"] == "required"
    service.set_processing_status(db_session, goods.id, "not_required", actor="pytest")
    assert db_session.get(TaxInvoice, goods.id).category == "reimburse_operating"
    assert service.serialize_invoice(db_session.get(TaxInvoice, goods.id))["processingStatus"] == "not_required"
    service.set_processing_status(db_session, excluded.id, "pending", actor="pytest")
    assert db_session.get(TaxInvoice, excluded.id).category == ""
    assert service.serialize_invoice(db_session.get(TaxInvoice, excluded.id))["processingStatus"] == "pending"


def test_output_invoice_category_enum_and_direction_guard(db_session):
    """销项分类独立枚举：buyer_sales/platform_service/空=待判断；进项传销项 key、
    销项传进项 key 都必须拒绝；销项不按明细兜底推断，空即待判断。"""
    from app.models.tax import TaxInvoice, TaxInvoiceImport

    batch = TaxInvoiceImport(
        original_name=f"output-{uuid4().hex}.xlsx",
        stored_path=f"/tmp/output-{uuid4().hex}.xlsx",
        sha256=uuid4().hex + uuid4().hex,
        lifecycle="active",
    )
    db_session.add(batch)
    db_session.flush()

    def _invoice(prefix: str, direction: str) -> TaxInvoice:
        row = TaxInvoice(
            invoice_key=f"pytest|{prefix}-{uuid4().hex[:8]}",
            invoice_number=f"{prefix}-{uuid4().hex[:8]}",
            direction=direction,
            seller_name="供应商丁",
            total_amount=Decimal("226"),
            source_import_id=batch.id,
            source_row_index=1,
        )
        db_session.add(row)
        return row

    output = _invoice("OUT-BUYER", "output")
    output2 = _invoice("OUT-PLAT", "output")
    output3 = _invoice("OUT-EMPTY", "output")
    input_row = _invoice("IN-GUARD", "input")
    db_session.flush()

    service.set_invoice_categories(db_session, [output.id], "buyer_sales", actor="pytest")
    service.set_invoice_categories(db_session, [output2.id], "platform_service", actor="pytest")
    service.set_invoice_categories(db_session, [output3.id], "", actor="pytest")
    # 销项传进项 key → 拒绝；进项传销项 key → 拒绝。
    with pytest.raises(ValueError):
        service.set_invoice_categories(db_session, [output.id], "goods", actor="pytest")
    with pytest.raises(ValueError):
        service.set_invoice_categories(db_session, [input_row.id], "buyer_sales", actor="pytest")

    rows = {row.id: row for row in db_session.query(TaxInvoice).filter(TaxInvoice.id.in_(
        [output.id, output2.id, output3.id, input_row.id]
    )).all()}
    assert rows[output.id].category == "buyer_sales"
    assert rows[output.id].processing_status == "pending"
    assert rows[output2.id].category == "platform_service"
    assert rows[output2.id].processing_status == "pending"
    assert rows[output3.id].category == ""
    assert rows[output3.id].processing_status == "pending"
    # 拒绝后进项行保持未分类，不被误写。
    assert rows[input_row.id].category == ""

    listed = {item["id"]: item for item in service.list_invoices(db_session, direction="output", limit=500)}
    assert listed[output.id]["category"] == "buyer_sales"
    assert listed[output.id]["categoryLabel"] == "给买家开发票"
    assert listed[output2.id]["categoryLabel"] == "给平台开服务费"
    assert listed[output3.id]["category"] == ""
    assert listed[output3.id]["categoryLabel"] == "待判断"

    # 置回空 = 待判断，幂等可逆。
    service.set_invoice_categories(db_session, [output.id], "", actor="pytest")
    assert db_session.get(TaxInvoice, output.id).category == ""
    assert service.serialize_invoice(db_session.get(TaxInvoice, output.id))["categoryLabel"] == "待判断"



def test_invoice_business_match_and_bank_payment_status_are_independent(db_session):
    """同一张进项发票的业务匹配与银行付款核对必须各算各的，互不污染。"""
    from datetime import datetime, timezone

    from app.models.tax import TaxInvoice, TaxInvoiceLink

    invoice = TaxInvoice(
        invoice_key=f"pytest-domain-{uuid4().hex}",
        invoice_number=f"DOMAIN-{uuid4().hex[:10]}",
        direction="input",
        status="issued",
        issue_date=datetime(2026, 9, 20, tzinfo=timezone.utc),
        seller_name="独立域供应商",
        total_amount=Decimal("1000.00"),
        match_status="unmatched",  # 故意放旧缓存值，序列化必须以真实业务链接为准。
        match_note="",
        raw={},
    )
    db_session.add(invoice)
    db_session.flush()

    business_link = TaxInvoiceLink(
        invoice_id=invoice.id,
        target_type="external_purchase_order",
        target_id=987654321,
        allocated_amount=Decimal("600.00"),
        match_method="manual",
        confirmed=True,
        note="采购业务匹配",
    )
    bank_link = TaxInvoiceLink(
        invoice_id=invoice.id,
        target_type="bank_transaction",
        target_id=123456789,
        allocated_amount=Decimal("400.00"),
        match_method="manual",
        confirmed=True,
        note="银行付款核对",
    )
    db_session.add_all([business_link, bank_link])
    db_session.flush()

    payload = service.serialize_invoice(invoice, db=db_session)
    assert payload["businessMatchStatus"] == "partial"
    assert payload["businessMatchedAmount"] == "600.0000"
    assert payload["businessRemainingAmount"] == "400.0000"
    assert payload["bankPaymentStatus"] == "partial"
    assert payload["bankPaidAmount"] == "400.00"
    assert payload["bankRemainingAmount"] == "600.00"

    # 银行核对改成付清，发票业务匹配仍然只能保持 600/1000 的 partial。
    bank_link.allocated_amount = Decimal("1000.00")
    db_session.flush()
    payload = service.serialize_invoice(invoice, db=db_session)
    assert payload["businessMatchStatus"] == "partial"
    assert payload["businessMatchedAmount"] == "600.0000"
    assert payload["bankPaymentStatus"] == "matched"
    assert payload["bankPaidAmount"] == "1000.00"

    # 解除银行核对也不能改变发票业务匹配。
    bank_link.match_method = "rejected"
    bank_link.confirmed = False
    db_session.flush()
    payload = service.serialize_invoice(invoice, db=db_session)
    assert payload["businessMatchStatus"] == "partial"
    assert payload["businessMatchedAmount"] == "600.0000"
    assert payload["bankPaymentStatus"] == "unmatched"
    assert payload["bankPaidAmount"] == "0.00"



def test_list_invoices_match_filter_uses_live_business_domain_not_cached_status(db_session):
    """服务端筛选必须与页面实时 businessMatchStatus 完全一致，银行链接不得参与。"""
    from app.models.tax import TaxInvoice, TaxInvoiceLink

    invoice = TaxInvoice(
        invoice_key=f"pytest-filter-domain-{uuid4().hex}",
        invoice_number=f"FILTER-{uuid4().hex[:10]}",
        direction="input",
        status="issued",
        seller_name="筛选口径供应商",
        total_amount=Decimal("1000.00"),
        match_status="unmatched",  # 故意保留旧缓存值
        raw={},
    )
    db_session.add(invoice)
    db_session.flush()
    db_session.add_all([
        TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type="external_purchase_order",
            target_id=777001,
            allocated_amount=Decimal("600.00"),
            match_method="manual",
            confirmed=True,
        ),
        TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type="bank_transaction",
            target_id=777002,
            allocated_amount=Decimal("1000.00"),
            match_method="manual",
            confirmed=True,
        ),
    ])
    db_session.flush()

    partial_ids = {
        row["id"]
        for row in service.list_invoices(
            db_session, direction="input", match_status="partial", limit=500
        )
    }
    matched_ids = {
        row["id"]
        for row in service.list_invoices(
            db_session, direction="input", match_status="matched", limit=500
        )
    }
    unmatched_ids = {
        row["id"]
        for row in service.list_invoices(
            db_session, direction="input", match_status="unmatched", limit=500
        )
    }

    assert invoice.id in partial_ids
    assert invoice.id not in matched_ids
    assert invoice.id not in unmatched_ids

    # 未确认业务链接不计入业务匹配；银行已付清也不能改变业务筛选结果。
    business_link = db_session.query(TaxInvoiceLink).filter_by(
        invoice_id=invoice.id, target_type="external_purchase_order"
    ).one()
    business_link.confirmed = False
    db_session.flush()

    unmatched_ids = {
        row["id"]
        for row in service.list_invoices(
            db_session, direction="input", match_status="unmatched", limit=500
        )
    }
    assert invoice.id in unmatched_ids
