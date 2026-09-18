#!/bin/bash
# ecommerce-dashboard 原生启动脚本（由 LaunchAgent com.gino.ecommerce-dashboard 调用）
# 依赖：原生 Postgres16(brew) + Redis(brew) 已在跑；backend/.venv 已建；前端已 build
set -a
source /Users/gino/ecommerce-dashboard/.env
set +a

export DATABASE_URL="postgresql+psycopg://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/$POSTGRES_DB"
export REDIS_URL="redis://localhost:6379/0"
export DATA_DIR=/Users/gino/ecommerce-dashboard/data

VENV=/Users/gino/ecommerce-dashboard/backend/.venv
export PATH="/Users/gino/.workbuddy/binaries/node/versions/22.22.2-2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export API_BIND_HOST="${API_BIND_HOST:-0.0.0.0}"

# ---------- 后端：api / worker / beat ----------
source "$VENV/bin/activate"
cd /Users/gino/ecommerce-dashboard/backend

# launchd 重启脚本时会向本脚本发送 TERM；显式回收子进程，避免旧 uvicorn
# 继续占用 8000，导致新版本 API 启动失败而页面悄悄继续使用旧代码。
api_pid=""
worker_pid=""
beat_pid=""
cleanup() {
  trap - TERM INT EXIT
  for pid in "$api_pid" "$worker_pid" "$beat_pid"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup TERM INT EXIT

python -m app.seed > /tmp/ecom_seed.log 2>&1
# ``launchctl kickstart -k`` 可能只回收托管脚本，留下已经脱离父进程的旧 uvicorn。
# 只清理本项目、当前工作目录且确实监听 8000 的进程，避免新版本静默撞端口。
for listener_pid in $(/usr/sbin/lsof -t -nP -iTCP:8000 -sTCP:LISTEN 2>/dev/null); do
  listener_command=$(ps -p "$listener_pid" -o command= 2>/dev/null || true)
  listener_cwd=$(/usr/sbin/lsof -a -p "$listener_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [[ "$listener_cwd" == "/Users/gino/ecommerce-dashboard/backend" && ( "$listener_command" == *"uvicorn app.main:app --host $API_BIND_HOST --port 8000"* || "$listener_command" == *"uvicorn app.main:app --host 0.0.0.0 --port 8000"* ) ]]; then
    echo "[native-start] 回收脱离托管的旧 API 进程 $listener_pid"
    kill -TERM "$listener_pid" 2>/dev/null || true
    for wait_count in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$listener_pid" 2>/dev/null || break
      sleep 0.2
    done
  fi
done

# launchctl 强制重启时可能只杀掉本脚本，旧 Celery 会被 reparent 到 launchd，
# 之后与新 worker/beat 共用 Redis，造成定时任务和队列消费重复。启动新实例前，
# 只回收本项目工作目录下、命令行完全属于本项目的遗留进程。
cleanup_stale_celery() {
  local command_pattern="$1"
  local candidate_pid=""
  local candidate_command=""
  local candidate_cwd=""
  while read -r candidate_pid candidate_command; do
    [ -n "$candidate_pid" ] || continue
    [ "$candidate_pid" != "$$" ] || continue
    case "$candidate_command" in
      *"$command_pattern"*) ;;
      *) continue ;;
    esac
    candidate_cwd=$(/usr/sbin/lsof -a -p "$candidate_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    if [ "$candidate_cwd" = "/Users/gino/ecommerce-dashboard/backend" ]; then
      echo "[native-start] 回收本项目遗留 Celery 进程 $candidate_pid"
      kill -TERM "$candidate_pid" 2>/dev/null || true
      for wait_count in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        kill -0 "$candidate_pid" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$candidate_pid" 2>/dev/null; then
        echo "[native-start] 遗留 Celery 进程 $candidate_pid 未响应，强制结束"
        kill -KILL "$candidate_pid" 2>/dev/null || true
      fi
    fi
  done < <(ps -axo pid=,command=)
}

cleanup_stale_celery "celery -A app.celery_app worker -l info --concurrency 2"
cleanup_stale_celery "celery -A app.celery_app beat -l info"
uvicorn app.main:app --host "$API_BIND_HOST" --port 8000 >> /tmp/ecom_api.log 2>&1 &
api_pid=$!
celery -A app.celery_app worker -l info --concurrency 2 >> /tmp/ecom_worker.log 2>&1 &
worker_pid=$!
celery -A app.celery_app beat -l info --schedule /tmp/celerybeat-schedule >> /tmp/ecom_beat.log 2>&1 &
beat_pid=$!
deactivate

# ---------- 前端（静态导出，由后端 8000 同口托管，不再单独跑 next start） ----------
cd /Users/gino/ecommerce-dashboard/frontend
# 缺少导出产物时自动构建（正常重启已有 out/ 会跳过）
if [ ! -f out/index.html ]; then
  echo "[native-start] 未发现 frontend/out，执行 next export 构建..."
  npm run build >> /tmp/ecom_fe_build.log 2>&1
fi

# 保持脚本存活，使 launchd 的 KeepAlive 能正确监控
wait
