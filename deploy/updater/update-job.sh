#!/bin/bash
set -u
SCRIPT_PATH="${1:-}"
APP_IMAGE_REF="${2:-}"
UPDATE_AGENT_IMAGE_REF="${3:-}"
RELEASE_TAG="${4:-}"
TARGET_SHA="${5:-}"
ACTOR="${6:-system}"
STATUS_FILE="${DATA_DIR:-/data}/system-update/container-status.json"
HISTORY_FILE="${DATA_DIR:-/data}/system-update/history.jsonl"
if [[ -z "$SCRIPT_PATH" || -z "$APP_IMAGE_REF" || -z "$UPDATE_AGENT_IMAGE_REF" ]]; then
  echo "缺少更新脚本或目标镜像参数" >&2
  exit 2
fi
set +e
bash "$SCRIPT_PATH" "$APP_IMAGE_REF" "$UPDATE_AGENT_IMAGE_REF"
rc=$?
set -e
python3 - "$STATUS_FILE" "$HISTORY_FILE" "$rc" "$RELEASE_TAG" "$TARGET_SHA" "$ACTOR" "$APP_IMAGE_REF" <<'PY'
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path
status_path, history_path, rc, release_tag, target_sha, actor, app_ref = sys.argv[1:]
rc = int(rc)
now = datetime.now(timezone.utc).astimezone().isoformat()
status_path, history_path = Path(status_path), Path(history_path)
status_path.parent.mkdir(parents=True, exist_ok=True)
try:
    status = json.loads(status_path.read_text(encoding="utf-8"))
    if not isinstance(status, dict): status = {}
except Exception:
    status = {}
previous_sha = str(status.get("currentSha") or "")
result = "success" if rc == 0 else "failed"
message = "正式版本更新完成" if rc == 0 else f"正式版本更新失败（退出码 {rc}），请查看更新日志"
status.update({
    "phase": "success" if rc == 0 else "failed", "progress": 100, "running": False,
    "message": message, "error": "" if rc == 0 else message, "finishedAt": now,
    "lastInstallAt": now, "lastInstallResult": result, "lastInstallFromSha": previous_sha,
    "lastInstallToSha": target_sha, "lastCheckError": "",
})
if rc == 0:
    status.update({
        "currentSha": target_sha, "targetSha": target_sha, "latestSha": target_sha,
        "updateAvailable": False, "currentImageRef": app_ref,
        "currentCommit": {"sha": target_sha, "shortSha": target_sha[:10], "subject": release_tag,
                          "committedAt": now, "version": release_tag},
    })
tmp = status_path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
os.replace(tmp, status_path)
row = {"at": now, "result": result, "message": message, "actor": actor,
       "fromSha": previous_sha, "toSha": target_sha, "version": release_tag}
with history_path.open("a", encoding="utf-8") as fh:
    fh.write(json.dumps(row, ensure_ascii=False) + "\n")
PY
exit "$rc"
