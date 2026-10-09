from datetime import date
from decimal import Decimal

import pytest

from app.models.bank import BankTransaction
from app.models.business_partner import BusinessPartner
from app.services import open_item_service


def _partner(db_session, name: str = "未结项测试往来单位") -> BusinessPartner:
    row = BusinessPartner(
        name=name,
        normalized_name=name.lower(),
        roles=["supplier", "customer", "counterparty"],
        status="active",
    )
    db_session.add(row)
    db_session.flush()
    return row


def _bank_txn(db_session, partner_id: int, *, direction: str, amount: str, serial: str) -> BankTransaction:
    row = BankTransaction(
        txn_date=date(2026, 10, 9),
        direction=direction,
        amount=Decimal(amount),
        counterparty_name="未结项测试往来单位",
        counterparty_partner_id=partner_id,
        serial_no=serial,
        fingerprint=f"pytest-open-items-{serial}",
    )
    db_session.add(row)
    db_session.flush()
    return row


def test_payable_partial_full_and_void_reopens(db_session):
    partner = _partner(db_session)
    item, created = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="payable",
        original_amount=Decimal("100"),
        source_type="purchase_order",
        source_id="PO-OPEN-001",
        source_no="PO-OPEN-001",
    )
    assert created is True

    first_txn = _bank_txn(db_session, partner.id, direction="out", amount="40", serial="OUT-40")
    first = open_item_service.allocate_bank_transaction(
        db_session,
        item_id=item.id,
        bank_transaction_id=first_txn.id,
        amount=Decimal("40"),
    )
    db_session.flush()
    assert first.status == "active"
    assert item.status == "partial"
    assert item.settled_amount == Decimal("40")

    second_txn = _bank_txn(db_session, partner.id, direction="out", amount="60", serial="OUT-60")
    second = open_item_service.allocate_bank_transaction(
        db_session,
        item_id=item.id,
        bank_transaction_id=second_txn.id,
        amount=Decimal("60"),
    )
    db_session.flush()
    assert item.status == "closed"
    assert item.settled_amount == Decimal("100")
    assert item.closed_at is not None

    open_item_service.void_allocation(db_session, allocation_id=second.id)
    db_session.flush()
    assert item.status == "partial"
    assert item.settled_amount == Decimal("40")
    assert item.closed_at is None


def test_receivable_requires_inbound_bank_transaction(db_session):
    partner = _partner(db_session, "应收方向测试客户")
    item, _ = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="receivable",
        original_amount=Decimal("88"),
        source_type="sales_order",
        source_id="SO-OPEN-001",
    )
    wrong_txn = _bank_txn(db_session, partner.id, direction="out", amount="88", serial="WRONG-OUT")

    with pytest.raises(open_item_service.OpenItemError, match="应收只能分配收款流水"):
        open_item_service.allocate_bank_transaction(
            db_session,
            item_id=item.id,
            bank_transaction_id=wrong_txn.id,
            amount=Decimal("88"),
        )


def test_bank_transaction_can_split_but_not_overallocate(db_session):
    partner = _partner(db_session, "拆分付款测试供应商")
    item1, _ = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="payable",
        original_amount=Decimal("60"),
        source_type="purchase_order",
        source_id="PO-SPLIT-1",
    )
    item2, _ = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="payable",
        original_amount=Decimal("60"),
        source_type="purchase_order",
        source_id="PO-SPLIT-2",
    )
    txn = _bank_txn(db_session, partner.id, direction="out", amount="100", serial="SPLIT-100")

    open_item_service.allocate_bank_transaction(
        db_session, item_id=item1.id, bank_transaction_id=txn.id, amount=Decimal("60")
    )
    open_item_service.allocate_bank_transaction(
        db_session, item_id=item2.id, bank_transaction_id=txn.id, amount=Decimal("40")
    )
    db_session.flush()
    assert item1.status == "closed"
    assert item2.status == "partial"

    with pytest.raises(open_item_service.OpenItemError, match="银行流水可用金额"):
        open_item_service.allocate_bank_transaction(
            db_session, item_id=item2.id, bank_transaction_id=txn.id, amount=Decimal("20")
        )


def test_source_identity_is_idempotent_and_conflict_safe(db_session):
    partner = _partner(db_session, "幂等测试供应商")
    first, created = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="payable",
        original_amount=Decimal("123.45"),
        source_type="purchase_order",
        source_id="PO-IDEMPOTENT",
    )
    second, created_again = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="payable",
        original_amount=Decimal("123.45"),
        source_type="purchase_order",
        source_id="PO-IDEMPOTENT",
    )
    assert created is True
    assert created_again is False
    assert second.id == first.id

    with pytest.raises(open_item_service.OpenItemError, match="金额不一致"):
        open_item_service.create_open_item(
            db_session,
            partner_id=partner.id,
            item_type="payable",
            original_amount=Decimal("999"),
            source_type="purchase_order",
            source_id="PO-IDEMPOTENT",
        )


def test_cancel_requires_no_active_allocations(db_session):
    partner = _partner(db_session, "取消测试供应商")
    item, _ = open_item_service.create_open_item(
        db_session,
        partner_id=partner.id,
        item_type="payable",
        original_amount=Decimal("50"),
        source_type="manual",
        source_id="CANCEL-1",
    )
    txn = _bank_txn(db_session, partner.id, direction="out", amount="20", serial="CANCEL-OUT")
    allocation = open_item_service.allocate_bank_transaction(
        db_session, item_id=item.id, bank_transaction_id=txn.id, amount=Decimal("20")
    )

    with pytest.raises(open_item_service.OpenItemError, match="先撤销分配"):
        open_item_service.cancel_open_item(db_session, item_id=item.id)

    open_item_service.void_allocation(db_session, allocation_id=allocation.id)
    open_item_service.cancel_open_item(db_session, item_id=item.id)
    assert item.status == "cancelled"


def test_open_items_api_create_list_and_summary(client, db_session):
    partner = _partner(db_session, "API 未结项测试供应商")
    response = client.post(
        "/api/v1/finance/open-items",
        json={
            "partnerId": partner.id,
            "itemType": "payable",
            "originalAmount": "321.00",
            "sourceType": "purchase_order",
            "sourceId": "PO-API-OPEN-1",
            "sourceNo": "PO-API-OPEN-1",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created"] is True
    assert body["item"]["status"] == "open"
    assert Decimal(body["item"]["remainingAmount"]) == Decimal("321")

    listing = client.get(
        "/api/v1/finance/open-items",
        params={"partner_id": partner.id},
    )
    assert listing.status_code == 200
    data = listing.json()
    assert len(data["items"]) == 1
    assert Decimal(data["summary"]["payableOutstanding"]) == Decimal("321")
    assert Decimal(data["summary"]["receivableOutstanding"]) == Decimal("0")
