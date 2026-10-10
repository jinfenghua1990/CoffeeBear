import pytest

from app.models.finance import FinanceLegalEntity
from app.services import finance_projection_service


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


def test_finance_center_rejects_non_domestic_scope(client):
    response = client.get(
        "/api/v1/finance/center",
        params={"business_scope": "foreign_trade"},
    )
    assert response.status_code == 422


def test_finance_sync_api_rejects_non_domestic_scope(client):
    response = client.post(
        "/api/v1/finance/sync-business",
        params={"year": 2026, "month": 10, "business_scope": "foreign_trade"},
    )
    assert response.status_code == 422


def test_projection_service_rejects_non_domestic_scope(db_session):
    with pytest.raises(ValueError, match="仅支持国内财务投影"):
        finance_projection_service.sync_business_period(
            db_session,
            year=2026,
            month=10,
            business_scope="foreign_trade",
        )
