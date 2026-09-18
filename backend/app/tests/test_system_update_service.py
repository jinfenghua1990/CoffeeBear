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

