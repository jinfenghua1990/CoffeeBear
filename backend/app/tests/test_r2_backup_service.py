from app.config import settings
from app.models.integration import IntegrationCredential
from app.services import r2_backup_service


def test_r2_config_encrypts_secrets_and_never_exposes_them(db_session, monkeypatch):
    monkeypatch.setattr(settings, "APP_SECRET_KEY", "pytest-r2-secret-for-fernet")

    saved = r2_backup_service.save_config(
        db_session,
        endpoint_url="https://account-id.r2.cloudflarestorage.com",
        bucket="ecommerce-backup",
        prefix="ecommerce-workspace/backup",
        access_key="R2_AK_TEST_12345678",
        secret_key="R2_SK_TEST_SUPER_SECRET",
        enabled=True,
        full_interval_days=10,
        actor="pytest",
    )

    assert saved["configured"] is True
    assert saved["enabled"] is True
    assert saved["readEnabled"] is True
    assert saved["fullIntervalDays"] == 10
    assert saved["accessKeyHint"].endswith("5678")
    assert "access_key" not in saved
    assert "secret_key" not in saved

    row = (
        db_session.query(IntegrationCredential)
        .filter_by(provider=r2_backup_service.PROVIDER)
        .order_by(IntegrationCredential.id.desc())
        .first()
    )
    assert row is not None
    assert "R2_AK_TEST_12345678" not in row.secret_encrypted
    assert "R2_SK_TEST_SUPER_SECRET" not in row.secret_encrypted

    runtime = r2_backup_service.runtime_config(db_session)
    assert runtime is not None
    assert runtime["access_key"] == "R2_AK_TEST_12345678"
    assert runtime["secret_key"] == "R2_SK_TEST_SUPER_SECRET"


def test_r2_config_update_keeps_existing_secret_when_fields_are_blank(db_session, monkeypatch):
    monkeypatch.setattr(settings, "APP_SECRET_KEY", "pytest-r2-secret-for-fernet")

    r2_backup_service.save_config(
        db_session,
        endpoint_url="https://account-id.r2.cloudflarestorage.com",
        bucket="ecommerce-backup",
        prefix="ecommerce-workspace/backup",
        access_key="R2_AK_TEST_12345678",
        secret_key="R2_SK_TEST_SUPER_SECRET",
        enabled=True,
        full_interval_days=10,
        actor="pytest",
    )
    updated = r2_backup_service.save_config(
        db_session,
        endpoint_url="https://account-id.r2.cloudflarestorage.com",
        bucket="ecommerce-backup-v2",
        prefix="ecommerce-workspace/backup-v2",
        access_key="",
        secret_key="",
        enabled=False,
        full_interval_days=14,
        actor="pytest",
    )

    assert updated["configured"] is True
    assert updated["enabled"] is False
    assert updated["bucket"] == "ecommerce-backup-v2"
    assert updated["fullIntervalDays"] == 14

    runtime = r2_backup_service.runtime_config(db_session)
    assert runtime is not None
    assert runtime["access_key"] == "R2_AK_TEST_12345678"
    assert runtime["secret_key"] == "R2_SK_TEST_SUPER_SECRET"


def test_r2_config_api_never_returns_secret(client):
    response = client.put(
        "/api/v1/integrations/r2-backup",
        json={
            "endpointUrl": "https://account-id.r2.cloudflarestorage.com",
            "bucket": "ecommerce-backup-api",
            "prefix": "ecommerce-workspace/backup",
            "accessKey": "R2_AK_API_87654321",
            "secretKey": "R2_SK_API_SUPER_SECRET",
            "enabled": True,
            "fullIntervalDays": 10,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["readEnabled"] is True
    assert "secretKey" not in payload
    assert "accessKey" not in payload
    assert payload["accessKeyHint"].endswith("4321")

    fetched = client.get("/api/v1/integrations/r2-backup")
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload["bucket"] == "ecommerce-backup-api"
    assert fetched_payload["readEnabled"] is True
    assert "secretKey" not in fetched_payload
    assert "accessKey" not in fetched_payload
