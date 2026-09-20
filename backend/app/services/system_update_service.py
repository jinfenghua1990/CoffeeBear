"""系统自更新服务。

目标：只更新当前受控 Git 分支，不执行用户提供的任意命令/分支。
状态与配置写入 DATA_DIR/system-update，避免为运维配置引入数据库迁移。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import threading
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.config import settings

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_MODES = {"manual", "auto_download", "auto_update"}
_AUTO_INSTALL_LEVELS = {"patch", "feature", "major"}
_LEVEL_RANK = {"patch": 1, "feature": 2, "major": 3}
_ACTIVE_PHASES = {"queued", "preflight", "backup", "quiescing", "installing", "migrating", "building", "restarting", "healthcheck", "rollback"}
_LOCK = threading.RLock()


def _now_iso() -> str:
    return datetime.now(ZoneInfo(settings.TZ)).isoformat()


def _repo_root() -> Path:
    configured = (settings.SYSTEM_UPDATE_REPO_ROOT or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3]


def _state_dir() -> Path:
    path = Path(settings.DATA_DIR).expanduser() / "system-update"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _settings_path() -> Path:
    return _state_dir() / "settings.json"


def _status_path() -> Path:
    return _state_dir() / "status.json"


def _history_path() -> Path:
    return _state_dir() / "history.jsonl"


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else dict(default)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return dict(default)


def default_update_settings() -> dict[str, Any]:
    return {
        "enabled": bool(settings.SYSTEM_UPDATE_ENABLED),
        "mode": "auto_download",
        "checkIntervalMinutes": 10,
        "autoUpdateHour": 3,
        "autoUpdateWindowMinutes": 60,
        "autoInstallLevel": "patch",
        "branch": settings.SYSTEM_UPDATE_BRANCH,
        "remote": settings.SYSTEM_UPDATE_REMOTE,
    }


def load_update_settings() -> dict[str, Any]:
    base = default_update_settings()
    stored = _read_json(_settings_path(), {})
    # branch/remote 只允许部署配置决定，前端不可任意切换代码来源。
    for key in ("enabled", "mode", "checkIntervalMinutes", "autoUpdateHour", "autoUpdateWindowMinutes", "autoInstallLevel"):
        if key in stored:
            base[key] = stored[key]
    base["branch"] = settings.SYSTEM_UPDATE_BRANCH
    base["remote"] = settings.SYSTEM_UPDATE_REMOTE
    try:
        return _validate_settings(base)
    except (TypeError, ValueError):
        # 更新设置损坏或来自旧格式时回退安全默认值，避免状态页/轮询器一起失效。
        return _validate_settings(default_update_settings())


def _validate_settings(value: dict[str, Any]) -> dict[str, Any]:
    mode = str(value.get("mode") or "auto_download")
    if mode not in _MODES:
        raise ValueError("更新模式必须是 manual / auto_download / auto_update")
    interval = int(value.get("checkIntervalMinutes") or 10)
    if not 5 <= interval <= 1440:
        raise ValueError("检查间隔必须在 5～1440 分钟")
    hour = int(value.get("autoUpdateHour") if value.get("autoUpdateHour") is not None else 3)
    if not 0 <= hour <= 23:
        raise ValueError("自动更新时间必须是 0～23 点")
    window = int(value.get("autoUpdateWindowMinutes") or 60)
    if not 15 <= window <= 360:
        raise ValueError("自动更新窗口必须在 15～360 分钟")
    auto_install_level = str(value.get("autoInstallLevel") or "patch")
    if auto_install_level not in _AUTO_INSTALL_LEVELS:
        raise ValueError("自动安装范围必须是 patch / feature / major")
    return {
        "enabled": bool(value.get("enabled", True)),
        "mode": mode,
        "checkIntervalMinutes": interval,
        "autoUpdateHour": hour,
        "autoUpdateWindowMinutes": window,
        "autoInstallLevel": auto_install_level,
        "branch": settings.SYSTEM_UPDATE_BRANCH,
        "remote": settings.SYSTEM_UPDATE_REMOTE,
    }


def save_update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        runtime = _read_json(_status_path(), {})
        if runtime.get("phase") in _ACTIVE_PHASES and _pid_running(runtime.get("pid")):
            raise ValueError("系统更新正在执行，完成后再修改更新策略")
        current = load_update_settings()
        allowed = {"enabled", "mode", "checkIntervalMinutes", "autoUpdateHour", "autoUpdateWindowMinutes", "autoInstallLevel"}
        for key, value in patch.items():
            if key in allowed:
                current[key] = value
        current = _validate_settings(current)
        _atomic_json(_settings_path(), {k: current[k] for k in allowed})
        return current


def _run(args: list[str], *, timeout: int = 60, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if args and args[0] == "git":
        env["GIT_TERMINAL_PROMPT"] = "0"
    return subprocess.run(
        args,
        cwd=str(cwd or _repo_root()),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env=env,
    )


def _git(*args: str, timeout: int = 60) -> str:
    result = _run(["git", *args], timeout=timeout)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "git command failed").strip()
        raise RuntimeError(detail[-1200:])
    return result.stdout.strip()


def _commit_info(sha: str) -> dict[str, Any] | None:
    if not _SHA_RE.fullmatch(sha):
        return None
    try:
        result = _run(["git", "show", "-s", "--format=%H%x1f%s%x1f%cI", sha], timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0 or "\x1f" not in result.stdout:
        return None
    commit_sha, subject, committed_at = result.stdout.strip().split("\x1f", 2)
    return {"sha": commit_sha, "shortSha": commit_sha[:10], "subject": subject, "committedAt": committed_at}


def _changes(current_sha: str, latest_sha: str) -> list[dict[str, Any]]:
    try:
        result = _run(
            ["git", "log", "--format=%H%x1f%s%x1f%cI", "-20", f"{current_sha}..{latest_sha}"],
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = line.split("\x1f", 2)
        if len(parts) != 3:
            continue
        rows.append({"sha": parts[0], "shortSha": parts[0][:10], "subject": parts[1], "committedAt": parts[2]})
    return rows


def _changed_files(current_sha: str, latest_sha: str) -> list[str]:
    try:
        result = _run(["git", "diff", "--name-only", current_sha, latest_sha], timeout=30)
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


_MODULE_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("财务中心", ("frontend/src/app/finance/", "backend/app/services/finance", "backend/app/models/finance", "backend/app/api/v1/finance")),
    ("采购 / 供应链", ("frontend/src/app/purchase/", "frontend/src/app/supply-chain/", "frontend/src/app/procurement/", "frontend/src/app/suppliers/", "backend/app/services/purchase", "backend/app/services/procurement", "backend/app/services/supply", "backend/app/api/v1/purchase", "backend/app/api/v1/supply")),
    ("库存", ("frontend/src/app/inventory/", "backend/app/services/inventory", "backend/app/models/inventory", "backend/app/api/v1/inventory")),
    ("销售", ("frontend/src/app/sales/", "backend/app/services/sales", "backend/app/api/v1/sales")),
    ("快递物流", ("frontend/src/app/logistics/", "backend/app/services/logistics", "backend/app/api/v1/logistics")),
    ("外贸", ("frontend/src/app/foreign-trade/", "backend/app/services/foreign", "backend/app/models/foreign", "backend/app/api/v1/foreign")),
    ("系统设置 / 更新", ("frontend/src/app/settings/", "frontend/src/app/automation/", "frontend/src/components/top-bar", "frontend/src/lib/navigation", "backend/app/services/system_update", "backend/app/api/v1/system", "scripts/system_update")),
    ("数据接入", ("frontend/src/app/data-center-import/", "backend/app/adapters/", "backend/app/services/jky", "backend/app/services/alibaba", "backend/app/api/v1/integrations")),
]


def _classify_update(changes: list[dict[str, Any]], changed_files: list[str]) -> dict[str, Any]:
    subjects = [str(item.get("subject") or "") for item in changes]
    subject_blob = "\n".join(subjects).lower()
    level = "patch"
    reasons: list[str] = []

    explicit_major = (
        any(token in subject_blob for token in ("[major]", "breaking change", "breaking:", "major:"))
        or bool(re.search(r"(?m)^[a-z]+(?:\([^)]+\))?!:", subject_blob))
    )
    explicit_feature = (
        any(token in subject_blob for token in ("[feature]", "feature:"))
        or bool(re.search(r"(?m)^feat(?:\([^)]+\))?:", subject_blob))
    )
    infra_major_prefixes = (
        ".github/workflows/",
        "Dockerfile",
        "docker-compose",
        "compose.",
        "scripts/native-start",
        "backend/app/core/security",
        "backend/app/config.py",
        "backend/app/main.py",
    )
    has_infra_major = any(path.startswith(infra_major_prefixes) for path in changed_files)
    has_migration = any("alembic/versions/" in path or "/migrations/" in path for path in changed_files)
    has_model_change = any(path.startswith("backend/app/models/") for path in changed_files)

    if explicit_major or has_infra_major:
        level = "major"
        if explicit_major:
            reasons.append("提交明确标记为重大变更")
        if has_infra_major:
            reasons.append("涉及部署 / 安全 / 应用核心启动配置")
    elif explicit_feature or has_migration or has_model_change:
        level = "feature"
        if explicit_feature:
            reasons.append("提交包含新功能标记")
        if has_migration:
            reasons.append("包含数据库迁移")
        elif has_model_change:
            reasons.append("涉及数据模型")
    else:
        reasons.append("未检测到数据库、部署或重大结构变更")

    impacted_modules: list[str] = []
    for label, prefixes in _MODULE_RULES:
        if any(path.startswith(prefixes) for path in changed_files):
            impacted_modules.append(label)

    core_prefixes = (
        "frontend/src/lib/",
        "frontend/src/components/",
        "backend/app/db",
        "backend/app/config.py",
        "backend/app/main.py",
        "backend/app/core/",
        "backend/app/models/",
        "backend/alembic/",
        ".github/",
        "scripts/",
    )
    if any(path.startswith(core_prefixes) for path in changed_files) and "平台公共底层" not in impacted_modules:
        impacted_modules.append("平台公共底层")
    if not impacted_modules and changed_files:
        impacted_modules.append("其他 / 公共代码")

    return {
        "updateLevel": level,
        "updateLevelLabel": {"patch": "小版本", "feature": "功能版本", "major": "重大版本"}[level],
        "impactedModules": impacted_modules,
        "changedFiles": changed_files[:200],
        "changedFileCount": len(changed_files),
        "hasMigration": has_migration,
        "classificationReasons": reasons,
    }


def _auto_install_allowed(level: str, configured_level: str) -> bool:
    return _LEVEL_RANK.get(level, 99) <= _LEVEL_RANK.get(configured_level, 0)


def _write_status(patch: dict[str, Any]) -> dict[str, Any]:
    current = _read_json(_status_path(), {})
    current.update(patch)
    current["updatedAt"] = _now_iso()
    _atomic_json(_status_path(), current)
    return current


def _pid_running(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def _tail(path: str | None, max_lines: int = 120) -> list[str]:
    if not path:
        return []
    try:
        lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
        return lines[-max_lines:]
    except OSError:
        return []


def read_history(limit: int = 20) -> list[dict[str, Any]]:
    try:
        lines = _history_path().read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    rows: list[dict[str, Any]] = []
    for line in reversed(lines):
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
        if len(rows) >= max(1, min(limit, 100)):
            break
    return rows


def check_for_updates(*, actor: str = "system", automatic: bool = False) -> dict[str, Any]:
    """fetch 指定受控分支并比较版本；fetch 只下载对象，不改变工作区。"""
    with _LOCK:
        cfg = load_update_settings()
        # enabled 只控制后台轮询；管理员手工“检查更新”始终可用。
        if automatic and not cfg["enabled"]:
            return status_payload(include_log=False)

        current_sha = _git("rev-parse", "HEAD")
        current_branch = _git("branch", "--show-current")
        dirty = bool(_git("status", "--porcelain"))
        branch = cfg["branch"]
        remote = cfg["remote"]

        _write_status({
            "phase": "checking",
            "progress": 5,
            "message": "正在检查 GitHub 更新…",
            "lastCheckAt": _now_iso(),
            "lastCheckActor": actor,
        })
        try:
            _git("fetch", "--quiet", remote, branch, timeout=120)
            latest_sha = _git("rev-parse", "FETCH_HEAD")
            if not _SHA_RE.fullmatch(latest_sha):
                raise RuntimeError("远端返回的 commit 无效")

            ancestor = _run(["git", "merge-base", "--is-ancestor", current_sha, latest_sha], timeout=20)
            if ancestor.returncode not in {0, 1}:
                detail = (ancestor.stderr or ancestor.stdout or "git merge-base failed").strip()
                raise RuntimeError(detail[-1200:])
            diverged = current_sha != latest_sha and ancestor.returncode == 1
            available = current_sha != latest_sha and not diverged
            change_rows = _changes(current_sha, latest_sha) if available else []
            changed_files = _changed_files(current_sha, latest_sha) if available else []
            classification = _classify_update(change_rows, changed_files) if available else {
                "updateLevel": "patch",
                "updateLevelLabel": "小版本",
                "impactedModules": [],
                "changedFiles": [],
                "changedFileCount": 0,
                "hasMigration": False,
                "classificationReasons": [],
            }
            auto_install_eligible = bool(
                available
                and _auto_install_allowed(classification["updateLevel"], str(cfg.get("autoInstallLevel") or "patch"))
            )
            payload = {
                "phase": "idle",
                "progress": 0,
                "message": "发现新版本" if available else ("本地分支与远端已分叉" if diverged else "已是最新版本"),
                "currentSha": current_sha,
                "latestSha": latest_sha,
                "downloadedSha": latest_sha,
                "currentBranch": current_branch,
                "configuredBranch": branch,
                "dirty": dirty,
                "updateAvailable": available,
                "diverged": diverged,
                "latestCommit": _commit_info(latest_sha),
                "currentCommit": _commit_info(current_sha),
                "changes": change_rows,
                **classification,
                "autoInstallEligible": auto_install_eligible,
                "autoInstallBlockedReason": "" if auto_install_eligible else (
                    f"{classification['updateLevelLabel']} 超出自动安装范围"
                    if available else ""
                ),
                "lastCheckAt": _now_iso(),
                "lastCheckError": "",
                "automatic": automatic,
            }
            _write_status(payload)
            return status_payload(include_log=False)
        except Exception as exc:
            _write_status({
                "phase": "idle",
                "progress": 0,
                "message": "检查更新失败",
                "lastCheckAt": _now_iso(),
                "lastCheckError": str(exc),
                "updateAvailable": False,
                "diverged": False,
                "changes": [],
                "changedFiles": [],
                "changedFileCount": 0,
                "impactedModules": [],
                "hasMigration": False,
                "autoInstallEligible": False,
                "automatic": automatic,
            })
            return status_payload(include_log=False)


def _minute_in_window(minute: int, start: int, window: int) -> bool:
    end = (start + window) % (24 * 60)
    if window >= 24 * 60:
        return True
    if start + window < 24 * 60:
        return start <= minute < start + window
    return minute >= start or minute < end


def _in_auto_window(cfg: dict[str, Any]) -> bool:
    now = datetime.now(ZoneInfo(settings.TZ))
    start = cfg["autoUpdateHour"] * 60
    minute = now.hour * 60 + now.minute
    return _minute_in_window(minute, start, cfg["autoUpdateWindowMinutes"])


def update_readiness() -> dict[str, Any]:
    """检查当前 Mac 原生部署是否具备安全自更新条件，不修改代码和数据库。"""
    root = _repo_root()
    cfg = load_update_settings()
    checks: list[dict[str, Any]] = []

    def add(key: str, label: str, status: str, detail: str, *, blocking: bool = False) -> None:
        checks.append({
            "key": key,
            "label": label,
            "status": status,
            "detail": detail,
            "blocking": blocking,
        })

    git_dir = root / ".git"
    add(
        "git_repo", "Git 仓库",
        "ok" if git_dir.exists() else "error",
        str(root) if git_dir.exists() else f"{root} 不是 Git 工作区",
        blocking=not git_dir.exists(),
    )

    current_branch = ""
    dirty = False
    remote_url = ""
    if git_dir.exists():
        try:
            current_branch = _git("branch", "--show-current", timeout=10)
            branch_ok = current_branch == cfg["branch"]
            add(
                "branch", "当前分支",
                "ok" if branch_ok else "error",
                f"{current_branch or '(detached)'} / 目标 {cfg['branch']}",
                blocking=not branch_ok,
            )
        except Exception as exc:
            add("branch", "当前分支", "error", str(exc), blocking=True)

        try:
            dirty = bool(_git("status", "--porcelain", timeout=10))
            add(
                "worktree", "工作区状态",
                "error" if dirty else "ok",
                "存在未提交修改，自动更新会停止" if dirty else "干净，可安全快进更新",
                blocking=dirty,
            )
        except Exception as exc:
            add("worktree", "工作区状态", "error", str(exc), blocking=True)

        try:
            remote_url = _git("remote", "get-url", cfg["remote"], timeout=10)
            add("remote", "Git 远端", "ok", f"{cfg['remote']} · {remote_url}")
        except Exception as exc:
            add("remote", "Git 远端", "error", str(exc), blocking=True)

    python_path = root / "backend" / ".venv" / "bin" / "python"
    python_ok = python_path.is_file() and os.access(python_path, os.X_OK)
    add(
        "python", "Python 虚拟环境",
        "ok" if python_ok else "error",
        str(python_path) if python_ok else f"{python_path} 不存在或不可执行",
        blocking=not python_ok,
    )

    for command, label in (("git", "Git 命令"), ("make", "make"), ("node", "Node.js"), ("npm", "npm"), ("pg_dump", "pg_dump"), ("pg_restore", "pg_restore"), ("psql", "psql"), ("tar", "tar")):
        resolved = shutil.which(command)
        add(
            command, label,
            "ok" if resolved else "error",
            resolved or f"未在 PATH 中找到 {command}",
            blocking=resolved is None,
        )

    pip_path = root / "backend" / ".venv" / "bin" / "pip"
    pip_ok = pip_path.is_file() and os.access(pip_path, os.X_OK)
    add(
        "pip", "Python pip",
        "ok" if pip_ok else "error",
        str(pip_path) if pip_ok else f"{pip_path} 不存在或不可执行",
        blocking=not pip_ok,
    )

    runner_path = root / "scripts" / "system_update_runner.py"
    add(
        "update_runner", "更新执行器",
        "ok" if runner_path.is_file() else "error",
        str(runner_path),
        blocking=not runner_path.is_file(),
    )

    quiesce_path = root / "scripts" / "quiesce-update-workers.sh"
    add(
        "quiesce_workers", "后台任务暂停脚本",
        "ok" if quiesce_path.is_file() else "error",
        str(quiesce_path),
        blocking=not quiesce_path.is_file(),
    )

    backup_path = root / "scripts" / "backup.sh"
    backup_ok = backup_path.is_file() and os.access(backup_path, os.X_OK)
    add(
        "backup_script", "备份脚本",
        "ok" if backup_ok else "error",
        str(backup_path) if backup_ok else f"{backup_path} 不存在或不可执行",
        blocking=not backup_ok,
    )

    launchctl = shutil.which("launchctl")
    launch_label = getattr(settings, "SYSTEM_UPDATE_LAUNCH_LABEL", "com.gino.ecommerce-dashboard")
    if launchctl:
        service_ref = f"gui/{os.getuid()}/{launch_label}"
        try:
            probe = _run([launchctl, "print", service_ref], timeout=10)
            running_ok = probe.returncode == 0
            add(
                "launch_agent", "LaunchAgent",
                "ok" if running_ok else "error",
                service_ref if running_ok else f"{service_ref} 未加载，更新后无法自动重启",
                blocking=not running_ok,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            add("launch_agent", "LaunchAgent", "error", str(exc), blocking=True)
    else:
        add("launch_agent", "LaunchAgent", "error", "未找到 launchctl", blocking=True)

    try:
        state_dir = _state_dir()
        probe_file = state_dir / ".write-test"
        probe_file.write_text("ok", encoding="utf-8")
        probe_file.unlink(missing_ok=True)
        add("state_dir", "更新状态目录", "ok", str(state_dir))
    except Exception as exc:
        add("state_dir", "更新状态目录", "error", str(exc), blocking=True)

    try:
        disk = shutil.disk_usage(root)
        free_gb = disk.free / (1024 ** 3)
        disk_status = "error" if free_gb < 1 else ("warn" if free_gb < 3 else "ok")
        add(
            "disk_space", "可用磁盘空间",
            disk_status,
            f"{free_gb:.1f} GB 可用",
            blocking=free_gb < 1,
        )
    except Exception as exc:
        add("disk_space", "可用磁盘空间", "warn", str(exc))

    frontend_index = root / "frontend" / "out" / "index.html"
    add(
        "frontend_build", "当前前端产物",
        "ok" if frontend_index.is_file() else "warn",
        str(frontend_index) if frontend_index.is_file() else "当前无 frontend/out，更新时会重新构建",
    )

    try:
        with urllib.request.urlopen(settings.SYSTEM_UPDATE_HEALTH_URL, timeout=3) as response:
            health_ok = response.status == 200
        add(
            "health", "当前服务健康检查",
            "ok" if health_ok else "warn",
            settings.SYSTEM_UPDATE_HEALTH_URL,
        )
    except Exception as exc:
        add("health", "当前服务健康检查", "warn", f"{settings.SYSTEM_UPDATE_HEALTH_URL} · {exc}")

    blockers = [item for item in checks if item["blocking"] and item["status"] == "error"]
    warnings = [item for item in checks if item["status"] == "warn"]
    return {
        "ready": len(blockers) == 0,
        "checks": checks,
        "blockingCount": len(blockers),
        "warningCount": len(warnings),
        "branch": cfg["branch"],
        "remote": cfg["remote"],
        "checkedAt": _now_iso(),
    }


def _cleanup_old_artifacts(keep: int = 30) -> None:
    state_dir = _state_dir()
    for pattern in ("update_*.log", "runner_*.py"):
        rows = sorted(
            state_dir.glob(pattern),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for path in rows[keep:]:
            try:
                path.unlink()
            except OSError:
                pass


def start_update(*, actor: str = "system") -> dict[str, Any]:
    with _LOCK:
        readiness = update_readiness()
        if not readiness["ready"]:
            labels = "、".join(item["label"] for item in readiness["checks"] if item["blocking"] and item["status"] == "error")
            raise ValueError(f"更新环境未就绪：{labels}。请先在更新中心查看环境自检。")
        runtime = _read_json(_status_path(), {})
        if _pid_running(runtime.get("pid")) and runtime.get("phase") in _ACTIVE_PHASES:
            raise ValueError("已有更新任务正在执行")

        checked = check_for_updates(actor=actor, automatic=False)
        if checked.get("lastCheckError"):
            raise ValueError(f"无法开始更新：{checked['lastCheckError']}")
        if checked.get("diverged"):
            raise ValueError("本地分支与远端已分叉，禁止自动覆盖，请先人工处理 Git 历史")
        if checked.get("dirty"):
            raise ValueError("项目存在未提交修改，禁止自动更新，避免覆盖本地代码")
        if not checked.get("updateAvailable"):
            return {**status_payload(include_log=False), "started": False, "reason": "already_latest"}

        target_sha = str(checked.get("latestSha") or "")
        if not _SHA_RE.fullmatch(target_sha):
            raise ValueError("目标 commit 无效")

        run_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        _cleanup_old_artifacts()
        state_dir = _state_dir()
        source_runner = _repo_root() / "scripts" / "system_update_runner.py"
        if not source_runner.is_file():
            raise ValueError("系统更新执行器不存在")
        runner = state_dir / f"runner_{run_id}.py"
        shutil.copy2(source_runner, runner)
        log_path = state_dir / f"update_{run_id}.log"

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        command = [
            str(_repo_root() / "backend" / ".venv" / "bin" / "python"),
            str(runner),
            "--root", str(_repo_root()),
            "--data-dir", str(Path(settings.DATA_DIR).expanduser()),
            "--target", target_sha,
            "--branch", settings.SYSTEM_UPDATE_BRANCH,
            "--remote", settings.SYSTEM_UPDATE_REMOTE,
            "--actor", actor,
            "--health-url", settings.SYSTEM_UPDATE_HEALTH_URL,
        ]
        with log_path.open("a", encoding="utf-8") as log_file:
            proc = subprocess.Popen(
                command,
                cwd=str(_repo_root()),
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        _write_status({
            "runId": run_id,
            "pid": proc.pid,
            "phase": "queued",
            "progress": 1,
            "message": "更新任务已启动",
            "targetSha": target_sha,
            "previousSha": checked.get("currentSha"),
            "logFile": str(log_path),
            "startedAt": _now_iso(),
            "startedBy": actor,
        })
        return {**status_payload(include_log=True), "started": True}


def status_payload(*, include_log: bool = True) -> dict[str, Any]:
    runtime = _read_json(_status_path(), {})
    try:
        current_sha = _git("rev-parse", "HEAD", timeout=10)
        current_branch = _git("branch", "--show-current", timeout=10)
    except Exception:
        current_sha = str(runtime.get("currentSha") or "")
        current_branch = str(runtime.get("currentBranch") or "")
    runtime["currentSha"] = current_sha
    runtime["currentBranch"] = current_branch
    runtime["currentCommit"] = _commit_info(current_sha) if current_sha else None
    runtime["settings"] = load_update_settings()
    runtime["history"] = read_history(20)
    runtime["running"] = _pid_running(runtime.get("pid")) and runtime.get("phase") not in {"success", "failed", "rolled_back", "idle"}
    if include_log:
        runtime["logs"] = _tail(runtime.get("logFile"), 120)
    return runtime


async def poll_loop() -> None:
    """API 常驻期间定时检测；auto_update 只在配置窗口内真正部署。"""
    # 启动后稍等，避免与 seed / 启动健康检查抢资源。
    await asyncio.sleep(20)
    while True:
        cfg = load_update_settings()
        interval = max(5, int(cfg["checkIntervalMinutes"]))
        try:
            runtime = _read_json(_status_path(), {})
            active_phase = runtime.get("phase") in _ACTIVE_PHASES
            updater_alive = _pid_running(runtime.get("pid"))
            # 新版本重启 API 时 updater 仍在外部进程中做健康检查；此时绝不能由新 API
            # 再 fetch/改写 status.json，否则会覆盖正在执行的进度与回滚状态。
            if active_phase and updater_alive:
                await asyncio.sleep(min(interval * 60, 60))
                continue
            if active_phase and not updater_alive:
                _write_status({
                    "phase": "failed",
                    "progress": 100,
                    "message": "更新执行器意外中断，请检查日志后重新操作",
                    "lastAutoError": "检测到更新阶段状态，但执行器进程已退出",
                    "lastAutoErrorAt": _now_iso(),
                })
            elif cfg["enabled"] and cfg["mode"] in {"auto_download", "auto_update"}:
                checked = await asyncio.to_thread(check_for_updates, actor="system-scheduler", automatic=True)
                if (
                    cfg["mode"] == "auto_update"
                    and checked.get("updateAvailable")
                    and not checked.get("dirty")
                    and not checked.get("diverged")
                    and checked.get("autoInstallEligible")
                    and _in_auto_window(cfg)
                ):
                    await asyncio.to_thread(start_update, actor="system-scheduler")
        except Exception as exc:
            _write_status({"lastAutoError": str(exc), "lastAutoErrorAt": _now_iso()})
        await asyncio.sleep(interval * 60)
