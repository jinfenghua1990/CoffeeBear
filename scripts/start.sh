#!/bin/bash
# 生产启动脚本（8001 端口）—— 唯一电商平台实例（原 8000 已退役，代码与数据均已并入本仓库）。
# 启动三件套：uvicorn API + celery worker + celery beat
#
# 命名（2026-10-09 统一）：代码 ~/ecommerce-workspace、数据 ~/ecommerce-workspace-data/production、
# LaunchAgent com.gino.ecommerce-workspace*。此前的 -sandbox 命名已弃用。
#
# 关键约束（2026-10-09 事故后固化）：
#   本仓库的 venv 曾从另一个已删除的目录复制而来，venv/bin/* 所有脚本
#   （uvicorn / celery / pip ...）的 shebang 可能指向旧绝对路径。
#   因此**一律用绝对路径解释器 + 模块方式调用**：
#     "$PY" -m uvicorn ...     ← 不要用 venv/bin/uvicorn
#     "$PY" -m celery ...      ← 不要用 venv/bin/celery
#   否则进程会去加载已删除目录下的 .so，进程能起、API 能读，
#   但任何真读磁盘的操作（如 FileResponse 发前端文件）全部失败，
#   表现为首页 200 但响应体 0 字节 + "Response content shorter than Content-Length"。
#
# 配置来源：backend/.env（DATABASE_URL / REDIS_URL / PERSIST_ROOT 等）。
# 不在此脚本内 export 覆盖 —— 配置必须落在 .env 里，绕过脚本手启才不会连错库。

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

# 先加载根 .env（POSTGRES_* 等），再加载 backend/.env（DATABASE_URL 等），后者优先。
if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi
if [ -f "$BACKEND_DIR/.env" ]; then
  set -a; source "$BACKEND_DIR/.env"; set +a
fi

# PERSIST_ROOT 决定日志/备份落盘位置；缺省回退到仓库内 logs/
PERSIST_ROOT="${PERSIST_ROOT:-$ROOT}"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
DATA_DIR="${DATA_DIR:-$PERSIST_ROOT/data}"
mkdir -p "$LOG_DIR" "$DATA_DIR"

VENV="$BACKEND_DIR/.venv"
PY="$VENV/bin/python"

# ---------- 前置自检：解释器必须解析到本仓库内 ----------
if [ ! -x "$PY" ]; then
  echo "[start] FATAL: venv 解释器不存在: $PY" >&2
  exit 1
fi
RESOLVED="$("$PY" -c 'import sys; print(sys.executable)' 2>/dev/null || echo "解析失败")"
case "$RESOLVED" in
  "$ROOT"/*) : ;;
  *)
    echo "[start] FATAL: 解释器解析到仓库外: $RESOLVED" >&2
    echo "[start] 期望前缀: $ROOT/" >&2
    exit 1
    ;;
esac

# ---------- 回收遗留进程 ----------
# launchctl kickstart -k 可能只回收托管脚本，留下已 reparent 到 launchd 的旧进程。
# 旧 worker/beat 若残留，会与新实例共用同一 Redis 队列，导致定时任务重复消费。
reap_stale() {
  local pattern="$1" pid cmd cwd
  while read -r pid cmd; do
    [ -n "$pid" ] || continue
    [ "$pid" != "$$" ] || continue
    case "$cmd" in *"$pattern"*) ;; *) continue ;; esac
    cwd=$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    if [ "$cwd" = "$BACKEND_DIR" ]; then
      echo "[start] 回收遗留进程 pid=$pid ($pattern)"
      kill -TERM "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
      kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
    fi
  done < <(ps -axo pid=,command=)
}
reap_stale "uvicorn app.main:app"
reap_stale "celery -A app.celery_app worker"
reap_stale "celery -A app.celery_app beat"

cd "$BACKEND_DIR"

api_pid=""; worker_pid=""; beat_pid=""
cleanup() {
  trap - TERM INT EXIT
  for pid in "$api_pid" "$worker_pid" "$beat_pid"; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup TERM INT EXIT

# ---------- 种子数据（幂等：已存在的角色/管理员不覆盖）----------
"$PY" -m app.seed >> "$LOG_DIR/seed.log" 2>&1 || \
  echo "[start] WARN: app.seed 失败，详见 $LOG_DIR/seed.log" >&2

# ---------- 1/3 API ----------
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8001 >> "$LOG_DIR/api.log" 2>&1 &
api_pid=$!

# ---------- 2/3 Celery worker ----------
# 必须用 --pool=solo：Celery 5.6.3 的 fast_trace_task 优化依赖模块级 _localized 列表，
# 该列表由 worker 主进程的 _localize() 填充。Python 3.14 在 macOS 上默认 spawn，
# 子进程重新导入模块后 _localized 为空，导致
#   ValueError: not enough values to unpack (expected 3, got 0)
# 所有任务一执行就抛错。solo 为单进程顺序执行，不产生子进程，天然规避。
# 本项目定时任务均为低频（月结/清理/1 小时级同步），单进程吞吐足够。
"$PY" -m celery -A app.celery_app worker -l info --pool=solo >> "$LOG_DIR/worker.log" 2>&1 &
worker_pid=$!

# ---------- 3/3 Celery beat ----------
# schedule 文件放持久目录，避免 /tmp 被系统清理后 beat 丢失上次执行时间戳。
"$PY" -m celery -A app.celery_app beat -l info --schedule "$DATA_DIR/celerybeat-schedule" >> "$LOG_DIR/beat.log" 2>&1 &
beat_pid=$!

echo "[start] api=$api_pid worker=$worker_pid beat=$beat_pid port=8001"
echo "[start] db=${DATABASE_URL##*/} redis=${REDIS_URL##*/} mode=${JACKYUN_SYNC_MODE:-unset}"
echo "[start] python=$RESOLVED"

wait
