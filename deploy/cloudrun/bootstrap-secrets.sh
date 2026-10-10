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
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-coffeebear-runtime@${GCP_PROJECT}.iam.gserviceaccount.com}"
SA_NAME="${RUNTIME_SERVICE_ACCOUNT%%@*}"

printf '==> Google Cloud project: %s\n' "$GCP_PROJECT"
gcloud config set project "$GCP_PROJECT" >/dev/null

echo "==> 启用 Secret Manager / Cloud Run API"
gcloud services enable secretmanager.googleapis.com run.googleapis.com --project "$GCP_PROJECT"

if ! gcloud iam service-accounts describe "$RUNTIME_SERVICE_ACCOUNT" --project "$GCP_PROJECT" >/dev/null 2>&1; then
  echo "==> 创建运行账号：$RUNTIME_SERVICE_ACCOUNT"
  gcloud iam service-accounts create "$SA_NAME" \
    --project "$GCP_PROJECT" \
    --display-name="CoffeeBear runtime"
fi

created=0
updated=0
skipped=0

while IFS='=' read -r env_name secret_name; do
  [[ -z "${env_name:-}" || "$env_name" == \#* ]] && continue
  env_name="${env_name//[[:space:]]/}"
  secret_name="${secret_name//[[:space:]]/}"
  [[ -z "$env_name" || -z "$secret_name" ]] && continue

  value="${!env_name:-}"
  if [[ -z "$value" ]]; then
    printf 'skip  %-30s (runtime.env 未设置)\n' "$env_name"
    skipped=$((skipped + 1))
    continue
  fi

  if ! gcloud secrets describe "$secret_name" --project "$GCP_PROJECT" >/dev/null 2>&1; then
    printf 'create %-30s -> %s\n' "$env_name" "$secret_name"
    gcloud secrets create "$secret_name" \
      --project "$GCP_PROJECT" \
      --replication-policy="automatic" >/dev/null
    created=$((created + 1))
  else
    printf 'update %-30s -> %s\n' "$env_name" "$secret_name"
    updated=$((updated + 1))
  fi

  # 不在 stdout 打印 Secret；只通过 stdin 创建新 version。
  printf '%s' "$value" | gcloud secrets versions add "$secret_name" \
    --project "$GCP_PROJECT" \
    --data-file=- >/dev/null

  # 每个 Secret 单独授权，避免项目级 secretAccessor 过宽。
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project "$GCP_PROJECT" \
    --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null

done < "$MAP_FILE"

cat <<EOF

完成。
  新建 Secret: $created
  新增版本:     $updated
  跳过空值:     $skipped
  运行账号:     $RUNTIME_SERVICE_ACCOUNT

注意：每次重新执行会为非空项新增一个 Secret version。新版本验证成功后，请按保留策略销毁不再需要的旧版本，以避免无意义的有效版本费用。
EOF
