from app.services import container_update_service


def test_container_update_status_reports_missing_agent(monkeypatch, tmp_path):
    monkeypatch.setattr(container_update_service.settings, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        container_update_service.settings,
        "CONTAINER_UPDATE_AGENT_URL",
        "http://127.0.0.1:1",
    )
    runtime = {
        "deploymentMode": "container",
        "version": "sha-1234567890ab",
        "imageRef": "ghcr.io/jinfenghua1990/coffeebear@sha256:" + "a" * 64,
        "alembicRevision": "rev123",
    }

    result = container_update_service.status_payload(
        current_sha="1" * 40,
        current_version=runtime["version"],
        image_ref=runtime["imageRef"],
        runtime=runtime,
    )

    assert result["updateAgentAvailable"] is False
    assert "更新器" in result["updateAgentError"]
    assert result["runtime"] == runtime
    assert result["settings"]["mode"] == "manual"


def test_container_update_readiness_blocks_missing_agent(monkeypatch, tmp_path):
    monkeypatch.setattr(container_update_service.settings, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        container_update_service.settings,
        "CONTAINER_UPDATE_AGENT_URL",
        "http://127.0.0.1:1",
    )
    runtime = {"version": "sha-1234567890ab", "imageRef": "image", "alembicRevision": "rev123"}

    result = container_update_service.readiness(
        current_sha="1" * 40,
        current_version=runtime["version"],
        image_ref=runtime["imageRef"],
        runtime=runtime,
    )

    assert result["ready"] is False
    assert result["blockingCount"] == 1
    assert any(item["key"] == "container_update_agent" and item["blocking"] for item in result["checks"])


def test_container_update_check_and_apply_delegate_to_agent(monkeypatch):
    captured = []

    def fake_request(path, *, method="GET", payload=None):
        captured.append((path, method, payload))
        return {"updateAvailable": True, "started": method == "POST" and path == "/apply"}

    monkeypatch.setattr(container_update_service, "_request", fake_request)
    checked = container_update_service.check(current_sha="1" * 40, current_version="old", image_ref="old-image")
    applied = container_update_service.apply(
        current_sha="1" * 40,
        current_version="old",
        image_ref="old-image",
        actor="admin-user",
    )

    assert checked["updateAvailable"] is True
    assert applied["started"] is True
    assert captured[0][0] == "/check"
    assert captured[1][0] == "/apply"
    assert captured[1][2]["actor"] == "admin-user"
