#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${1:-$ROOT/deploy/cloudrun/runtime.env}"
MAP_FILE="$ROOT/deploy/cloudrun/secret-map.env"

command -v gcloud >/dev/null 2>&1 || { echo "缺少 gcloud CLI" >&2; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo "缺少 $ENV_FILE" >&2; exit 2; }
[[ -f "$MAP_FILE" ]] || { echo "缺少 $MAP_FILE" >&2; exit 2; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${GCP_PROJECT:?runtime.env 必须设置 GCP_PROJECT}"
: "${GCP_REGION:?runtime.env 必须设置 GCP_REGION}"
: "${CLOUD_RUN_SERVICE:?runtime.env 必须设置 CLOUD_RUN_SERVICE}"
: "${IMAGE_REF:?runtime.env 必须设置 IMAGE_REF}"

# Issue #30：Cloud Run 会通过 Artifact Registry 远端缓存解析 GHCR 镜像，
# 该缓存对「tag -> digest」映射有缓存语义：把 :stable/:latest 重新推送后，
# 再次部署仍可能解析到旧 digest，静默上线旧代码（exit 0、Ready，但代码是旧的）。
# 因此默认只允许 digest 固定（@sha256:...）或 Promote 输出的不可变版本标签。
case "$IMAGE_REF" in
  *@sha256:[0-9a-f]*) : ;;
  *:v[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]) : ;;
  *)
    if [[ "${ALLOW_MUTABLE_IMAGE_REF:-0}" != "1" ]]; then
      echo "拒绝使用可变镜像标签部署: $IMAGE_REF" >&2
      echo "原因：Cloud Run 远端缓存可能把该标签解析到旧 digest，导致部署旧代码（见 Issue #30）。" >&2
      echo "请改用 GHCR digest：IMAGE_REF=ghcr.io/<owner>/<repo>@sha256:<digest>" >&2
      echo "或使用 Promote workflow 输出的不可变版本标签：vYYYY.MM.DD.HHmmss。" >&2
      echo "紧急情况可设置 ALLOW_MUTABLE_IMAGE_REF=1 强制跳过本检查（自行承担旧代码上线风险）。" >&2
      exit 2
    fi
    ;;
esac

RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-coffeebear-runtime@${GCP_PROJECT}.iam.gserviceaccount.com}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-0}"

SECRET_BINDINGS=()
while IFS='=' read -r env_name secret_name; do
  [[ -z "${env_name:-}" || "$env_name" == \#* ]] && continue
  env_name="${env_name//[[:space:]]/}"
  secret_name="${secret_name//[[:space:]]/}"
  [[ -z "$env_name" || -z "$secret_name" ]] && continue
  if gcloud secrets describe "$secret_name" --project "$GCP_PROJECT" >/dev/null 2>&1; then
    SECRET_BINDINGS+=("${env_name}=${secret_name}:latest")
  fi
done < "$MAP_FILE"

AUTH_FLAG="--no-allow-unauthenticated"
[[ "$ALLOW_UNAUTHENTICATED" == "1" ]] && AUTH_FLAG="--allow-unauthenticated"

ENV_BINDINGS=(
  "APP_ENV=production"
  "RELEASE_CHANNEL=stable"
  "DEPLOYMENT_MODE=container"
  "TZ=${TZ:-Asia/Shanghai}"
  "ACCESS_MODE=${ACCESS_MODE:-rbac}"
)

# 可选的普通（非 Secret）运行参数。只有 runtime.env 中存在时才注入。
for name in \
  SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_FROM \
  R2_BACKUP_ENABLED R2_BACKUP_ENDPOINT R2_BACKUP_BUCKET R2_BACKUP_PREFIX R2_FULL_INTERVAL_DAYS \
  KODO_COLD_ENABLED KODO_COLD_BUCKET KODO_COLD_UPLOAD_URL KODO_COLD_PREFIX \
  JACKYUN_MCP_URL JACKYUN_SYNC_MODE \
  ALIBABA_1688_REDIRECT_URI \
  JKY_ADAPTER JKY_WEB_BASE_URL \
  JKY_RPA_AGENT_URL
  do
  value="${!name:-}"
  [[ -n "$value" ]] && ENV_BINDINGS+=("${name}=${value}")
done

ENV_CSV="$(IFS=,; echo "${ENV_BINDINGS[*]}")"

ARGS=(
  run deploy "$CLOUD_RUN_SERVICE"
  --project "$GCP_PROJECT"
  --region "$GCP_REGION"
  --platform managed
  --image "$IMAGE_REF"
  --port 8000
  --service-account "$RUNTIME_SERVICE_ACCOUNT"
  "$AUTH_FLAG"
  --set-env-vars "$ENV_CSV"
)

if (( ${#SECRET_BINDINGS[@]} > 0 )); then
  SECRET_CSV="$(IFS=,; echo "${SECRET_BINDINGS[*]}")"
  ARGS+=(--set-secrets "$SECRET_CSV")
fi

printf '==> 部署 CoffeeBear 到 Cloud Run\n'
printf '    project: %s\n' "$GCP_PROJECT"
printf '    region:  %s\n' "$GCP_REGION"
printf '    service: %s\n' "$CLOUD_RUN_SERVICE"
printf '    image:   %s\n' "$IMAGE_REF"
printf '    secrets: %s 个映射\n' "${#SECRET_BINDINGS[@]}"

gcloud "${ARGS[@]}"

# 部署后回读 revision 实际运行的 digest 作为证据；digest 部署时与期望值强校验。
DEPLOYED_DIGEST="$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
  --project "$GCP_PROJECT" --region "$GCP_REGION" \
  --format='value(status.imageDigest)' 2>/dev/null || true)"
if [[ -n "$DEPLOYED_DIGEST" ]]; then
  printf '    running digest: %s\n' "$DEPLOYED_DIGEST"
  if [[ "$IMAGE_REF" == *@sha256:* && "$DEPLOYED_DIGEST" != "${IMAGE_REF##*@}" ]]; then
    echo "!! 部署 digest 与期望不一致，判为失败（Issue #30 防旧代码静默上线）" >&2
    echo "   expected: ${IMAGE_REF##*@}" >&2
    echo "   actual:   $DEPLOYED_DIGEST" >&2
    exit 1
  fi
fi

echo "==> 部署完成。Secret 值由 Secret Manager 注入，GitHub 与部署脚本不保存真实值。"
