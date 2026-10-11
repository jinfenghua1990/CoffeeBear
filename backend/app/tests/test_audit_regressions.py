from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import hashlib
import hmac

from app.config import settings
from app.core.auth import _b64e, _signing_key, decode_token
from app.models.procurement_chain import ProcurementChainLink
from app.models.purchase import ExternalPurchaseOrder
from app.services.finance_sales_report_service import _remaining_invoice_amount
from app.services import logistics_service
from app.services.logistics_service import _actual_amount_for_year, _exclusive_period_end
from app.services.platform_purchase_guard import _effective_removed_order_nos
from app.services.procurement_consistency import _chain_links_for_po


def test_partial_invoice_allocation_only_distributes_remaining_amount():
    links = [
        SimpleNamespace(allocated_amount=Decimal("40.00")),
        SimpleNamespace(allocated_amount=None),
    ]
    assert _remaining_invoice_amount(Decimal("100.00"), links) == Decimal("60.00")


def test_red_invoice_remaining_amount_keeps_sign():
    links = [
        SimpleNamespace(allocated_amount=Decimal("-20.00")),
        SimpleNamespace(allocated_amount=None),
    ]
    assert _remaining_invoice_amount(Decimal("-100.00"), links) == Decimal("-80.00")


def test_historical_deleted_1688_copy_does_not_hide_active_copy():
    assert _effective_removed_order_nos(
        {"A100", "B200"},
        {"A100"},
    ) == {"B200"}


def test_logistics_period_end_is_next_midnight_not_plus_full_day():
    tz = ZoneInfo("Asia/Shanghai")
    end = datetime(2026, 6, 30, 23, 59, 59, 999999, tzinfo=tz)
    assert _exclusive_period_end(end) == datetime(2026, 7, 1, 0, 0, tzinfo=tz)


def test_confirmed_legacy_procurement_link_with_null_match_method_is_kept(db_session):
    po = ExternalPurchaseOrder(
        external_order_id="AUDIT-NULL-MATCH",
        platform="other",
        supplier_name="回归测试供应商",
    )
    db_session.add(po)
    db_session.flush()
    link = ProcurementChainLink(
        external_po_id=po.id,
        target_type="inbound",
        target_id=999999999,
        match_method=None,
        confirmed=True,
    )
    db_session.add(link)
    db_session.flush()

    rows = _chain_links_for_po(db_session, po, "inbound")
    assert [row.id for row in rows] == [link.id]


def test_malformed_but_correctly_signed_token_returns_none(monkeypatch):
    monkeypatch.setattr(settings, "APP_SECRET_KEY", "audit-regression-secret")
    body = "a"  # base64url 长度非法；签名正确时会进入 payload 解码分支。
    signature = _b64e(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest())
    assert decode_token(f"{body}.{signature}") is None


def test_cross_year_logistics_bill_only_counts_current_year_share(monkeypatch):
    tz = ZoneInfo("Asia/Shanghai")
    bill = SimpleNamespace(
        actual_amount=Decimal("600.00"),
        period_start=datetime(2025, 10, 1, tzinfo=tz),
        period_end=datetime(2026, 3, 31, 23, 59, 59, tzinfo=tz),
    )

    def fake_shipped_count(_db, start, end):
        key = (start.date().isoformat(), end.date().isoformat())
        return {
            ("2025-10-01", "2026-04-01"): 600,
            ("2026-01-01", "2026-04-01"): 300,
        }[key]

    monkeypatch.setattr(logistics_service, "_shipped_count_range", fake_shipped_count)
    assert _actual_amount_for_year(object(), bill, 2026) == Decimal("300.00")


def test_sales_outbound_partial_amounts_do_not_look_like_complete_totals(monkeypatch):
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from app.models.jackyun import JackyunGoodsDocument, JackyunGoodsDocumentItem
    from app.services import sales_outbound_report_service as report_service

    doc = SimpleNamespace(
        id=7,
        document_type="outbound",
        document_at=datetime(2026, 9, 15, tzinfo=timezone.utc),
        warehouse_name="主仓",
        warehouse_code="W1",
        goodsdoc_no="OUT-7",
        company_name="测试公司",
    )
    items = [
        SimpleNamespace(
            line_no=1, quantity=Decimal("2"), amount_tax=Decimal("100.00"),
            goods_no="SKU-1", sku_barcode="", goods_name="咖啡豆", unit_name="袋",
        ),
        SimpleNamespace(
            line_no=2, quantity=Decimal("1"), amount_tax=None,
            goods_no="SKU-2", sku_barcode="", goods_name="滤纸", unit_name="包",
        ),
    ]

    class FakeQuery:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *_args):
            return self

        def filter_by(self, **_kwargs):
            return self

        def order_by(self, *_args):
            return self

        def all(self):
            return self.rows

    class FakeDb:
        def query(self, model):
            if model is JackyunGoodsDocument:
                return FakeQuery([doc])
            if model is JackyunGoodsDocumentItem:
                return FakeQuery(items)
            raise AssertionError(f"unexpected model: {model}")

    monkeypatch.setattr(
        report_service,
        "month_bounds",
        lambda *_args: (
            datetime(2026, 9, 1, tzinfo=timezone.utc),
            datetime(2026, 10, 1, tzinfo=timezone.utc),
        ),
    )
    result = report_service.build_report(FakeDb(), 2026, 9)

    assert result["hasAmount"] is True
    assert result["amountComplete"] is False
    assert result["summary"]["totalAmount"] is None
    assert result["byWarehouse"][0]["amount"] is None
    assert all(row["amount"] is None for row in result["bySku"])
