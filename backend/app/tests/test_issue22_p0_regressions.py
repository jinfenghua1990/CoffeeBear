"""Issue #22（P0/P1 修复）回归测试。

#24 / #34 已合入的修复用于防回退；红冲净额口径为本文件所在 PR 的新修复（Closes #35）：

- P0-1 月度做账台账：用户删除的来源明细行不再计入。
- P1 红冲净额口径：蓝票已红冲、红字票未入库（blue_red_pending）时不计入做账净额，
  并在该发票的 blocker 中提示原因。
- P0-3 「发票明细」Sheet 合计行不进入入库。
- P0-4 采购链路日期守卫：发票早于订单超过预付宽限期一律拒绝（防止历史发票串单）。
- P1 银行流水指纹：回退分支 / 凭证号分支 / 流水号分支均区分收/支方向。
"""
import io
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from openpyxl import Workbook

from app.adapters.tax_invoice_file import parse_tax_invoice_export
from app.models.alibaba1688_import import Alibaba1688Order
from app.models.purchase import ExternalPurchaseOrder
from app.models.tax import TaxInvoice, TaxInvoiceImport, TaxInvoiceImportRecord
from app.services.procurement_chain_service import ProcurementChainMatcher
from app.services.reconciliation import build_fingerprint
from app.services.tax_accounting_service import monthly_ledger


# ---------- P0-4 日期守卫 ----------

def _make_1688_order(order_time: datetime, payment: str = "100.00") -> Alibaba1688Order:
    return Alibaba1688Order(
        seller_company_name="咖啡豆供应商甲",
        actual_payment=Decimal(payment),
        order_time=order_time,
    )


def _make_external_order(ordered_at: datetime, payment: str = "100.00") -> ExternalPurchaseOrder:
    return ExternalPurchaseOrder(
        supplier_name="咖啡豆供应商甲",
        paid_amount=Decimal(payment),
        ordered_at=ordered_at,
    )


def test_best_order_rejects_invoice_far_before_order():
    """发票早于订单 40 天（超过 7 天预付宽限）必须拒绝，防止历史发票串单。"""
    order = _make_1688_order(datetime(2026, 9, 10, tzinfo=timezone.utc))
    invoice_date = datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert ProcurementChainMatcher._best_order([order], "咖啡豆供应商甲", "100.00", invoice_date) is None


def test_best_order_allows_invoice_after_order_within_window():
    order = _make_1688_order(datetime(2026, 8, 1, tzinfo=timezone.utc))
    invoice_date = datetime(2026, 9, 10, tzinfo=timezone.utc)
    result = ProcurementChainMatcher._best_order([order], "咖啡豆供应商甲", "100.00", invoice_date)
    assert result is not None


def test_best_order_allows_prepay_grace_window():
    """发票早于订单但在 7 天预付宽限内仍允许。"""
    order = _make_1688_order(datetime(2026, 8, 10, tzinfo=timezone.utc))
    invoice_date = datetime(2026, 8, 5, tzinfo=timezone.utc)
    result = ProcurementChainMatcher._best_order([order], "咖啡豆供应商甲", "100.00", invoice_date)
    assert result is not None


def test_best_external_order_rejects_invoice_far_before_order():
    """补开票 365 天放宽窗不能把早于订单一年的发票也匹配上。"""
    order = _make_external_order(datetime(2026, 9, 10, tzinfo=timezone.utc))
    invoice_date = datetime(2026, 3, 1, tzinfo=timezone.utc)
    result = ProcurementChainMatcher._best_external_order(
        [order], "咖啡豆供应商甲", "100.00", invoice_date,
        window_days=365, exact=True,
    )
    assert result is None


def test_best_external_order_allows_late_supplement_invoice():
    order = _make_external_order(datetime(2026, 3, 1, tzinfo=timezone.utc))
    invoice_date = datetime(2026, 9, 1, tzinfo=timezone.utc)
    result = ProcurementChainMatcher._best_external_order(
        [order], "咖啡豆供应商甲", "100.00", invoice_date,
        window_days=365, exact=True,
    )
    assert result is not None


# ---------- P0-3 发票明细合计行 ----------

def _build_tax_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "发票基础信息"
    ws.append(["发票号码", "发票代码", "价税合计"])
    ws.append(["INV-001", "CODE-1", "100.00"])
    ws.append(["INV-002", "CODE-2", "50.00"])
    ws.append(["合计", "", "150.00"])

    detail = wb.create_sheet("发票明细")
    detail.append(["发票号码", "货物名称", "金额"])
    detail.append(["INV-001", "咖啡豆", "80.00"])
    detail.append(["INV-001", "运费", "20.00"])
    detail.append(["合计", "", "150.00"])

    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def test_detail_sheet_total_rows_never_imported():
    parsed = parse_tax_invoice_export(_build_tax_xlsx(), f"tax-{uuid4().hex}.xlsx", max_rows=1000)
    primary_numbers = {row.get(parsed.mapping.get("invoice_number", ""), "") for row in parsed.rows}
    assert primary_numbers == {"INV-001", "INV-002"}
    detail_numbers = {row.get(parsed.detail_mapping.get("invoice_number", ""), "") for row in parsed.detail_rows}
    assert detail_numbers == {"INV-001"}
    # ignored_row_count 只统计主表被忽略的行；明细表合计行按明细规则跳过、不计入该计数器。
    assert parsed.ignored_row_count == 1


# ---------- P0-1 月度做账台账可见口径 ----------

def _batch(db_session) -> TaxInvoiceImport:
    row = TaxInvoiceImport(
        original_name=f"pytest-tax-{uuid4().hex}.xlsx",
        stored_path=f"/tmp/pytest-{uuid4().hex}.xlsx",
        sha256=uuid4().hex + uuid4().hex,
        size=100,
        source_system="tax_export",
        period_year=2026,
        period_month=8,
        status="parsed",
        lifecycle="active",
        row_count=1,
        recognized_row_count=1,
    )
    db_session.add(row)
    db_session.flush()
    return row


def _output_invoice(batch_id: int, *, total: str, number: str | None = None) -> TaxInvoice:
    return TaxInvoice(
        invoice_key=f"pytest|{uuid4().hex}",
        invoice_number=number or f"INV-{uuid4().hex[:12]}",
        direction="output",
        status="issued",
        issue_date=datetime(2026, 8, 15, tzinfo=timezone.utc),
        amount_excl_tax=Decimal(total),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(total),
        source_system="tax_export",
        source_import_id=batch_id,
        raw={},
    )


def test_monthly_ledger_excludes_deleted_source_rows(db_session):
    """P0-1：来源明细行被用户删除的发票不得再计入做账台账。"""
    batch = _batch(db_session)
    kept = _output_invoice(batch.id, total="100.00")
    kept.source_row_index = 1
    dropped = _output_invoice(batch.id, total="999.00")
    dropped.source_row_index = 2
    db_session.add_all([kept, dropped])
    db_session.flush()
    db_session.add(TaxInvoiceImportRecord(
        import_id=batch.id, row_index=1, row_status="active", payload={}, invoice_id=kept.id,
    ))
    db_session.add(TaxInvoiceImportRecord(
        import_id=batch.id, row_index=2, row_status="deleted", payload={}, invoice_id=dropped.id,
    ))
    db_session.flush()

    ledger = monthly_ledger(db_session, 2026, 8)
    assert ledger["summary"]["invoiceCount"] == 1
    assert ledger["summary"]["outputTotalAmount"] == "100.00"
    assert [item["invoiceId"] for item in ledger["items"]] == [kept.id]


def test_monthly_ledger_excludes_pending_red_blue_from_totals(db_session):
    """P1 红冲净额口径：蓝票官方状态显示已红冲但红字票未入库时，不按票面金额计入净额。"""
    batch = _batch(db_session)
    normal = _output_invoice(batch.id, total="100.00")
    pending_red = _output_invoice(batch.id, total="500.00", number="PENDING-RED-001")
    pending_red.raw = {"发票状态": "全额红冲"}
    db_session.add_all([normal, pending_red])
    db_session.flush()

    ledger = monthly_ledger(db_session, 2026, 8)
    assert ledger["summary"]["outputInvoiceCount"] == 1
    assert ledger["summary"]["outputTotalAmount"] == "100.00"
    # items 仍保留票面事实金额；原因写在该发票的 blocker 中
    pending_item = next(item for item in ledger["items"] if item["invoiceNumber"] == "PENDING-RED-001")
    assert pending_item["totalAmount"] == "500.00"
    blocker = next(b for b in ledger["blockers"] if b["invoiceNumber"] == "PENDING-RED-001")
    assert any("红" in reason for reason in blocker["reasons"])


# ---------- P1 银行流水指纹方向 ----------

def test_fingerprint_fallback_distinguishes_direction():
    """无流水号/凭证号时，同日同账户同对方同金额的收/支两笔指纹必须不同，
    否则后到的一笔会被合并进先到的一笔（Issue #22 P1）。"""
    base = ("ZJRC-001", "2026-09-01", "100", "", "抖音", "货款")
    income = build_fingerprint(*base, direction="in")
    expense = build_fingerprint(*base, direction="out")
    assert income != expense
    # 同方向重复计算保持稳定
    assert build_fingerprint(*base, direction="in") == income


def test_fingerprint_with_voucher_also_distinguishes_direction():
    """有凭证号时同样区分方向；历史重复导入由 _legacy_candidate 原地补齐，不会重复建行。"""
    base = ("ZJRC-001", "2026-09-01", "100", "V123")
    income = build_fingerprint(*base, direction="in")
    expense = build_fingerprint(*base, direction="out")
    assert income != expense


def test_fingerprint_with_serial_distinguishes_direction():
    """含流水号的分支同样区分方向（主库现行口径）。"""
    a = build_fingerprint("ZJRC-001", "2026-09-01", "100", "", "", "", serial_no="S1", direction="in")
    b = build_fingerprint("ZJRC-001", "2026-09-01", "100", "", "", "", serial_no="S1", direction="out")
    assert a != b
    assert build_fingerprint("ZJRC-001", "2026-09-01", "100", "", "", "", serial_no="S1", direction="in") == a
