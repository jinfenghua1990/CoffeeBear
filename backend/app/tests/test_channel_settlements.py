from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models.business_partner import BusinessPartner
from app.models.finance import FinanceEntry
from app.models.open_item import OpenItem
from app.services import channel_settlement_service


def _partner(db_session) -> BusinessPartner:
    row = BusinessPartner(
        name="渠道结算测试平台",
        normalized_name="渠道结算测试平台",
        roles=["customer", "counterparty"],
        status="active",
    )
    db_session.add(row)
    db_session.flush()
    return row


def _create(db_session, **overrides):
    values = {
        "channel": "TMALL",
        "shop_name": "卖咖啡的熊旗舰店",
        "external_key": "SETTLE-20261009-001",
        "order_no": "SO-CHANNEL-001",
        "settle_date": date(2026, 10, 9),
        "gross_amount": Decimal("100"),
        "refund_amount": Decimal("10"),
        "platform_fee": Decimal("5"),
        "rebate_amount": Decimal("2"),
        "other_fee": Decimal("3"),
        "net_amount": Decimal("80"),
    }
    values.update(overrides)
    row, _created = channel_settlement_service.create_settlement(db_session, **values)
    return row


def test_channel_settlement_formula_and_negative_validation(db_session):
    row = _create(db_session)
    channel_settlement_service.validate_settlement(row)

    with pytest.raises(
        channel_settlement_service.ChannelSettlementError,
        match="净结算额不平",
    ):
        _create(
            db_session,
            external_key="SETTLE-BAD-NET",
            net_amount=Decimal("81"),
        )

    with pytest.raises(
        channel_settlement_service.ChannelSettlementError,
        match="不能为负数",
    ):
        _create(
            db_session,
            external_key="SETTLE-NEGATIVE",
            platform_fee=Decimal("-1"),
            net_amount=Decimal("86"),
        )


def test_channel_settlement_rejects_non_cny(db_session):
    with pytest.raises(
        channel_settlement_service.ChannelSettlementError,
        match="仅支持 CNY",
    ):
        _create(
            db_session,
            external_key="SETTLE-EUR",
            currency="EUR",
        )


def test_materialization_is_idempotent_and_non_cash(db_session):
    row = _create(db_session)

    first = channel_settlement_service.materialize_settlement(db_session, row.id)
    second = channel_settlement_service.materialize_settlement(db_session, row.id)
    db_session.flush()

    assert first["entryCount"] == second["entryCount"] == 5
    assert set(first["financeEntryIds"]) == set(second["financeEntryIds"])
    entries = db_session.scalars(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "channel_settlement",
            FinanceEntry.source_id == str(row.id),
        )
    ).all()
    assert len(entries) == 5
    by_category = {entry.category: entry for entry in entries}
    assert by_category["channel_sales"].amount == Decimal("100.0000")
    assert by_category["channel_sales"].direction == "income"
    assert by_category["channel_refund"].amount == Decimal("10.0000")
    assert by_category["channel_platform_fee"].amount == Decimal("5.0000")
    assert by_category["channel_rebate"].amount == Decimal("2.0000")
    assert by_category["channel_other_fee"].amount == Decimal("3.0000")
    assert all(entry.cash_effect is False for entry in entries)
    assert all(entry.profit_effect is True for entry in entries)
    assert row.status == "materialized"
    assert db_session.scalar(
        select(func.count())
        .select_from(FinanceEntry)
        .where(
            FinanceEntry.source_type == "channel_settlement",
            FinanceEntry.source_id == str(row.id),
        )
    ) == 5


def test_materialization_creates_net_receivable_open_item(db_session):
    partner = _partner(db_session)
    row = _create(
        db_session,
        external_key="SETTLE-WITH-PARTNER",
        partner_id=partner.id,
    )

    result = channel_settlement_service.materialize_settlement(db_session, row.id)
    db_session.flush()
    item = db_session.get(OpenItem, result["openItemId"])

    assert item is not None
    assert item.partner_id == partner.id
    assert item.item_type == "receivable"
    assert item.source_type == "channel_settlement"
    assert item.source_id == str(row.id)
    assert item.original_amount == Decimal("80.0000")
    assert item.status == "open"


def test_channel_settlement_source_identity_is_idempotent(db_session):
    first = _create(db_session, external_key="SETTLE-IDEMPOTENT")
    second, created = channel_settlement_service.create_settlement(
        db_session,
        channel="TMALL",
        shop_name="卖咖啡的熊旗舰店",
        external_key="SETTLE-IDEMPOTENT",
        order_no="SO-CHANNEL-001",
        settle_date=date(2026, 10, 9),
        gross_amount=Decimal("100"),
        refund_amount=Decimal("10"),
        platform_fee=Decimal("5"),
        rebate_amount=Decimal("2"),
        other_fee=Decimal("3"),
        net_amount=Decimal("80"),
    )
    assert created is False
    assert second.id == first.id

    with pytest.raises(
        channel_settlement_service.ChannelSettlementError,
        match="已存在",
    ):
        channel_settlement_service.create_settlement(
            db_session,
            channel="TMALL",
            shop_name="卖咖啡的熊旗舰店",
            external_key="SETTLE-IDEMPOTENT",
            order_no="SO-CHANNEL-001",
            settle_date=date(2026, 10, 9),
            gross_amount=Decimal("101"),
            refund_amount=Decimal("10"),
            platform_fee=Decimal("5"),
            rebate_amount=Decimal("2"),
            other_fee=Decimal("3"),
            net_amount=Decimal("81"),
        )

    # Even when gross/net remain unchanged, a changed deduction composition is
    # a materially different platform statement and must not be swallowed as an
    # idempotent retry.
    with pytest.raises(
        channel_settlement_service.ChannelSettlementError,
        match="金额组成不一致",
    ):
        channel_settlement_service.create_settlement(
            db_session,
            channel="TMALL",
            shop_name="卖咖啡的熊旗舰店",
            external_key="SETTLE-IDEMPOTENT",
            order_no="SO-CHANNEL-001",
            settle_date=date(2026, 10, 9),
            gross_amount=Decimal("100"),
            refund_amount=Decimal("9"),
            platform_fee=Decimal("6"),
            rebate_amount=Decimal("2"),
            other_fee=Decimal("3"),
            net_amount=Decimal("80"),
        )


def test_channel_settlement_api_create_materialize_and_list(client, db_session):
    partner = _partner(db_session)
    response = client.post(
        "/api/v1/finance/channel-settlements",
        json={
            "channel": "JD",
            "shopName": "卖咖啡的熊京东店",
            "externalKey": "JD-SETTLE-001",
            "settleDate": "2026-10-09",
            "grossAmount": "200",
            "refundAmount": "20",
            "platformFee": "10",
            "rebateAmount": "5",
            "otherFee": "5",
            "netAmount": "160",
            "partnerId": partner.id,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created"] is True
    settlement_id = body["item"]["id"]

    materialized = client.post(
        f"/api/v1/finance/channel-settlements/{settlement_id}/materialize"
    )
    assert materialized.status_code == 200
    result = materialized.json()
    assert result["entryCount"] == 5
    assert result["openItemId"] is not None

    listing = client.get(
        "/api/v1/finance/channel-settlements",
        params={"channel": "JD"},
    )
    assert listing.status_code == 200
    payload = listing.json()
    assert len(payload["items"]) == 1
    assert payload["items"][0]["status"] == "materialized"
    assert Decimal(payload["summary"]["grossAmount"]) >= Decimal("200")
