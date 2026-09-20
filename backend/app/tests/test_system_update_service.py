from pathlib import Path
import subprocess

import pytest

from app.services import system_update_service as service


def test_update_settings_validation_and_cross_midnight_window():
    cfg = service._validate_settings({
        "enabled": True,
        "mode": "auto_update",
        "checkIntervalMinutes": 10,
        "autoUpdateHour": 23,
        "autoUpdateWindowMinutes": 120,
    })
    assert cfg["mode"] == "auto_update"
    assert service._minute_in_window(23 * 60 + 30, 23 * 60, 120) is True
    assert service._minute_in_window(30, 23 * 60, 120) is True
    assert service._minute_in_window(120, 23 * 60, 120) is False

    with pytest.raises(ValueError):
        service._validate_settings({**cfg, "mode": "unknown"})
    with pytest.raises(ValueError):
        service._validate_settings({**cfg, "checkIntervalMinutes": 1})


def test_check_for_updates_returns_complete_status(monkeypatch, tmp_path: Path):
    current = "1" * 40
    latest = "2" * 40
    status_file = tmp_path / "status.json"
    settings_file = tmp_path / "settings.json"
    history_file = tmp_path / "history.jsonl"

    monkeypatch.setattr(service, "_status_path", lambda: status_file)
    monkeypatch.setattr(service, "_settings_path", lambda: settings_file)
    monkeypatch.setattr(service, "_history_path", lambda: history_file)
    monkeypatch.setattr(service, "_repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        service,
        "load_update_settings",
        lambda: {
            "enabled": True,
            "mode": "auto_download",
            "checkIntervalMinutes": 10,
            "autoUpdateHour": 3,
            "autoUpdateWindowMinutes": 60,
            "branch": service.settings.SYSTEM_UPDATE_BRANCH,
            "remote": service.settings.SYSTEM_UPDATE_REMOTE,
        },
    )

    def fake_git(*args: str, timeout: int = 60) -> str:
        if args == ("rev-parse", "HEAD"):
            return current
        if args == ("branch", "--show-current"):
            return service.settings.SYSTEM_UPDATE_BRANCH
        if args == ("status", "--porcelain"):
            return ""
        if args[:2] == ("fetch", "--quiet"):
            return ""
        if args == ("rev-parse", "FETCH_HEAD"):
            return latest
        raise AssertionError(f"unexpected git call: {args}")

    monkeypatch.setattr(service, "_git", fake_git)
    monkeypatch.setattr(
        service,
        "_run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
    )
    monkeypatch.setattr(
        service,
        "_commit_info",
        lambda sha: {"sha": sha, "shortSha": sha[:10], "subject": f"commit-{sha[:4]}", "committedAt": "2026-09-18T00:00:00+08:00"},
    )
    monkeypatch.setattr(
        service,
        "_changes",
        lambda old, new: [{"sha": new, "shortSha": new[:10], "subject": "new", "committedAt": "2026-09-18T00:00:00+08:00"}],
    )

    result = service.check_for_updates(actor="pytest")
    assert result["updateAvailable"] is True
    assert result["currentSha"] == current
    assert result["latestSha"] == latest
    assert result["settings"]["mode"] == "auto_download"
    assert result["changes"][0]["subject"] == "new"


def test_manual_check_still_works_when_background_service_disabled(monkeypatch, tmp_path: Path):
    current = "3" * 40
    latest = "4" * 40
    status_file = tmp_path / "status.json"
    settings_file = tmp_path / "settings.json"
    history_file = tmp_path / "history.jsonl"

    monkeypatch.setattr(service, "_status_path", lambda: status_file)
    monkeypatch.setattr(service, "_settings_path", lambda: settings_file)
    monkeypatch.setattr(service, "_history_path", lambda: history_file)
    monkeypatch.setattr(service, "_repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        service,
        "load_update_settings",
        lambda: {
            "enabled": False,
            "mode": "manual",
            "checkIntervalMinutes": 10,
            "autoUpdateHour": 3,
            "autoUpdateWindowMinutes": 60,
            "branch": service.settings.SYSTEM_UPDATE_BRANCH,
            "remote": service.settings.SYSTEM_UPDATE_REMOTE,
        },
    )

    calls: list[tuple[str, ...]] = []

    def fake_git(*args: str, timeout: int = 60) -> str:
        calls.append(args)
        if args == ("rev-parse", "HEAD"):
            return current
        if args == ("branch", "--show-current"):
            return service.settings.SYSTEM_UPDATE_BRANCH
        if args == ("status", "--porcelain"):
            return ""
        if args[:2] == ("fetch", "--quiet"):
            return ""
        if args == ("rev-parse", "FETCH_HEAD"):
            return latest
        raise AssertionError(f"unexpected git call: {args}")

    monkeypatch.setattr(service, "_git", fake_git)
    monkeypatch.setattr(
        service,
        "_run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
    )
    monkeypatch.setattr(service, "_commit_info", lambda sha: {"sha": sha, "shortSha": sha[:10], "subject": "x", "committedAt": "2026-09-19T00:00:00+08:00"})
    monkeypatch.setattr(service, "_changes", lambda old, new: [])

    result = service.check_for_updates(actor="pytest", automatic=False)
    assert result["updateAvailable"] is True
    assert any(call[:2] == ("fetch", "--quiet") for call in calls)


def test_start_update_stops_when_readiness_is_blocked(monkeypatch):
    monkeypatch.setattr(
        service,
        "update_readiness",
        lambda: {
            "ready": False,
            "blockingCount": 1,
            "warningCount": 0,
            "checks": [
                {
                    "key": "branch",
                    "label": "当前分支",
                    "status": "error",
                    "detail": "wrong branch",
                    "blocking": True,
                }
            ],
        },
    )
    with pytest.raises(ValueError, match="更新环境未就绪"):
        service.start_update(actor="pytest")

def test_check_preserves_last_install_result(monkeypatch, tmp_path: Path):
    current = "5" * 40
    status_file = tmp_path / "status.json"
    history_file = tmp_path / "history.jsonl"

    monkeypatch.setattr(service, "_status_path", lambda: status_file)
    monkeypatch.setattr(service, "_history_path", lambda: history_file)
    monkeypatch.setattr(service, "_repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        service,
        "load_update_settings",
        lambda: {
            "enabled": True,
            "mode": "auto_download",
            "checkIntervalMinutes": 10,
            "autoUpdateHour": 3,
            "autoUpdateWindowMinutes": 60,
            "branch": service.settings.SYSTEM_UPDATE_BRANCH,
            "remote": service.settings.SYSTEM_UPDATE_REMOTE,
        },
    )
    service._atomic_json(
        status_file,
        {
            "lastInstallResult": "success",
            "lastInstallAt": "2026-09-19T01:00:00+08:00",
            "lastInstallFromSha": "a" * 40,
            "lastInstallToSha": "b" * 40,
        },
    )

    def fake_git(*args: str, timeout: int = 60) -> str:
        if args == ("rev-parse", "HEAD"):
            return current
        if args == ("branch", "--show-current"):
            return service.settings.SYSTEM_UPDATE_BRANCH
        if args == ("status", "--porcelain"):
            return ""
        if args[:2] == ("fetch", "--quiet"):
            return ""
        if args == ("rev-parse", "FETCH_HEAD"):
            return current
        raise AssertionError(f"unexpected git call: {args}")

    monkeypatch.setattr(service, "_git", fake_git)
    monkeypatch.setattr(
        service,
        "_run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
    )
    monkeypatch.setattr(
        service,
        "_commit_info",
        lambda sha: {
            "sha": sha,
            "shortSha": sha[:10],
            "subject": "same",
            "committedAt": "2026-09-19T01:00:00+08:00",
        },
    )

    result = service.check_for_updates(actor="pytest")

    assert result["lastInstallResult"] == "success"
    assert result["lastInstallAt"] == "2026-09-19T01:00:00+08:00"
    assert result["lastInstallFromSha"] == "a" * 40
    assert result["lastInstallToSha"] == "b" * 40



def test_load_update_settings_falls_back_when_stored_file_is_invalid(monkeypatch, tmp_path: Path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        '{"mode":"broken","checkIntervalMinutes":1}',
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "_settings_path", lambda: settings_file)

    result = service.load_update_settings()

    assert result["mode"] == "auto_download"
    assert result["checkIntervalMinutes"] == 10


def test_save_update_settings_rejects_changes_during_active_update(monkeypatch, tmp_path: Path):
    status_file = tmp_path / "status.json"
    settings_file = tmp_path / "settings.json"
    status_file.write_text('{"phase":"migrating","pid":12345}', encoding="utf-8")

    monkeypatch.setattr(service, "_status_path", lambda: status_file)
    monkeypatch.setattr(service, "_settings_path", lambda: settings_file)
    monkeypatch.setattr(service, "_pid_running", lambda pid: pid == 12345)

    with pytest.raises(ValueError, match="系统更新正在执行"):
        service.save_update_settings({"mode": "manual"})


def test_git_merge_base_operational_error_is_not_treated_as_divergence(monkeypatch, tmp_path: Path):
    current = "6" * 40
    latest = "7" * 40
    status_file = tmp_path / "status.json"
    history_file = tmp_path / "history.jsonl"

    monkeypatch.setattr(service, "_status_path", lambda: status_file)
    monkeypatch.setattr(service, "_history_path", lambda: history_file)
    monkeypatch.setattr(service, "_repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        service,
        "load_update_settings",
        lambda: {
            "enabled": True,
            "mode": "manual",
            "checkIntervalMinutes": 10,
            "autoUpdateHour": 3,
            "autoUpdateWindowMinutes": 60,
            "branch": service.settings.SYSTEM_UPDATE_BRANCH,
            "remote": service.settings.SYSTEM_UPDATE_REMOTE,
        },
    )

    def fake_git(*args: str, timeout: int = 60) -> str:
        if args == ("rev-parse", "HEAD"):
            return current
        if args == ("branch", "--show-current"):
            return service.settings.SYSTEM_UPDATE_BRANCH
        if args == ("status", "--porcelain"):
            return ""
        if args[:2] == ("fetch", "--quiet"):
            return ""
        if args == ("rev-parse", "FETCH_HEAD"):
            return latest
        raise AssertionError(f"unexpected git call: {args}")

    monkeypatch.setattr(service, "_git", fake_git)
    monkeypatch.setattr(
        service,
        "_run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=128,
            stdout="",
            stderr="fatal: repository transport error",
        ),
    )

    result = service.check_for_updates(actor="pytest")

    assert result["updateAvailable"] is False
    assert result["diverged"] is False
    assert "repository transport error" in result["lastCheckError"]
    assert result["changes"] == []


def test_update_classification_detects_patch_module_and_auto_policy():
    result = service._classify_update(
        [{"subject": "fix: 修复月结页面", "sha": "a" * 40}],
        ["frontend/src/app/finance/monthly-send/page.tsx"],
    )
    assert result["updateLevel"] == "patch"
    assert "财务中心" in result["impactedModules"]
    assert result["hasMigration"] is False
    assert service._auto_install_allowed("patch", "patch") is True
    assert service._auto_install_allowed("feature", "patch") is False


def test_update_classification_promotes_migration_to_feature():
    result = service._classify_update(
        [{"subject": "feat: 新增付款明细", "sha": "b" * 40}],
        [
            "backend/alembic/versions/20260920_add_payment_detail.py",
            "frontend/src/app/finance/page.tsx",
        ],
    )
    assert result["updateLevel"] == "feature"
    assert result["hasMigration"] is True
    assert "财务中心" in result["impactedModules"]
    assert "平台公共底层" in result["impactedModules"]
    assert service._auto_install_allowed("feature", "feature") is True


def test_update_classification_marks_core_deployment_change_major():
    result = service._classify_update(
        [{"subject": "chore: 调整启动配置", "sha": "c" * 40}],
        ["backend/app/config.py"],
    )
    assert result["updateLevel"] == "major"
    assert "平台公共底层" in result["impactedModules"]
    assert service._auto_install_allowed("major", "feature") is False


def test_update_settings_accept_auto_install_level():
    cfg = service._validate_settings({
        "enabled": True,
        "mode": "auto_update",
        "checkIntervalMinutes": 10,
        "autoUpdateHour": 3,
        "autoUpdateWindowMinutes": 60,
        "autoInstallLevel": "feature",
    })
    assert cfg["autoInstallLevel"] == "feature"

    with pytest.raises(ValueError, match="自动安装范围"):
        service._validate_settings({**cfg, "autoInstallLevel": "unsafe"})


def test_time_based_version_uses_project_timezone(monkeypatch):
    monkeypatch.setattr(service.settings, "TZ", "Asia/Shanghai")
    assert service._version_from_time("2026-09-20T10:30:00+00:00") == "2026.09.20.1830"
    assert service._version_from_time("2026-09-20T18:30:00+08:00") == "2026.09.20.1830"
