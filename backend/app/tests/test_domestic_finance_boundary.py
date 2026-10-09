from decimal import Decimal

from app.models.finance import FinanceEntry, FinanceLegalEntity
from app.services import finance_closing_service


def test_finance_legal_entity_defaults_to_domestic_only(db_session):
    entity = FinanceLegalEntity(
        code="DOMESTIC-BOUNDARY",
        name="国内边界测试主体",
        country_code="CN",
        base_currency="CNY",
        status="active",
        is_default=False,
    )
    db_session.add(entity)
    db_session.flush()

    assert entity.business_scopes == ["domestic"]


def test_entity_api_ignores_legacy_foreign_scope(client):
    response = client.post(
        "/api/v1/finance/entities",
        json={
            "code": "DOMESTIC-API",
            "name": "国内 API 边界测试主体",
            "countryCode": "CN",
            "baseCurrency": "CNY",
            "businessScopes": ["domestic", "foreign_trade"],
        },
    )
    assert response.status_code == 201
    assert response.json()["businessScopes"] == ["domestic"]


def test_historical_foreign_entries_are_not_exported(db_session):
    entity = FinanceLegalEntity(
        code="HISTORICAL-AUDIT",
        name="历史审计测试主体",
        country_code="CN",
        base_currency="CNY",
        status="active",
        is_default=False,
        business_scopes=["domestic"],
    )
    db_session.add(entity)
    db_session.flush()
    db_session.add(
        FinanceEntry(
            legal_entity_id=entity.id,
            business_scope="foreign_trade",
            source_type="legacy",
            source_id="legacy-1",
            source_no="LEGACY-1",
            category="other",
            direction="income",
            cash_effect=False,
            profit_effect=False,
            currency="EUR",
            amount=Decimal("99"),
            tax_amount=Decimal("0"),
            value_type="actual",
            settlement_status="closed",
            invoice_status="unknown",
            accounting_year=2026,
            accounting_month=10,
        )
    )
    db_session.flush()

    summary = finance_closing_service.foreign_trade_summary(
        db_session,
        legal_entity_id=entity.id,
        year=2026,
        month=10,
    )
    assert summary == {"rowCount": 0, "rows": [], "totalsByCurrency": []}
    assert finance_closing_service.foreign_trade_xlsx(
        db_session,
        legal_entity_id=entity.id,
        year=2026,
        month=10,
    ) is None
