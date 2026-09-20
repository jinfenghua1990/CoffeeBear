from app.config import settings
from app.models.integration import IntegrationCredential
from app.services import kodo_backup_service


def test_kodo_config_encrypts_secrets_and_never_exposes_them(db_session, monkeypatch):
    monkeypatch.setattr(settings, "APP_SECRET_KEY", "pytest-kodo-secret-for-fernet")

    saved = kodo_backup_service.save_config(
        db_session,
        bucket="cold-backup-test",
        upload_url="https://up-test.example.invalid",
        prefix="ecommerce-workspace/cold",
        access_key="AK_TEST_12345678",
        secret_key="SK_TEST_SUPER_SECRET",
        enabled=True,
        actor="pytest",
    )

    assert saved["configured"] is True
    assert saved["enabled"] is True
    assert saved["readEnabled"] is False
    assert saved["mode"] == "upload_only"
    assert saved["accessKeyHint"].endswith("5678")
    assert "access_key" not in saved
    assert "secret_key" not in saved

    row = (
        db_session.query(IntegrationCredential)
        .filter_by(provider=kodo_backup_service.PROVIDER)
        .order_by(IntegrationCredential.id.desc())
        .first()
    )
    assert row is not None
    assert "AK_TEST_12345678" not in row.secret_encrypted
    assert "SK_TEST_SUPER_SECRET" not in row.secret_encrypted

    runtime = kodo_backup_service.runtime_config(db_session)
    assert runtime is not None
    assert runtime["access_key"] == "AK_TEST_12345678"
    assert runtime["secret_key"] == "SK_TEST_SUPER_SECRET"
    assert runtime["readEnabled"] is False


def test_kodo_config_update_keeps_existing_secret_when_fields_are_blank(db_session, monkeypatch):
    monkeypatch.setattr(settings, "APP_SECRET_KEY", "pytest-kodo-secret-for-fernet")

    kodo_backup_service.save_config(
        db_session,
        bucket="cold-backup-test",
        upload_url="https://up-test.example.invalid",
        prefix="ecommerce-workspace/cold",
        access_key="AK_TEST_12345678",
        secret_key="SK_TEST_SUPER_SECRET",
        enabled=True,
        actor="pytest",
    )
    updated = kodo_backup_service.save_config(
        db_session,
        bucket="cold-backup-test-2",
        upload_url="https://up-test-2.example.invalid",
        prefix="ecommerce-workspace/cold-v2",
        access_key="",
        secret_key="",
        enabled=False,
        actor="pytest",
    )

    assert updated["configured"] is True
    assert updated["enabled"] is False
    assert updated["bucket"] == "cold-backup-test-2"

    runtime = kodo_backup_service.runtime_config(db_session)
    assert runtime is not None
    assert runtime["access_key"] == "AK_TEST_12345678"
    assert runtime["secret_key"] == "SK_TEST_SUPER_SECRET"


def test_kodo_config_api_never_returns_secret(client):
    response = client.put(
        "/api/v1/integrations/kodo-cold",
        json={
            "bucket": "cold-backup-api-test",
            "uploadUrl": "https://up-api-test.example.invalid",
            "prefix": "ecommerce-workspace/cold",
            "accessKey": "AK_API_TEST_87654321",
            "secretKey": "SK_API_TEST_SUPER_SECRET",
            "enabled": True,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["readEnabled"] is False
    assert "secretKey" not in payload
    assert "accessKey" not in payload
    assert payload["accessKeyHint"].endswith("4321")

    fetched = client.get("/api/v1/integrations/kodo-cold")
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload["bucket"] == "cold-backup-api-test"
    assert fetched_payload["readEnabled"] is False
    assert "secretKey" not in fetched_payload
    assert "accessKey" not in fetched_payload
