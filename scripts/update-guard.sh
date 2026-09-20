#!/usr/bin/env bash
set -euo pipefail

resolve_root() {
  if [[ -n "${1:-}" ]]; then
    (cd "$1" && pwd)
    return
  fi
  git rev-parse --show-toplevel 2>/dev/null
}

lock_dir_for_root() {
  local root="$1"
  local git_dir
  git_dir="$(git -C "$root" rev-parse --absolute-git-dir 2>/dev/null)"
  printf '%s/ecommerce-system-update.lock' "$git_dir"
}

read_owner_field() {
  local file="$1"
  local key="$2"
  python3 - "$file" "$key" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    data = {}
value = data.get(key, "")
print(value if value is not None else "")
PY
}

cleanup_stale_lock() {
  local lock_dir="$1"
  local owner_file="$lock_dir/owner.json"
  [[ -d "$lock_dir" ]] || return 0

  local pid=""
  if [[ -f "$owner_file" ]]; then
    pid="$(read_owner_field "$owner_file" pid 2>/dev/null || true)"
  fi

  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  rm -rf "$lock_dir"
  return 0
}

guard_check() {
  local root
  root="$(resolve_root "${1:-}")"
  local lock_dir
  lock_dir="$(lock_dir_for_root "$root")"

  [[ -d "$lock_dir" ]] || return 0
  if cleanup_stale_lock "$lock_dir"; then
    return 0
  fi

  local owner_file="$lock_dir/owner.json"
  local run_id=""
  local pid=""
  local target=""
  if [[ -f "$owner_file" ]]; then
    run_id="$(read_owner_field "$owner_file" runId 2>/dev/null || true)"
    pid="$(read_owner_field "$owner_file" pid 2>/dev/null || true)"
    target="$(read_owner_field "$owner_file" targetSha 2>/dev/null || true)"
  fi

  if [[ -n "${ECOMMERCE_UPDATE_RUN_ID:-}" && -n "$run_id" && "${ECOMMERCE_UPDATE_RUN_ID}" == "$run_id" ]]; then
    return 0
  fi

  echo "系统更新正在执行，已阻止并发修改当前仓库。" >&2
  [[ -n "$run_id" ]] && echo "更新任务：$run_id" >&2
  [[ -n "$pid" ]] && echo "更新进程：$pid" >&2
  [[ -n "$target" ]] && echo "目标版本：${target:0:10}" >&2
  echo "请等待“系统设置 → 系统更新”完成后再执行 git pull / migrate / build / restart。" >&2
  return 73
}

install_hook() {
  local root
  root="$(resolve_root "${1:-}")"
  local git_dir
  git_dir="$(git -C "$root" rev-parse --absolute-git-dir)"
  local hooks_dir="$git_dir/ecommerce-hooks"
  local hook="$hooks_dir/reference-transaction"

  mkdir -p "$hooks_dir"
  cp "$root/scripts/update-guard.sh" "$hook"
  chmod 755 "$hook"
  git -C "$root" config --local core.hooksPath "$hooks_dir"
  echo "update guard installed: $hook"
}

hook_main() {
  local phase="${1:-}"
  [[ "$phase" == "prepared" ]] || exit 0
  guard_check ""
}

case "$(basename "$0")" in
  reference-transaction)
    hook_main "${1:-}"
    ;;
  *)
    command="${1:-check}"
    case "$command" in
      check)
        guard_check "${2:-}"
        ;;
      install)
        install_hook "${2:-}"
        ;;
      status)
        root="$(resolve_root "${2:-}")"
        lock_dir="$(lock_dir_for_root "$root")"
        if [[ -d "$lock_dir" ]] && ! cleanup_stale_lock "$lock_dir"; then
          echo "locked"
          cat "$lock_dir/owner.json" 2>/dev/null || true
          exit 1
        fi
        echo "unlocked"
        ;;
      *)
        echo "usage: $0 {check|install|status} [repo-root]" >&2
        exit 2
        ;;
    esac
    ;;
esac
