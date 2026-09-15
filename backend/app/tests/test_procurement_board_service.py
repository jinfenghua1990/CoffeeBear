from app.services import procurement_board_service as board_service


def _row(**overrides):
    row = {
        "amount": 100.0,
        "purchaseContentComplete": True,
        "allocations": [{"skuId": 1}],
        "purchaseOrders": [{}],
        "inbound": [{"consumableUsageDecided": True}],
        "invoice": [{"amount": 100.0, "verified": False}],
        "invoiceStatus": "done",
        "consumable": {},
        "settlement": [],
        "paidOn1688": False,
    }
    row.update(overrides)
    return row


def test_board_uses_shared_pending_queue_and_respects_po_bypass():
    assert board_service._first_undone_label(_row(invoice=[])) == "invoice"
    assert board_service._first_undone_label(
        _row(purchaseOrders=[], jackyunPoBypassed=True)
    ) is None


def test_board_payment_counts_1688_fact_without_double_counting():
    row = _row(amount=100.0, paidAmount=100.0, paidOn1688=True)
    assert board_service._paid_amount(row, cap=100.0) == 100.0

    row["settlement"] = [{"paid": True, "paidAmount": 40.0}]
    assert board_service._paid_amount(row, cap=100.0) == 100.0


def test_board_flow_uses_same_purchase_and_invoice_facts():
    flow = board_service._flow_status(_row(purchaseOrders=[], jackyunPoBypassed=True))
    assert [item["done"] for item in flow] == [True, True, True, True, True]


def test_board_pending_queue_catches_partial_invoice():
    row = _row(
        invoice=[{"amount": 20.0}],
        invoiceStatus="partial",
        invoiceOutstanding=80.0,
        paidOn1688=True,
        paidAmount=100.0,
    )
    assert board_service._pending_queue(row) == "invoice"
