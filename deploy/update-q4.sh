#!/bin/sh
set -eu

# CoffeeBear 极空间 Q4 Production 镜像更新。
# 只部署已发布的不可变镜像；不在 NAS 上拉取源码或重新构建应用。
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEPLOY_DIR=${COFFEEBEAR_DEPLOY_DIR:-"$ROOT_DIR/deploy/zspace"}
case "$DEPLOY_DIR" in
  /*) ;;
  *) DEPLOY_DIR="$ROOT_DIR/$DEPLOY_DIR" ;;
esac
COMPOSE_FILE=${COFFEEBEAR_COMPOSE_FILE:-"$DEPLOY_DIR/docker-compose.yml"}
ENV_FILE=${COFFEEBEAR_ENV_FILE:-"$DEPLOY_DIR/.env"}

usage() {
  echo "用法：$0 ghcr.io/jinfenghua1990/coffeebear:vYYYY.MM.DD.HHmmss [更新器镜像]" >&2
  echo "或：$0 ghcr.io/jinfenghua1990/coffeebear@sha256:<64位镜像摘要> [更新器镜像摘要]" >&2
  echo "更新器镜像可用 ghcr.io/jinfenghua1990/coffeebear:updater-vYYYY.MM.DD.HHmmss 或不可变摘要。" >&2
  echo "可通过 COFFEEBEAR_DEPLOY_DIR 指定 NAS 上实际的 Compose 项目目录。" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 2
fi
TARGET_IMAGE=$1
TARGET_UPDATER_IMAGE=${2:-}
case "$TARGET_IMAGE" in
  ghcr.io/jinfenghua1990/coffeebear:v*)
    printf '%s\n' "$TARGET_IMAGE" | grep -Eq '^ghcr\.io/jinfenghua1990/coffeebear:v[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{6}$' || {
      echo "拒绝不符合发布版本格式的镜像标签。" >&2
      usage
      exit 2
    }
    ;;
  ghcr.io/jinfenghua1990/coffeebear@sha256:*)
    printf '%s\n' "$TARGET_IMAGE" | grep -Eq '^ghcr\.io/jinfenghua1990/coffeebear@sha256:[0-9a-f]{64}$' || {
      echo "镜像摘要必须是完整的 sha256:64位十六进制值。" >&2
      usage
      exit 2
    }
    ;;
  *)
    echo "Production 更新只接受已发布的版本标签或不可变镜像摘要，不接受 stable/candidate/latest。" >&2
    usage
    exit 2
    ;;
esac

if [ -n "$TARGET_UPDATER_IMAGE" ]; then
  case "$TARGET_UPDATER_IMAGE" in
    ghcr.io/jinfenghua1990/coffeebear:updater-v*)
      printf '%s\n' "$TARGET_UPDATER_IMAGE" | grep -Eq '^ghcr\.io/jinfenghua1990/coffeebear:updater-v[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{6}$' || {
        echo "更新器版本标签无效。" >&2
        usage
        exit 2
      }
      ;;
    ghcr.io/jinfenghua1990/coffeebear@sha256:*)
      printf '%s\n' "$TARGET_UPDATER_IMAGE" | grep -Eq '^ghcr\.io/jinfenghua1990/coffeebear@sha256:[0-9a-f]{64}$' || {
        echo "更新器摘要无效。" >&2
        usage
        exit 2
      }
      ;;
    *)
      echo "拒绝不受控的更新器镜像地址。" >&2
      usage
      exit 2
      ;;
  esac
fi

[ -f "$COMPOSE_FILE" ] || { echo "找不到 Compose 文件：$COMPOSE_FILE" >&2; exit 2; }
[ -f "$ENV_FILE" ] || { echo "找不到环境文件：$ENV_FILE；请先把 production.env.example 复制为 .env 并填好正式配置。" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "未找到 docker 命令。" >&2; exit 2; }
command -v tar >/dev/null 2>&1 || { echo "未找到 tar 命令，无法备份 DATA_DIR。" >&2; exit 2; }

read_env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1 | sed 's/^"//; s/"$//'
}
OLD_IMAGE=$(read_env_value APP_IMAGE)
OLD_UPDATE_AGENT_IMAGE=$(read_env_value UPDATE_AGENT_IMAGE)
DATA_DIR_HOST=$(read_env_value DATA_DIR_HOST)
[ -n "$OLD_IMAGE" ] || { echo ".env 中缺少 APP_IMAGE。" >&2; exit 2; }
[ -n "$DATA_DIR_HOST" ] || { echo ".env 中缺少 DATA_DIR_HOST。" >&2; exit 2; }
case "$DATA_DIR_HOST" in
  /*) ;;
  *) echo "DATA_DIR_HOST 必须是 NAS 上的绝对路径：$DATA_DIR_HOST" >&2; exit 2 ;;
esac
DATA_DIR_FOR_BACKUP=${COFFEEBEAR_DATA_DIR_CONTAINER:-$DATA_DIR_HOST}
[ -d "$DATA_DIR_FOR_BACKUP" ] || { echo "业务数据目录不可访问：$DATA_DIR_FOR_BACKUP；为避免备份空目录，已停止更新。" >&2; exit 2; }
WEB_PORT=${WEB_PORT:-8000}
BACKUP_DIR=${COFFEEBEAR_BACKUP_DIR:-"$(dirname "$DATA_DIR_HOST")/backups"}
case "$BACKUP_DIR/" in
  "$DATA_DIR_HOST/"*) echo "备份目录不能放在 DATA_DIR_HOST 内部。" >&2; exit 2 ;;
esac

# Compose 必须以 .env 文件中的 APP_IMAGE 为准，避免宿主机环境变量覆盖目标版本。
unset APP_IMAGE
dc() {
  docker compose --project-directory "$DEPLOY_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
set_image() {
  image=$1
  tmp="$ENV_FILE.tmp.$$"
  if ! awk -v image="$image" '
    BEGIN { count = 0 }
    /^APP_IMAGE=/ { count++; print "APP_IMAGE=" image; next }
    { print }
    END { if (count != 1) exit 42 }
  ' "$ENV_FILE" > "$tmp"; then
    rm -f "$tmp"
    echo "无法安全更新 .env：APP_IMAGE 必须恰好出现一次。" >&2
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

set_updater_image() {
  image=$1
  tmp="$ENV_FILE.tmp.$"
  if ! awk -v image="$image" '
    BEGIN { count = 0 }
    /^UPDATE_AGENT_IMAGE=/ { count++; print "UPDATE_AGENT_IMAGE=" image; next }
    { print }
    END { if (count > 1) exit 42; if (count == 0) print "UPDATE_AGENT_IMAGE=" image }
  ' "$ENV_FILE" > "$tmp"; then
    rm -f "$tmp"
    echo "无法安全更新 .env：UPDATE_AGENT_IMAGE 出现重复配置。" >&2
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# 镜像层下载偶发 unexpected EOF / 网络中断时，自动重试完整 pull。
# docker 会复用已完整下载的层；失败耗尽前不会停止现有容器或执行数据库迁移。
pull_with_retry() {
  max_attempts=4
  attempt=1
  base_delay=${COFFEEBEAR_PULL_RETRY_BASE_SECONDS:-10}
  case "$base_delay" in
    ''|*[!0-9]*) base_delay=10 ;;
  esac

  while [ "$attempt" -le "$max_attempts" ]; do
    echo "镜像拉取尝试 ${attempt}/${max_attempts}..."
    if dc "$@"; then
      echo "镜像拉取成功。"
      return 0
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      delay=$((attempt * base_delay))
      echo "镜像拉取失败；${delay} 秒后自动重试。当前容器不会切换，数据库迁移尚未执行。"
      if [ "$delay" -gt 0 ]; then
        sleep "$delay"
      fi
    fi
    attempt=$((attempt + 1))
  done

  echo "镜像拉取连续失败 ${max_attempts} 次；已停止更新，未执行数据库迁移。" >&2
  return 1
}
restore_config() {
  set_image "$OLD_IMAGE" || true
  if [ -n "$TARGET_UPDATER_IMAGE" ]; then
    set_updater_image "$OLD_UPDATE_AGENT_IMAGE" || true
  fi
}

if [ "$OLD_IMAGE" = "$TARGET_IMAGE" ] && { [ -z "$TARGET_UPDATER_IMAGE" ] || [ "$OLD_UPDATE_AGENT_IMAGE" = "$TARGET_UPDATER_IMAGE" ]; }; then
  echo "当前应用与更新器均已是目标版本，无需更新。"
  exit 0
fi

dc config -q
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
DB_BACKUP="$BACKUP_DIR/postgres-$STAMP.dump"
DATA_BACKUP="$BACKUP_DIR/data-$STAMP.tar.gz"

echo "[1/7] 备份正式 PostgreSQL..."
if ! dc exec -T postgres sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges' > "$DB_BACKUP"; then
  rm -f "$DB_BACKUP"
  echo "数据库备份失败，未更改运行镜像。" >&2
  exit 1
fi
[ -s "$DB_BACKUP" ] || { echo "数据库备份文件为空，已停止更新。" >&2; exit 1; }

echo "[2/7] 备份应用 DATA_DIR..."
if ! tar -C "$DATA_DIR_FOR_BACKUP" -czf "$DATA_BACKUP" .; then
  rm -f "$DATA_BACKUP"
  echo "DATA_DIR 备份失败，未更改运行镜像。" >&2
  exit 1
fi
[ -s "$DATA_BACKUP" ] || { echo "DATA_DIR 备份文件为空，已停止更新。" >&2; exit 1; }

echo "[3/7] 固定目标镜像并拉取..."
if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  if ! printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin >/dev/null; then
    echo "GHCR 登录失败，未更改运行镜像。" >&2
    exit 1
  fi
fi
if ! set_image "$TARGET_IMAGE"; then exit 1; fi
if [ -n "$TARGET_UPDATER_IMAGE" ] && ! set_updater_image "$TARGET_UPDATER_IMAGE"; then restore_config; exit 1; fi
if [ -n "$TARGET_UPDATER_IMAGE" ]; then
  if ! pull_with_retry --profile ops --profile updater pull api worker beat migrate updater update-job; then
    restore_config
    echo "镜像拉取失败，已恢复原镜像配置；现有容器未切换。" >&2
    exit 1
  fi
elif ! pull_with_retry --profile ops pull api worker beat migrate; then
  restore_config
  echo "镜像拉取失败，已恢复原 APP_IMAGE；现有容器未切换。" >&2
  exit 1
fi

echo "[4/7] 停止应用服务并执行数据库迁移..."
if ! dc stop api worker beat; then
  restore_config
  dc up -d --no-deps api worker beat || true
  echo "停止应用服务失败，未执行迁移；已恢复原配置并尝试恢复服务。" >&2
  exit 1
fi
if ! dc --profile ops run --rm migrate; then
  restore_config
  echo "数据库迁移失败：已恢复原 APP_IMAGE，但 API/worker/beat 保持停止。请检查迁移日志、数据库版本与备份后再决定恢复或重试。" >&2
  exit 1
fi

echo "[5/7] 更新 API 并等待健康检查..."
if ! dc up -d --no-deps api; then
  dc stop api || true
  dc logs --tail=80 api || true
  echo "新 API 未能启动。数据库迁移已经执行，应用服务保持停止；请查看日志，勿在未评估迁移兼容性前直接回滚数据库。" >&2
  exit 1
fi
healthy=0
attempt=1
while [ "$attempt" -le 30 ]; do
  if dc exec -T api curl -fsS http://127.0.0.1:8000/healthz >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 5
  attempt=$((attempt + 1))
done
if [ "$healthy" -ne 1 ]; then
  dc stop api || true
  echo "API 健康检查未通过。应用服务保持停止，当前 APP_IMAGE 保留为目标版本；请先检查 API 日志与迁移兼容性，再决定回滚。" >&2
  dc logs --tail=80 api || true
  exit 1
fi

echo "[6/7] 恢复 worker/beat 并核对服务..."
if ! dc up -d --no-deps worker beat; then
  echo "API 健康检查通过，但 worker/beat 恢复失败；请检查容器状态。" >&2
  exit 1
fi
if [ -n "$TARGET_UPDATER_IMAGE" ] && [ "$TARGET_UPDATER_IMAGE" != "$OLD_UPDATE_AGENT_IMAGE" ]; then
  echo "[7/7] 更新隔离更新器..."
  if ! dc up -d --no-deps updater; then
    echo "应用服务已恢复，但更新器容器未能升级；请检查 updater 日志。" >&2
    exit 1
  fi
fi
dc ps
echo "CoffeeBear Production 镜像更新成功：$TARGET_IMAGE"
echo "数据库备份：$DB_BACKUP"
echo "应用文件备份：$DATA_BACKUP"
