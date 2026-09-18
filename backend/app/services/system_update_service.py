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
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.config import settings

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_MODES = {"manual", "auto_download", "auto_update"}
_ACTIVE_PHASES = {"queued", "preflight", "backup", "installing", "migrating", "building", "restarting", "healthcheck", "rollback"}
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
        "branch": settings.SYSTEM_UPDATE_BRANCH,
        "remote": settings.SYSTEM_UPDATE_REMOTE,
    }


def load_update_settings() -> dict[str, Any]:
    base = default_update_settings()
    stored = _read_json(_settings_path(), {})
    # branch/remote 只允许部署配置决定，前端不可任意切换代码来源。
    for key in ("enabled", "mode", "checkIntervalMinutes", "autoUpdateHour", "autoUpdateWindowMinutes"):
        if key in stored:
            base[key] = stored[key]
    base["branch"] = settings.SYSTEM_UPDATE_BRANCH
    base["remote"] = settings.SYSTEM_UPDATE_REMOTE
    return _validate_settings(base)


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
    return {
        "enabled": bool(value.get("enabled", True)),
        "mode": mode,
        "checkIntervalMinutes": interval,
        "autoUpdateHour": hour,
        "autoUpdateWindowMinutes": window,
        "branch": settings.SYSTEM_UPDATE_BRANCH,
        "remote": settings.SYSTEM_UPDATE_REMOTE,
    }


def save_update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    current = load_update_settings()
    allowed = {"enabled", "mode", "checkIntervalMinutes", "autoUpdateHour", "autoUpdateWindowMinutes"}
    for key, value in patch.items():
        if key in allowed:
            current[key] = value
    current = _validate_settings(current)
    _atomic_json(_settings_path(), {k: current[k] for k in allowed})
    return current


def _run(args: list[str], *, timeout: int = 60, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd or _repo_root()),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
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
    result = _run(["git", "show", "-s", "--format=%H%x1f%s%x1f%cI", sha], timeout=20)
    if result.returncode != 0 or "\x1f" not in result.stdout:
        return None
    commit_sha, subject, committed_at = result.stdout.strip().split("\x1f", 2)
    return {"sha": commit_sha, "shortSha": commit_sha[:10], "subject": subject, "committedAt": committed_at}


def _changes(current_sha: str, latest_sha: str) -> list[dict[str, Any]]:
    result = _run(
        ["git", "log", "--format=%H%x1f%s%x1f%cI", "-20", f"{current_sha}..{latest_sha}"],
        timeout=20,
    )
    if result.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = line.split("\x1f", 2)
        if len(parts) != 3:
            continue
        rows.append({"sha": parts[0], "shortSha": parts[0][:10], "subject": parts[1], "committedAt": parts[2]})
    return rows


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
        if not cfg["enabled"]:
            return status_payload(include_log=False)

        root = _repo_root()
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
            diverged = current_sha != latest_sha and ancestor.returncode != 0
            available = current_sha != latest_sha and not diverged
            change_rows = _changes(current_sha, latest_sha) if available else []
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
                    and _in_auto_window(cfg)
                ):
                    await asyncio.to_thread(start_update, actor="system-scheduler")
        except Exception as exc:
            _write_status({"lastAutoError": str(exc), "lastAutoErrorAt": _now_iso()})
        await asyncio.sleep(interval * 60)
