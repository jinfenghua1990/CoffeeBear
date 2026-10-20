"""Client for the isolated NAS updater sidecar.

The business API never receives Docker socket access. It can only ask the
sidecar to inspect the latest validated GitHub release or apply that release.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from app.config import settings


def _token() -> str:
    path = Path(settings.DATA_DIR).expanduser() / "system-update" / "agent-token"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("NAS 更新器尚未安装或尚未启动") from exc
    if not value:
        raise RuntimeError("NAS 更新器授权令牌尚未初始化")
    return value


def _request(path: str, *, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    base = (settings.CONTAINER_UPDATE_AGENT_URL or "http://updater:8765").rstrip("/")
    url = base + path
    body = None
    headers = {"Authorization": "Bearer " + _token(), "Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            value = json.loads(response.read(2_000_000).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read(65536).decode("utf-8")).get("detail", str(exc))
        except Exception:
            detail = str(exc)
        raise RuntimeError(str(detail)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("无法连接 NAS 更新器；请检查更新器容器是否运行") from exc
    if not isinstance(value, dict):
        raise RuntimeError("NAS 更新器返回了无法识别的响应")
    return value


def _runtime_fields(current_sha: str, current_version: str, image_ref: str) -> dict[str, Any]:
    return {"currentSha": current_sha or "", "currentVersion": current_version or "", "currentImageRef": image_ref or ""}


def status_payload(*, current_sha: str, current_version: str, image_ref: str, runtime: dict[str, Any]) -> dict[str, Any]:
    try:
        query = urllib.parse.urlencode(_runtime_fields(current_sha, current_version, image_ref))
        value = _request("/status?" + query)
        value["updateAgentAvailable"] = True
        value["updateAgentError"] = ""
    except RuntimeError as exc:
        path = Path(settings.DATA_DIR).expanduser() / "system-update" / "container-status.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                value = {}
        except Exception:
            value = {}
        value.setdefault("phase", "idle")
        value.setdefault("progress", 0)
        value.setdefault("running", False)
        value.setdefault("message", "NAS 更新器尚未就绪")
        value.setdefault("changes", [])
        value.setdefault("logs", [])
        value.setdefault("history", [])
        value.setdefault("settings", _default_settings())
        value["currentSha"] = current_sha or value.get("currentSha", "")
        value["currentCommit"] = {
            "sha": current_sha or "",
            "shortSha": (current_sha or "")[:10],
            "subject": "当前运行版本",
            "committedAt": "",
            "version": current_version or image_ref or "未知版本",
        }
        value["updateAgentAvailable"] = False
        value["updateAgentError"] = str(exc)
        value["lastCheckError"] = str(exc)
    value["runtime"] = runtime
    value.setdefault("settings", _default_settings())
    value.setdefault("logs", [])
    value.setdefault("history", [])
    return value


def check(*, current_sha: str, current_version: str, image_ref: str) -> dict[str, Any]:
    value = _request("/check", method="POST", payload=_runtime_fields(current_sha, current_version, image_ref))
    value["updateAgentAvailable"] = True
    value["updateAgentError"] = ""
    return value


def apply(*, current_sha: str, current_version: str, image_ref: str, actor: str) -> dict[str, Any]:
    value = _request(
        "/apply",
        method="POST",
        payload={**_runtime_fields(current_sha, current_version, image_ref), "actor": actor},
    )
    value["updateAgentAvailable"] = True
    value["updateAgentError"] = ""
    return value


def readiness(*, current_sha: str, current_version: str, image_ref: str, runtime: dict[str, Any]) -> dict[str, Any]:
    status = status_payload(current_sha=current_sha, current_version=current_version, image_ref=image_ref, runtime=runtime)
    checks = [
        {
            "key": "container_update_agent",
            "label": "NAS 一键更新器",
            "status": "ok" if status.get("updateAgentAvailable") else "error",
            "detail": "隔离更新器已连接" if status.get("updateAgentAvailable") else str(status.get("updateAgentError") or "更新器不可用"),
            "blocking": not bool(status.get("updateAgentAvailable")),
        },
        {
            "key": "container_image",
            "label": "运行镜像",
            "status": "ok" if image_ref else "error",
            "detail": image_ref or "未注入 APP_IMAGE_REF",
            "blocking": not bool(image_ref),
        },
        {
            "key": "git_sha",
            "label": "Git Revision",
            "status": "ok" if current_sha else "warn",
            "detail": current_sha or "镜像未写入 GIT_SHA",
            "blocking": False,
        },
        {
            "key": "database_revision",
            "label": "数据库版本",
            "status": "ok" if runtime.get("alembicRevision") else "warn",
            "detail": str(runtime.get("alembicRevision") or "无法读取 alembic_version"),
            "blocking": False,
        },
    ]
    blocking = sum(1 for item in checks if item["blocking"] and item["status"] == "error")
    return {
        "ready": blocking == 0,
        "checks": checks,
        "blockingCount": blocking,
        "warningCount": sum(1 for item in checks if item["status"] == "warn"),
        "branch": "main",
        "remote": "github",
        "checkedAt": datetime.now().astimezone().isoformat(),
    }


def _default_settings() -> dict[str, Any]:
    return {
        "enabled": False,
        "mode": "manual",
        "checkIntervalMinutes": 60,
        "autoUpdateHour": 3,
        "autoUpdateWindowMinutes": 60,
        "autoInstallLevel": "patch",
        "branch": "main",
        "remote": "origin",
    }
