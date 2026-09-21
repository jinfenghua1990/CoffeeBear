from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.config import settings
from app.models.purchase import JackyunPurchaseOrder
from app.services import procurement_board_service as board
from app.services import procurement_chain_service as chain
from app.services import procurement_workbench_service as workbench
from app.services.inbound_document_view import _day_start
from app.services.purchase_service import _jackyun_po_date


def test_procurement_money_helpers_keep_decimal_until_serialization():
    row = {
        "amount": "0.30",
        "paidAmount": "0.30",
        "paidOn1688": True,
        "settlement": [],
    }
    assert board._paid_amount(row, cap=Decimal("0.30")) == Decimal("0.30")
    assert workbench._paid_amount(row, cap=Decimal("0.30")) == Decimal("0.30")

    breakdown = board._payment_breakdown({
        "goodsTotal": "0.10",
        "freight": "0.20",
        "expenses": [],
        "discount": "0",
        "paidOn1688": True,
        "paidAmount": "0.30",
    })
    assert breakdown["totalDue"] == 0.3
    assert breakdown["unpaidAmount"] == 0.0

    closure = chain._po_amount_closure(
        [
            {"allocAmount": "0.10", "amount": "99"},
            {"allocAmount": "0.20", "amount": "99"},
        ],
        Decimal("0.30"),
    )
    assert closure["allocTotal"] == 0.3
    assert closure["gap"] == 0.0
    assert closure["closed"] is True


def test_single_legacy_po_without_explicit_allocation_is_not_false_positive():
    closure = chain._po_amount_closure(
        [{"allocAmount": None, "amount": "80.00"}],
        Decimal("100.00"),
    )
    assert closure["gap"] == 20.0
    assert closure["closed"] is True


def test_business_date_helpers_are_shanghai_aware():
    tz = ZoneInfo(settings.TZ)
    start = _day_start(date(2026, 9, 1))
    assert start.tzinfo is not None
    assert start.utcoffset() == tz.utcoffset(start)

    jpo = JackyunPurchaseOrder(
        jackyun_purch_id="TZ-PO-001",
        raw={"date": "2026-09-01 00:30:00"},
    )
    parsed = _jackyun_po_date(jpo)
    assert parsed is not None
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == tz.utcoffset(parsed)
