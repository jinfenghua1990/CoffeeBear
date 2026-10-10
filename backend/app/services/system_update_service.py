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
from urllib.parse import urlsplit
import uuid
from datetime import datetime
from fnmatch import fnmatch
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
_TARGET_REPOSITORY = "jinfenghua1990/zhejiang"


def _now_iso() -> str:
    return datetime.now(ZoneInfo(settings.TZ)).isoformat()


def _repo_root() -> Path:
    configured = (settings.SYSTEM_UPDATE_REPO_ROOT or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3]


def _resolve_runtime_path(raw: str, *, root: Path, fallback: Path) -> Path:
    value = (raw or "").strip()
    path = Path(value).expanduser() if value else fallback
    if not path.is_absolute():
        path = root / path
    return path.resolve()


def _is_path_inside_repo(path: Path, root: Path) -> bool:
    resolved_root = root.resolve()
    resolved_path = path.resolve()
    return resolved_path == resolved_root or resolved_root in resolved_path.parents


def _production_persistence_policy(root: Path) -> dict[str, Any]:
    """Return the production data-separation contract without mutating the filesystem."""
    root = root.resolve()
    persist_raw = (settings.PERSIST_ROOT or "").strip()
    persist_root = (
        _resolve_runtime_path(persist_raw, root=root, fallback=root)
        if persist_raw
        else None
    )
    data_dir = _resolve_runtime_path(
        settings.DATA_DIR,
        root=root,
        fallback=(persist_root / "data" if persist_root else root / "data"),
    )
    backup_dir = _resolve_runtime_path(
        settings.BACKUP_DIR,
        root=root,
        fallback=(persist_root / "backups" if persist_root else root / "backups"),
    )
    log_dir = _resolve_runtime_path(
        settings.LOG_DIR,
        root=root,
        fallback=(persist_root / "logs" if persist_root else root / "logs"),
    )

    issues: list[str] = []
    if persist_root is None:
        issues.append("PERSIST_ROOT 未配置")
    elif _is_path_inside_repo(persist_root, root):
        issues.append(f"PERSIST_ROOT 位于代码目录内：{persist_root}")

    for label, path in (
        ("DATA_DIR", data_dir),
        ("BACKUP_DIR", backup_dir),
        ("LOG_DIR", log_dir),
    ):
        if _is_path_inside_repo(path, root):
            issues.append(f"{label} 位于代码目录内：{path}")

    database_url = (settings.DATABASE_URL or "").strip().lower()
    if not (
        database_url.startswith("postgresql://")
        or database_url.startswith("postgresql+")
    ):
        issues.append("DATABASE_URL 不是独立 PostgreSQL 数据库")

    return {
        "ok": not issues,
        "issues": issues,
        "persistRoot": str(persist_root) if persist_root else "",
        "dataDir": str(data_dir),
        "backupDir": str(backup_dir),
        "logDir": str(log_dir),
    }


def _database_target(url: str) -> tuple[str, int, str]:
    parsed = urlsplit(url)
    return (
        (parsed.hostname or "").lower(),
        parsed.port or 5432,
        (parsed.path or "").lstrip("/"),
    )


def _database_username(url: str) -> str:
    try:
        return urlsplit(url).username or ""
    except ValueError:
        return ""


def _migration_database_policy() -> dict[str, Any]:
    """Validate migration/runtime DB separation without exposing credentials."""
    app_url = (settings.DATABASE_URL or "").strip()
    migration_url = (settings.MIGRATION_DATABASE_URL or "").strip()
    app_user = _database_username(app_url)

    if not migration_url:
        return {
            "configured": False,
            "sameTarget": True,
            "separated": False,
            "appUser": app_user,
            "migrationUser": "",
            "issues": ["MIGRATION_DATABASE_URL 未配置，迁移仍兼容使用业务 DATABASE_URL"],
        }

    migration_user = _database_username(migration_url)
    try:
        same_target = _database_target(app_url) == _database_target(migration_url)
    except ValueError:
        same_target = False

    issues: list[str] = []
    if not same_target:
        issues.append("MIGRATION_DATABASE_URL 与 DATABASE_URL 指向不同数据库")
    if app_user and migration_user and app_user == migration_user:
        issues.append("业务运行与数据库迁移仍使用同一账号")

    return {
        "configured": True,
        "sameTarget": same_target,
        "separated": bool(same_target and app_user and migration_user and app_user != migration_user),
        "appUser": app_user,
        "migrationUser": migration_user,
        "issues": issues,
    }


def _remote_repository_name(remote_url: str) -> str:
    """Extract the repository name from HTTPS/SSH Git remotes."""
    value = (remote_url or "").strip().rstrip("/")
    if value.endswith(".git"):
        value = value[:-4]
    return re.split(r"[:/]", value)[-1].lower() if value else ""


def _is_legacy_repo_remote(remote_url: str) -> bool:
    """Only the new zhejiang repository may be used as the runtime update source."""
    value = (remote_url or "").strip().rstrip("/")
    # Local bare remotes are used by isolated service tests; they are not a
    # production GitHub source and remain valid for those tests.
    if "://" not in value and not value.startswith("git@"):
        return False
    if value.startswith("git@"):
        repository = value.split(":", 1)[-1]
    else:
        repository = urlsplit(value).path.lstrip("/")
    if repository.endswith(".git"):
        repository = repository[:-4]
    return repository.lower() != _TARGET_REPOSITORY


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


def _repo_update_lock_dir() -> Path:
    return _repo_root() / ".git" / "ecommerce-system-update.lock"


def _lock_owner_path() -> Path:
    return _repo_update_lock_dir() / "owner.json"


def _read_update_lock_owner() -> dict[str, Any]:
    return _read_json(_lock_owner_path(), {})


def _cleanup_stale_update_lock() -> bool:
    lock_dir = _repo_update_lock_dir()
    if not lock_dir.exists():
        return True
    owner = _read_update_lock_owner()
    if _pid_running(owner.get("pid")):
        return False
    try:
        shutil.rmtree(lock_dir)
    except FileNotFoundError:
        pass
    return True


def _acquire_update_lock(*, run_id: str, target_sha: str, actor: str) -> None:
    lock_dir = _repo_update_lock_dir()
    lock_dir.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            os.mkdir(lock_dir)
            _atomic_json(
                _lock_owner_path(),
                {
                    "runId": run_id,
                    "pid": os.getpid(),
                    "targetSha": target_sha,
                    "actor": actor,
                    "acquiredAt": _now_iso(),
                },
            )
            return
        except FileExistsError:
            if not _cleanup_stale_update_lock():
                owner = _read_update_lock_owner()
                raise ValueError(
                    "已有系统更新持有全局更新锁"
                    + (f"（任务 {owner.get('runId')}）" if owner.get("runId") else "")
                )
    raise ValueError("无法取得系统更新全局锁")


def _handoff_update_lock(*, run_id: str, pid: int) -> None:
    lock_dir = _repo_update_lock_dir()
    if not lock_dir.exists():
        return
    owner = _read_update_lock_owner()
    if owner.get("runId") != run_id:
        return
    owner["pid"] = int(pid)
    owner["runnerStartedAt"] = _now_iso()
    _atomic_json(_lock_owner_path(), owner)


def _release_update_lock(*, run_id: str) -> None:
    lock_dir = _repo_update_lock_dir()
    if not lock_dir.exists():
        return
    owner = _read_update_lock_owner()
    if owner.get("runId") not in {None, "", run_id}:
        return
    shutil.rmtree(lock_dir, ignore_errors=True)


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
        env["ECOMMERCE_UPDATE_SERVICE_GIT"] = "1"
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



_LOCAL_HANDOFF_BLOCKED_PREFIXES: tuple[str, ...] = (
    "data/",
    "backups/",
    "logs/",
    "keys/",
    ".next/",
    "node_modules/",
    "frontend/.next/",
    "frontend/node_modules/",
    "frontend/out/",
)
_LOCAL_HANDOFF_BLOCKED_SUFFIXES: tuple[str, ...] = (
    ".xlsx",
    ".xls",
    ".csv",
    ".sqlite",
    ".sqlite3",
    ".dump",
    ".sql.gz",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".log",
)
_LOCAL_HANDOFF_ALLOWED_NEW_SUFFIXES: tuple[str, ...] = (
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".cfg",
    ".sh",
    ".css",
    ".scss",
    ".html",
    ".txt",
)
_LOCAL_HANDOFF_ALLOWED_NEW_NAMES = {
    "Dockerfile",
    "Makefile",
    "VERSION",
    ".gitignore",
    ".dockerignore",
}
_LOCAL_HANDOFF_PROTECTED_RULES = [
    "data/、backups/、logs/、keys/ 等运行时目录不会上传",
    ".env / runtime.env / 密钥文件不会上传",
    "Excel、CSV、数据库、dump、日志等业务数据文件不会自动上传",
    "未跟踪的新文件默认只允许代码、配置、文档类文本文件进入交接分支",
]


def _local_handoff_path() -> Path:
    return _state_dir() / "local-handoff.json"


def _normalize_repo_path(path: str) -> str:
    normalized = path.replace("\\\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def _local_handoff_file_policy(path: str, *, tracked: bool) -> tuple[bool, str]:
    normalized = _normalize_repo_path(path)
    lower = normalized.lower()
    name = Path(normalized).name
    lower_name = name.lower()

    if not normalized or normalized.startswith("../") or normalized.startswith("/"):
        return False, "路径不在项目目录内"
    if lower_name == ".env" or lower_name.startswith(".env."):
        return False, "环境变量文件"
    if lower_name == "runtime.env" or lower.endswith("/runtime.env"):
        return False, "运行时凭证"
    if any(lower.startswith(prefix.lower()) for prefix in _LOCAL_HANDOFF_BLOCKED_PREFIXES):
        return False, "本地持久化 / 构建目录"
    if any(lower.endswith(suffix) for suffix in _LOCAL_HANDOFF_BLOCKED_SUFFIXES):
        return False, "业务数据或敏感文件类型"

    if not tracked:
        suffix = Path(normalized).suffix.lower()
        if name not in _LOCAL_HANDOFF_ALLOWED_NEW_NAMES and suffix not in _LOCAL_HANDOFF_ALLOWED_NEW_SUFFIXES:
            return False, "未跟踪的新文件类型不在自动上传白名单"

    return True, ""


def _local_worktree_entries() -> list[dict[str, Any]]:
    """Return tracked/untracked changes relative to HEAD without touching the index."""
    root = _repo_root()
    tracked_status: dict[str, str] = {}
    status_output = _git("-c", "core.quotepath=false", "diff", "HEAD", "--name-status", "--no-renames", timeout=30)
    for line in status_output.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        tracked_status[_normalize_repo_path(parts[1])] = parts[0].strip() or "M"

    numstat: dict[str, tuple[int | None, int | None]] = {}
    numstat_output = _git("-c", "core.quotepath=false", "diff", "HEAD", "--numstat", "--no-renames", timeout=30)
    for line in numstat_output.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        added_raw, deleted_raw, raw_path = parts
        try:
            added = int(added_raw)
        except ValueError:
            added = None
        try:
            deleted = int(deleted_raw)
        except ValueError:
            deleted = None
        numstat[_normalize_repo_path(raw_path)] = (added, deleted)

    untracked_output = _git("-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", timeout=30)
    untracked_paths = [
        _normalize_repo_path(line.strip())
        for line in untracked_output.splitlines()
        if line.strip()
    ]

    rows: list[dict[str, Any]] = []
    for path in sorted(tracked_status):
        eligible, reason = _local_handoff_file_policy(path, tracked=True)
        added, deleted = numstat.get(path, (None, None))
        file_path = root / path
        rows.append({
            "path": path,
            "status": tracked_status[path],
            "tracked": True,
            "eligible": eligible,
            "excludedReason": reason,
            "added": added,
            "deleted": deleted,
            "size": file_path.stat().st_size if file_path.is_file() else 0,
        })

    for path in sorted(set(untracked_paths) - set(tracked_status)):
        eligible, reason = _local_handoff_file_policy(path, tracked=False)
        file_path = root / path
        rows.append({
            "path": path,
            "status": "??",
            "tracked": False,
            "eligible": eligible,
            "excludedReason": reason,
            "added": None,
            "deleted": None,
            "size": file_path.stat().st_size if file_path.is_file() else 0,
        })
    return rows


def local_changes_payload(*, include_diff: bool = False) -> dict[str, Any]:
    """Inspect local edits for safe GitHub handoff without mutating Git state."""
    root = _repo_root()
    if not (root / ".git").exists():
        raise ValueError(f"{root} 不是可管理的 Git 工作区")

    base_sha = _git("rev-parse", "HEAD", timeout=10)
    current_branch = _git("branch", "--show-current", timeout=10)
    entries = _local_worktree_entries()
    eligible = [item for item in entries if item["eligible"]]
    excluded = [item for item in entries if not item["eligible"]]
    eligible_paths = [str(item["path"]) for item in eligible]

    total_added = sum(int(item["added"] or 0) for item in eligible)
    total_deleted = sum(int(item["deleted"] or 0) for item in eligible)
    patch = ""
    if include_diff and eligible_paths:
        tracked_paths = [str(item["path"]) for item in eligible if item["tracked"]]
        if tracked_paths:
            result = _run(
                ["git", "diff", "HEAD", "--no-ext-diff", "--unified=2", "--", *tracked_paths],
                timeout=60,
            )
            if result.returncode == 0:
                patch = result.stdout[:120000]

    last_upload = _read_json(_local_handoff_path(), {})
    last_sync = _read_json(_state_dir() / "local-sync.json", {})
    return {
        "dirty": bool(entries),
        "baseSha": base_sha,
        "currentBranch": current_branch,
        "eligibleCount": len(eligible),
        "excludedCount": len(excluded),
        "totalAdded": total_added,
        "totalDeleted": total_deleted,
        "impactedModules": _modules_for_paths(eligible_paths),
        "files": eligible,
        "excludedFiles": excluded,
        "protectedRules": list(_LOCAL_HANDOFF_PROTECTED_RULES),
        "diffPreview": patch,
        "lastUpload": last_upload or None,
        "lastSync": last_sync or None,
        "worktreePreserved": True,
        "checkedAt": _now_iso(),
    }


def _run_git_with_index(
    index_path: Path,
    args: list[str],
    *,
    timeout: int = 60,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["ECOMMERCE_UPDATE_SERVICE_GIT"] = "1"
    env["GIT_INDEX_FILE"] = str(index_path)
    return subprocess.run(
        ["git", *args],
        cwd=str(_repo_root()),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env=env,
    )


def _raise_git_result(result: subprocess.CompletedProcess[str], fallback: str) -> None:
    if result.returncode == 0:
        return
    detail = (result.stderr or result.stdout or fallback).strip()
    raise RuntimeError(detail[-1600:])


def _create_worktree_snapshot_commit(
    *,
    base_sha: str,
    eligible_paths: list[str],
    message: str,
    index_prefix: str,
) -> str:
    """Create a commit from allowed worktree paths without touching the real index."""
    index_path = _state_dir() / f".{index_prefix}-index-{uuid.uuid4().hex}"
    try:
        index_path.unlink(missing_ok=True)
        read_tree = _run_git_with_index(index_path, ["read-tree", base_sha], timeout=30)
        _raise_git_result(read_tree, "无法创建临时 Git 索引")

        staged = _run_git_with_index(
            index_path,
            ["add", "-A", "--", *eligible_paths],
            timeout=120,
        )
        _raise_git_result(staged, "无法暂存本地修改快照")

        staged_names_result = _run_git_with_index(
            index_path,
            ["diff", "--cached", "--name-only", "--no-renames"],
            timeout=30,
        )
        _raise_git_result(staged_names_result, "无法校验本地修改快照")
        staged_names = [
            _normalize_repo_path(line.strip())
            for line in staged_names_result.stdout.splitlines()
            if line.strip()
        ]
        unexpected = [path for path in staged_names if path not in eligible_paths]
        if unexpected:
            raise RuntimeError(f"快照出现未授权文件：{', '.join(unexpected[:8])}")
        for path in staged_names:
            allowed, reason = _local_handoff_file_policy(path, tracked=True)
            if not allowed:
                raise RuntimeError(f"受保护文件禁止进入同步提交：{path}（{reason}）")

        tree_result = _run_git_with_index(index_path, ["write-tree"], timeout=30)
        _raise_git_result(tree_result, "无法生成本地修改快照")
        tree_sha = tree_result.stdout.strip()
        base_tree = _git("rev-parse", f"{base_sha}^{{tree}}", timeout=10)
        if tree_sha == base_tree:
            raise ValueError("允许同步的文件没有形成有效代码变更")

        commit_result = _run(
            ["git", "commit-tree", tree_sha, "-p", base_sha, "-m", message],
            timeout=30,
        )
        _raise_git_result(commit_result, "无法创建本地同步提交")
        commit_sha = commit_result.stdout.strip()
        if not _SHA_RE.fullmatch(commit_sha):
            raise RuntimeError("Git 返回的同步 commit 无效")
        return commit_sha
    finally:
        index_path.unlink(missing_ok=True)


def _next_local_handoff_branch(remote: str) -> str:
    stamp = datetime.now(ZoneInfo(settings.TZ)).strftime("%Y%m%d-%H%M%S")
    base = f"local/{stamp}"
    for index in range(20):
        candidate = base if index == 0 else f"{base}-{index + 1}"
        probe = _run(
            ["git", "ls-remote", "--exit-code", "--heads", remote, f"refs/heads/{candidate}"],
            timeout=30,
        )
        if probe.returncode == 2:
            return candidate
        if probe.returncode not in {0, 2}:
            _raise_git_result(probe, "无法检查远端交接分支")
    raise RuntimeError("无法生成唯一的本地修改交接分支")


def upload_local_changes(*, actor: str = "system") -> dict[str, Any]:
    """Push a safe snapshot of local edits to a new local/* branch.

    A temporary Git index is used so the current branch, real index and working
    tree remain exactly as they were before the upload.
    """
    if settings.DEPLOYMENT_MODE == "container":
        raise ValueError("容器模式不支持从运行实例上传本地代码修改")

    with _LOCK:
        runtime = _read_json(_status_path(), {})
        if runtime.get("phase") in _ACTIVE_PHASES and _pid_running(runtime.get("pid")):
            raise ValueError("系统更新正在执行，完成后再上传本地修改")
        lock_owner = _read_update_lock_owner() if _repo_update_lock_dir().exists() else {}
        if _pid_running(lock_owner.get("pid")):
            raise ValueError("系统更新全局锁正在占用，完成后再上传本地修改")

        payload = local_changes_payload(include_diff=False)
        eligible_paths = [str(item["path"]) for item in payload["files"]]
        if not eligible_paths:
            if payload["dirty"]:
                raise ValueError("检测到的修改全部属于受保护或不允许自动上传的文件")
            raise ValueError("当前没有需要上传的本地修改")
        if len(eligible_paths) > 500:
            raise ValueError("本次修改文件超过 500 个，请先拆分后再上传")

        cfg = load_update_settings()
        remote = str(cfg["remote"])
        remote_probe = _run(["git", "remote", "get-url", remote], timeout=10)
        _raise_git_result(remote_probe, "无法读取 Git 远端")
        remote_url = remote_probe.stdout.strip()
        if _is_legacy_repo_remote(remote_url):
            raise ValueError("当前远端不是受控仓库 zhejiang，禁止上传本地修改")

        base_sha = str(payload["baseSha"])
        branch = _next_local_handoff_branch(remote)
        local_ref_created = False
        commit_sha = ""
        try:
            message = (
                "local: 本地修改交接 "
                + datetime.now(ZoneInfo(settings.TZ)).strftime("%Y-%m-%d %H:%M")
                + f"\n\nUploaded by system update center · actor={actor}"
            )
            commit_sha = _create_worktree_snapshot_commit(
                base_sha=base_sha,
                eligible_paths=eligible_paths,
                message=message,
                index_prefix="local-handoff",
            )

            ref_result = _run(
                ["git", "update-ref", f"refs/heads/{branch}", commit_sha],
                timeout=20,
            )
            _raise_git_result(ref_result, "无法创建本地交接分支")
            local_ref_created = True

            push_result = _run(
                ["git", "push", remote, f"refs/heads/{branch}:refs/heads/{branch}"],
                timeout=180,
            )
            _raise_git_result(push_result, "无法把本地修改上传到 GitHub")
        except Exception:
            if local_ref_created:
                _run(["git", "update-ref", "-d", f"refs/heads/{branch}"], timeout=20)
            raise
        record = {
            "branch": branch,
            "commitSha": commit_sha,
            "shortSha": commit_sha[:10],
            "baseSha": base_sha,
            "uploadedAt": _now_iso(),
            "uploadedBy": actor,
            "fileCount": len(eligible_paths),
            "excludedCount": int(payload["excludedCount"]),
            "files": eligible_paths[:200],
            "worktreePreserved": True,
        }
        _atomic_json(_local_handoff_path(), record)
        return {
            "ok": True,
            **record,
            "message": "本地修改已上传到独立 GitHub 分支；当前工作区和分支未被切换。",
            "localChanges": local_changes_payload(include_diff=False),
        }


def _git_ancestry_relation(current_sha: str, remote_sha: str) -> str:
    """Describe whether two commits are equal, ahead, behind, or diverged."""
    if current_sha == remote_sha:
        return "same"

    current_is_ancestor = _run(
        ["git", "merge-base", "--is-ancestor", current_sha, remote_sha],
        timeout=20,
    )
    if current_is_ancestor.returncode not in {0, 1}:
        _raise_git_result(current_is_ancestor, "无法判断本地与云端 Git 历史")
    if current_is_ancestor.returncode == 0:
        return "remote_ahead"

    remote_is_ancestor = _run(
        ["git", "merge-base", "--is-ancestor", remote_sha, current_sha],
        timeout=20,
    )
    if remote_is_ancestor.returncode not in {0, 1}:
        _raise_git_result(remote_is_ancestor, "无法判断本地与云端 Git 历史")
    return "local_ahead" if remote_is_ancestor.returncode == 0 else "diverged"


def sync_local_changes(*, actor: str = "system") -> dict[str, Any]:
    """Commit allowed local code changes to the configured branch safely."""
    if settings.DEPLOYMENT_MODE == "container":
        raise ValueError("容器模式不支持从运行实例同步本地代码")

    with _LOCK:
        runtime = _read_json(_status_path(), {})
        if runtime.get("phase") in _ACTIVE_PHASES and _pid_running(runtime.get("pid")):
            raise ValueError("系统更新正在执行，完成后再同步本地修改")
        lock_owner = _read_update_lock_owner() if _repo_update_lock_dir().exists() else {}
        if _pid_running(lock_owner.get("pid")):
            raise ValueError("系统更新全局锁正在占用，完成后再同步本地修改")

        cfg = load_update_settings()
        branch = str(cfg["branch"])
        remote = str(cfg["remote"])
        current_branch = _git("branch", "--show-current", timeout=10)
        if current_branch != branch:
            raise ValueError(f"当前分支是 {current_branch or '(detached)'}，只能在 {branch} 上同步")

        remote_probe = _run(["git", "remote", "get-url", remote], timeout=10)
        _raise_git_result(remote_probe, "无法读取 Git 远端")
        remote_url = remote_probe.stdout.strip()
        if _is_legacy_repo_remote(remote_url):
            raise ValueError("当前远端不是受控仓库 zhejiang，禁止同步本地修改")

        payload = local_changes_payload(include_diff=False)
        eligible_paths = [str(item["path"]) for item in payload["files"]]
        if len(eligible_paths) > 500:
            raise ValueError("本次修改文件超过 500 个，请先拆分后再同步")

        base_sha = str(payload["baseSha"])
        _git("fetch", "--quiet", remote, branch, timeout=120)
        remote_sha = _git("rev-parse", "FETCH_HEAD", timeout=10)
        if not _SHA_RE.fullmatch(remote_sha):
            raise RuntimeError("远端返回的 commit 无效")
        relation = _git_ancestry_relation(base_sha, remote_sha)
        if relation == "remote_ahead":
            raise ValueError(f"云端 {branch} 已有新提交，请先执行“从云端同步到本地”，再上传本地修改")
        if relation == "diverged":
            raise ValueError(f"本地与云端 {branch} 已分叉，禁止覆盖；请先人工合并后再同步")
        if not eligible_paths and relation == "same":
            if payload["dirty"]:
                raise ValueError("检测到的修改全部属于受保护文件，未同步任何业务数据")
            raise ValueError("本地与云端已经一致，没有需要同步的代码")
        if not eligible_paths and payload["dirty"]:
            raise ValueError("检测到的修改全部属于受保护文件，未同步任何业务数据")

        commit_sha = ""
        branch_updated = False
        push_completed = False
        try:
            if eligible_paths:
                message = (
                    f"sync: 同步本地修改到 {branch} "
                    + datetime.now(ZoneInfo(settings.TZ)).strftime("%Y-%m-%d %H:%M")
                    + f"\n\nSynced by system update center · actor={actor}"
                )
                commit_sha = _create_worktree_snapshot_commit(
                    base_sha=base_sha,
                    eligible_paths=eligible_paths,
                    message=message,
                    index_prefix="local-sync",
                )
                ref_result = _run(
                    ["git", "update-ref", f"refs/heads/{branch}", commit_sha, base_sha],
                    timeout=20,
                )
                _raise_git_result(ref_result, f"无法更新本地 {branch} 分支")
                branch_updated = True

            pushed_sha = commit_sha or base_sha
            push_result = _run(
                ["git", "push", remote, f"refs/heads/{branch}:refs/heads/{branch}"],
                timeout=180,
            )
            _raise_git_result(push_result, f"无法把本地 {branch} 同步到 GitHub")
            push_completed = True

            if eligible_paths:
                staged = _run(["git", "add", "-A", "--", *eligible_paths], timeout=120)
                _raise_git_result(staged, "云端已同步，但本地索引未能整理，请检查工作区状态")
        except Exception:
            if branch_updated and not push_completed:
                _run(
                    ["git", "update-ref", f"refs/heads/{branch}", base_sha, commit_sha],
                    timeout=20,
                )
            raise

        record = {
            "branch": branch,
            "commitSha": pushed_sha,
            "shortSha": pushed_sha[:10],
            "baseSha": base_sha,
            "remoteShaBefore": remote_sha,
            "syncedAt": _now_iso(),
            "syncedBy": actor,
            "fileCount": len(eligible_paths),
            "excludedCount": int(payload["excludedCount"]),
            "files": eligible_paths[:200],
            "worktreePreserved": True,
        }
        _atomic_json(_state_dir() / "local-sync.json", record)
        checked = check_for_updates(actor=actor, automatic=False)
        return {
            "ok": True,
            **record,
            "message": (
                f"本地代码已同步到 GitHub {branch}；"
                + ("受保护文件仍保留在本地，未上传。" if payload["excludedCount"] else "本地工作区已与云端代码一致。")
            ),
            "localChanges": local_changes_payload(include_diff=False),
            "status": checked,
        }


def _version_from_time(value: str) -> str:
    """使用项目时区把提交时间转成可读版本号，例如 2026.09.20.1830。"""
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(settings.TZ))
        local = dt.astimezone(ZoneInfo(settings.TZ))
        return local.strftime("%Y.%m.%d.%H%M")
    except (TypeError, ValueError):
        return ""


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
    return {
        "sha": commit_sha,
        "shortSha": commit_sha[:10],
        "subject": subject,
        "committedAt": committed_at,
        "version": _version_from_time(committed_at),
    }


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
    """Return the complete changed-file set between two releases.

    git diff is the primary source. Some long-lived/native worktrees have
    occasionally returned an empty stdout even though the two commits differ;
    in that case fall back to the commit range and de-duplicate file names so
    the update UI never silently reports zero files for a real update.
    """
    if current_sha == latest_sha:
        return []

    try:
        result = _run(
            ["git", "diff", "--name-only", "--no-renames", current_sha, latest_sha],
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        result = None

    if result is not None and result.returncode == 0:
        rows = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if rows:
            return list(dict.fromkeys(rows))

    try:
        fallback = _run(
            [
                "git",
                "log",
                "--format=",
                "--name-only",
                "--no-renames",
                f"{current_sha}..{latest_sha}",
            ],
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return []

    if fallback.returncode != 0:
        return []
    return list(dict.fromkeys(
        line.strip()
        for line in fallback.stdout.splitlines()
        if line.strip()
    ))


_MODULE_VERSION_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("home", "经营中心", (
        "frontend/src/app/page.tsx",
        "backend/app/api/v1/dashboard.py",
        "backend/app/services/dashboard.py",
    )),
    ("sales", "销售中心", (
        "frontend/src/app/sales/**",
        "backend/app/api/v1/sales*.py",
        "backend/app/services/sales*.py",
        "backend/app/models/sales.py",
    )),
    ("products", "基础货品", (
        "frontend/src/app/products/**",
        "backend/app/models/catalog.py",
        "backend/app/services/master_data_import_service.py",
        "backend/app/services/tax_category_rule_service.py",
    )),
    ("inventory", "库存中心", (
        "frontend/src/app/inventory/**",
        "frontend/src/app/supply-chain/warehouses/**",
        "backend/app/api/v1/warehouses.py",
        "backend/app/services/inventory*.py",
        "backend/app/services/warehouse*.py",
        "backend/app/models/consumable.py",
    )),
    ("supply", "供应链中心", (
        "frontend/src/app/supply-chain/**",
        "frontend/src/app/purchase/**",
        "frontend/src/app/procurement*/**",
        "frontend/src/app/suppliers/**",
        "frontend/src/app/data-center-import/**",
        "backend/app/api/v1/purchase*.py",
        "backend/app/api/v1/procurement*.py",
        "backend/app/api/v1/supply_chain*.py",
        "backend/app/api/v1/suppliers.py",
        "backend/app/api/v1/alibaba1688*.py",
        "backend/app/api/v1/jky*.py",
        "backend/app/services/purchase*.py",
        "backend/app/services/procurement*.py",
        "backend/app/services/production*.py",
        "backend/app/services/supplier*.py",
        "backend/app/services/alibaba1688*.py",
        "backend/app/services/jky*.py",
        "backend/app/models/purchase.py",
        "backend/app/models/procurement_chain.py",
        "backend/app/models/production.py",
    )),
    ("finance", "财务中心", (
        "frontend/src/app/finance/**",
        "frontend/src/app/payments/**",
        "frontend/src/app/profit/**",
        "frontend/src/app/tax-invoices/**",
        "backend/app/api/v1/finance.py",
        "backend/app/api/v1/closing.py",
        "backend/app/api/v1/opening.py",
        "backend/app/api/v1/profit.py",
        "backend/app/api/v1/reconciliation.py",
        "backend/app/api/v1/tax*.py",
        "backend/app/services/bank*.py",
        "backend/app/services/finance*.py",
        "backend/app/services/closing.py",
        "backend/app/services/opening.py",
        "backend/app/services/profit.py",
        "backend/app/services/reconciliation.py",
        "backend/app/services/invoice*.py",
        "backend/app/services/payment*.py",
        "backend/app/services/tax*.py",
        "backend/app/models/bank.py",
        "backend/app/models/finance.py",
        "backend/app/models/payment.py",
        "backend/app/models/profit.py",
        "backend/app/models/tax.py",
    )),
    ("logistics", "快递物流", (
        "frontend/src/app/logistics/**",
        "backend/app/api/v1/logistics.py",
        "backend/app/services/logistics*.py",
        "backend/app/models/logistics.py",
    )),
    ("foreign", "外贸中心", (
        "frontend/src/app/foreign-trade/**",
        "backend/app/api/v1/foreign_trade.py",
        "backend/app/services/foreign_trade*.py",
        "backend/app/models/foreign_trade.py",
    )),
    ("data", "异常中心", (
        "frontend/src/app/exceptions/**",
        "backend/app/api/v1/exceptions.py",
    )),
    ("system", "系统设置", (
        "frontend/src/app/settings/**",
        "frontend/src/app/automation/**",
        "backend/app/api/v1/system.py",
        "backend/app/api/v1/automation.py",
        "backend/app/services/system_update_service.py",
        "backend/app/services/backup_status_service.py",
        "backend/app/services/r2_backup_service.py",
        "backend/app/services/kodo_backup_service.py",
        "scripts/**",
        "deploy/**",
    )),
]

_MODULE_RULES: list[tuple[str, tuple[str, ...]]] = [
    (label, patterns) for _key, label, patterns in _MODULE_VERSION_RULES
]

_PUBLIC_PLATFORM_PATTERNS: tuple[str, ...] = (
    "frontend/src/lib/**",
    "frontend/src/components/**",
    "backend/app/db/**",
    "backend/app/config.py",
    "backend/app/main.py",
    "backend/app/core/**",
    "backend/app/models/base.py",
    "backend/app/models/org.py",
    "backend/alembic/**",
    ".github/**",
)


def _path_matches_any(path: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch(path, pattern) for pattern in patterns)


def _modules_for_paths(paths: list[str]) -> list[str]:
    modules: list[str] = []
    for _key, label, patterns in _MODULE_VERSION_RULES:
        if any(_path_matches_any(path, patterns) for path in paths):
            modules.append(label)
    if any(_path_matches_any(path, _PUBLIC_PLATFORM_PATTERNS) for path in paths):
        modules.append("平台公共底层")
    if not modules and paths:
        modules.append("其他 / 公共代码")
    return modules


def _commit_changed_files(sha: str) -> list[str]:
    if not _SHA_RE.fullmatch(sha):
        return []
    try:
        output = _git(
            "show",
            "--pretty=format:",
            "--name-only",
            "--no-renames",
            sha,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def _module_commit_at(sha: str, patterns: tuple[str, ...]) -> dict[str, Any] | None:
    if not _SHA_RE.fullmatch(sha):
        return None
    pathspecs = [f":(glob){pattern}" for pattern in patterns]
    try:
        output = _git(
            "log",
            "-1",
            "--format=%H%x1f%s%x1f%cI",
            sha,
            "--",
            *pathspecs,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return None
    if not output or "\x1f" not in output:
        return None
    commit_sha, subject, committed_at = output.split("\x1f", 2)
    return {
        "sha": commit_sha,
        "shortSha": commit_sha[:10],
        "subject": subject,
        "committedAt": committed_at,
        "version": _version_from_time(committed_at),
    }


def _module_versions(current_sha: str, latest_sha: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    same_system_version = current_sha == latest_sha
    for key, label, patterns in _MODULE_VERSION_RULES:
        current = _module_commit_at(current_sha, patterns)
        latest = current if same_system_version else _module_commit_at(latest_sha, patterns)
        current_module_sha = str((current or {}).get("sha") or "")
        latest_module_sha = str((latest or {}).get("sha") or "")
        if not current and not latest:
            state = "untracked"
        elif current_module_sha == latest_module_sha:
            state = "latest"
        else:
            state = "update"
        rows.append({
            "key": key,
            "label": label,
            "status": state,
            "currentVersion": str((current or {}).get("version") or ""),
            "currentSha": current_module_sha,
            "currentSubject": str((current or {}).get("subject") or ""),
            "currentCommittedAt": str((current or {}).get("committedAt") or ""),
            "latestVersion": str((latest or {}).get("version") or ""),
            "latestSha": latest_module_sha,
            "latestSubject": str((latest or {}).get("subject") or ""),
            "latestCommittedAt": str((latest or {}).get("committedAt") or ""),
        })
    return rows


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
        "scripts/start",
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

    impacted_modules = _modules_for_paths(changed_files)

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
