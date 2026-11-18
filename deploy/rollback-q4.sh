#!/bin/sh
set -eu

# CoffeeBear 极空间 Q4 应用镜像回退。
# 只把 APP_IMAGE 切回上一版镜像并重启应用，不执行数据库迁移、不回滚数据库。
# 由 update-job 容器调用，容器已挂载 docker socket 与正式部署目录。
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEPLOY_DIR=${COFFEEBEAR_DEPLOY_DIR:-"$ROOT_DIR/deploy/zspace"}
case "$DEPLOY_DIR" in
  /*) ;;
  *) DEPLOY_DIR="$ROOT_DIR/$DEPLOY_DIR" ;;
esac
COMPOSE_FILE=${COFFEEBEAR_COMPOSE_FILE:-"$DEPLOY_DIR/docker-compose.yml"}
ENV_FILE=${COFFEEBEAR_ENV_FILE:-"$DEPLOY_DIR/.env"}
ENV_OWNER=$(stat -c '%u:%g' "$ENV_FILE" 2>/dev/null || true)

usage() {
  echo "用法：$0 <上一版镜像> [应用镜像摘要]" >&2
  echo "镜像必须是 ghcr.io/jinfenghua1990/coffeebear@sha256:<64位摘要> 或已发布版本标签。" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 2
fi
TARGET_IMAGE=$1
case "$TARGET_IMAGE" in
  ghcr.io/jinfenghua1990/coffeebear:v*)
    printf '%s\n' "$TARGET_IMAGE" | grep -Eq '^ghcr\.io/jinfenghua1990/coffeebear:v[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{6}$' || {
      echo "拒绝不符合发布版本格式的镜像标签。" >&2; usage; exit 2; }
    ;;
  ghcr.io/jinfenghua1990/coffeebear@sha256:*)
    printf '%s\n' "$TARGET_IMAGE" | grep -Eq '^ghcr\.io/jinfenghua1990/coffeebear@sha256:[0-9a-f]{64}$' || {
      echo "镜像摘要必须是完整的 sha256:64位十六进制值。" >&2; usage; exit 2; }
    ;;
  *)
    echo "回退只接受不可变的已发布版本标签或镜像摘要。" >&2; usage; exit 2 ;;
esac

[ -f "$COMPOSE_FILE" ] || { echo "找不到 Compose 文件：$COMPOSE_FILE" >&2; exit 2; }
[ -f "$ENV_FILE" ] || { echo "找不到环境文件：$ENV_FILE" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "未找到 docker 命令。" >&2; exit 2; }

read_env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1 | sed 's/^"//; s/"$//'
}
OLD_IMAGE=$(read_env_value APP_IMAGE)
[ -n "$OLD_IMAGE" ] || { echo ".env 中缺少 APP_IMAGE。" >&2; exit 2; }

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
  [ -z "$ENV_OWNER" ] || chown "$ENV_OWNER" "$ENV_FILE"
}
restore_config() {
  set_image "$OLD_IMAGE" || true
}

if [ "$OLD_IMAGE" = "$TARGET_IMAGE" ]; then
  echo "当前已经是目标回退版本，无需回退。"
  exit 0
fi

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  if ! printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin >/dev/null; then
    echo "GHCR 登录失败，未更改运行镜像。" >&2
    exit 1
  fi
fi

echo "[rollback 1/5] 固定回退镜像并拉取..."
if ! set_image "$TARGET_IMAGE"; then exit 1; fi
pull_ok=0
attempt=1
while [ "$attempt" -le 4 ]; do
  echo "回退镜像拉取尝试 ${attempt}/4..."
  if dc --profile ops pull api worker beat migrate; then pull_ok=1; break; fi
  if [ "$attempt" -lt 4 ]; then sleep $((attempt * 10)); fi
  attempt=$((attempt + 1))
done
if [ "$pull_ok" -ne 1 ]; then
  restore_config
  echo "回退镜像拉取失败，已恢复原镜像配置；现有容器未切换。" >&2
  exit 1
fi

echo "[rollback 2/5] 停止应用服务..."
if ! dc stop api worker beat; then
  restore_config
  dc up -d --no-deps api worker beat || true
  echo "停止应用服务失败，已恢复原配置并尝试恢复服务。" >&2
  exit 1
fi

echo "[rollback 3/5] 启动回退版本 API（不执行数据库迁移）..."
if ! dc up -d --no-deps api; then
  restore_config
  dc up -d --no-deps api || true
  echo "回退版本 API 未能启动，已恢复原镜像配置。" >&2
  exit 1
fi

echo "[rollback 4/5] 等待健康检查..."
healthy=0
attempt=1
while [ "$attempt" -le 30 ]; do
  if dc exec -T api curl -fsS http://127.0.0.1:8000/healthz >/dev/null 2>&1; then
    healthy=1; break;
  fi
  sleep 5
  attempt=$((attempt + 1))
done
if [ "$healthy" -ne 1 ]; then
  dc stop api || true
  restore_config
  dc up -d --no-deps api worker beat || true
  echo "回退版本健康检查未通过，已恢复原镜像配置与服务。数据库未被改动。" >&2
  dc logs --tail=80 api || true
  exit 1
fi

echo "[rollback 5/5] 恢复后台任务..."
if ! dc up -d --no-deps worker beat; then
  echo "API 已回退且健康，但 worker/beat 恢复失败；请检查容器状态。" >&2
  exit 1
fi
dc ps
echo "应用镜像回退成功：$TARGET_IMAGE"
echo "注意：数据库结构与数据保持回退前状态，未执行任何迁移或数据回滚。"
