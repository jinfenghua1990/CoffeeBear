from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import settings
from app.models.catalog import ProductSku
from app.models.finance import FinanceEntry
from app.models.jackyun import JackyunGoodsDocument, JackyunGoodsDocumentItem
from app.models.logistics import LogisticsBill
from app.models.sales import SalesOrder, SalesOrderItem
from app.services import finance_center_service
from app.services import finance_projection_service as projection


def _dt(year=2026, month=9, day=15):
    return datetime(year, month, day, 12, 0, tzinfo=ZoneInfo(settings.TZ))


def test_domestic_sales_order_projects_actual_income(db_session):
    entity = finance_center_service.resolve_entity(db_session)
    order = SalesOrder(
        order_no="PY-FIN-SALE-1",
        source_provider="pytest",
        platform="京东",
        order_status="已完成",
        pay_status="已支付",
        paid_amount=Decimal("599.00"),
        currency="CNY",
        ordered_at=_dt(),
        paid_at=_dt(),
    )
    db_session.add(order)
    db_session.flush()

    result = projection.project_domestic_sales_order(db_session, order)
    db_session.flush()

    entry = db_session.scalar(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "domestic_sales_order",
            FinanceEntry.source_id == str(order.id),
            FinanceEntry.category == "sales_income",
        )
    )
    assert result["created"] == 1
    assert entry is not None
    assert entry.legal_entity_id == entity.id
    assert entry.business_scope == "domestic"
    assert entry.amount == Decimal("599.0000")
    assert entry.value_type == "actual"
    assert entry.settlement_status == "settled"
    assert entry.cash_effect is True
    assert entry.profit_effect is True


def test_actual_value_supersedes_estimate_in_domestic_forecast_profit(db_session):
    entity = finance_center_service.resolve_entity(db_session)
    common = dict(
        legal_entity_id=entity.id,
        business_scope="domestic",
        source_type="pytest_projection",
        source_id="same-source",
        source_no="DOM-X",
        category="sales_income",
        direction="income",
        currency="CNY",
        tax_amount=Decimal("0"),
        cash_effect=True,
        profit_effect=True,
        invoice_status="not_required",
        accounting_year=2026,
        accounting_month=9,
        occurred_at=_dt(),
        raw={"projection": True},
    )
    db_session.add_all([
        FinanceEntry(
            **common,
            amount=Decimal("100"),
            value_type="estimated",
            settlement_status="pending",
        ),
        FinanceEntry(
            **common,
            amount=Decimal("90"),
            value_type="actual",
            settlement_status="settled",
        ),
    ])
    db_session.flush()

    data = finance_center_service.center_overview(
        db_session,
        legal_entity_id=entity.id,
        business_scope="domestic",
        year=2026,
        month=9,
    )
    cny = next(row for row in data["totalsByCurrency"] if row["currency"] == "CNY")

    assert cny["actualIncome"] == "90.0000"
    assert cny["estimatedIncome"] == "0"
    assert cny["actualProfit"] == "90.0000"
    assert cny["estimatedProfit"] == "90.0000"
    assert cny["actualNetCash"] == "90.0000"


def test_domestic_sales_projects_cost_from_inbound_when_complete(db_session):
    sku = ProductSku(
        jackyun_sku_id="PY-FIN-COST-SKU-ID",
        sku_code="PY-FIN-COST-SKU",
        sku_name="财务投影成本测试商品",
        status="active",
    )
    db_session.add(sku)
    db_session.flush()

    inbound = JackyunGoodsDocument(
        document_type="inbound",
        goodsdoc_no="PY-FIN-INBOUND-COST-1",
        document_at=_dt(day=1),
        supplier_name="测试供应商",
        total_amount=Decimal("1000"),
    )
    db_session.add(inbound)
    db_session.flush()
    db_session.add(
        JackyunGoodsDocumentItem(
            document_id=inbound.id,
            line_no=1,
            goods_no=sku.sku_code,
            quantity=Decimal("100"),
            unit_price_tax=Decimal("10"),
            amount_tax=Decimal("1000"),
            matched_sku_id=sku.id,
        )
    )

    order = SalesOrder(
        order_no="PY-FIN-SALE-COST-1",
        source_provider="pytest",
        platform="京东",
        order_status="已完成",
        pay_status="已支付",
        paid_amount=Decimal("100"),
        currency="CNY",
        ordered_at=_dt(day=20),
        paid_at=_dt(day=20),
    )
    db_session.add(order)
    db_session.flush()
    db_session.add(
        SalesOrderItem(
            order_id=order.id,
            sku_id=sku.id,
            sku_code=sku.sku_code,
            goods_name=sku.sku_name,
            quantity=Decimal("3"),
            amount=Decimal("100"),
        )
    )
    db_session.flush()

    projection.project_domestic_sales_order(db_session, order)
    db_session.flush()

    rows = db_session.scalars(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "domestic_sales_order",
            FinanceEntry.source_id == str(order.id),
        )
    ).all()
    by_category = {row.category: row for row in rows}
    assert by_category["sales_income"].amount == Decimal("100.0000")
    assert by_category["sales_cost"].amount == Decimal("30.0000")
    assert by_category["sales_cost"].cash_effect is False
    assert by_category["sales_cost"].profit_effect is True


def test_inbound_projects_inventory_payable_without_profit_or_cash_effect(db_session):
    entity = finance_center_service.resolve_entity(db_session)
    inbound = JackyunGoodsDocument(
        document_type="inbound",
        goodsdoc_no="PY-FIN-INBOUND-PAYABLE-1",
        document_at=_dt(),
        supplier_name="财务投影供应商",
        total_amount=Decimal("888.88"),
        warehouse_name="测试仓",
        raw={"source": "local_purchase_inbound"},
    )
    db_session.add(inbound)
    db_session.flush()

    result = projection.project_inbound_document(db_session, inbound)
    db_session.flush()

    entry = db_session.scalar(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "domestic_inbound",
            FinanceEntry.source_id == str(inbound.id),
            FinanceEntry.category == "inventory_purchase",
        )
    )
    assert result["created"] == 1
    assert entry is not None
    assert entry.legal_entity_id == entity.id
    assert entry.amount == Decimal("888.8800")
    assert entry.settlement_status == "pending"
    assert entry.invoice_status == "pending"
    assert entry.cash_effect is False
    assert entry.profit_effect is False


def test_logistics_projection_replaces_estimate_with_actual_bill(db_session):
    outbound = JackyunGoodsDocument(
        document_type="outbound",
        goodsdoc_no="PY-FIN-OUTBOUND-LOG-1",
        document_at=_dt(year=2026, month=8, day=15),
        total_quantity=Decimal("1"),
    )
    db_session.add(outbound)
    db_session.flush()

    first = projection.project_domestic_logistics_period(
        db_session, year=2026, month=8
    )
    db_session.flush()
    rows = db_session.scalars(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "domestic_logistics_period",
            FinanceEntry.source_id == "2026-08",
        )
    ).all()
    assert first["created"] == 1
    assert len(rows) == 1
    assert rows[0].category == "domestic_logistics"
    assert rows[0].value_type == "estimated"
    assert rows[0].amount == Decimal("5.0000")
    assert rows[0].cash_effect is False
    assert rows[0].profit_effect is True

    bill = LogisticsBill(
        period_label="2026-08",
        period_start=_dt(year=2026, month=8, day=1),
        period_end=_dt(year=2026, month=8, day=31),
        carrier="测试物流",
        waybill_count=1,
        estimated_amount=Decimal("5"),
        actual_amount=Decimal("8.40"),
        actual_unit_price=Decimal("8.40"),
        status="settled",
        invoice_status="invoiced",
    )
    db_session.add(bill)
    db_session.flush()

    projection.project_domestic_logistics_period(
        db_session, year=2026, month=8
    )
    db_session.flush()
    rows = db_session.scalars(
        select(FinanceEntry).where(
            FinanceEntry.source_type == "domestic_logistics_period",
            FinanceEntry.source_id == "2026-08",
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].value_type == "actual"
    assert rows[0].amount == Decimal("8.4000")
    assert rows[0].settlement_status == "settled"


def test_retired_foreign_scope_does_not_create_finance_entries(db_session):
    result = projection.sync_business_period(
        db_session,
        year=2026,
        month=9,
        business_scope="foreign_trade",
    )
    assert result["created"] == 0
    assert result["updated"] == 0
    assert result["deleted"] == 0
    assert result["sources"] == {
        "domesticOrders": 0,
        "domesticRefunds": 0,
        "inboundDocuments": 0,
        "logisticsPeriods": 0,
    }
