#!/usr/bin/env bash
# 高置信度敏感信息扫描：拦截常见真实 token / access key / 私钥。
# 仅匹配具有稳定前缀或明确私钥头的模式，避免把普通示例配置误报为秘密。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Public-repository guard: reject sensitive runtime/data files even if somebody force-adds them.
FORBIDDEN_TRACKED="$(git ls-files | grep -E '(^|/)\.env$|(^|/)runtime\.env$|\.(pem|key|p12|pfx|sqlite|sqlite3|dump)$|\.sql\.gz$|^backend/backup_.*\.jsonPATTERN='(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----)'

# 只扫描 Git 已跟踪的文本内容；.env / data / backups 本来就不应进入仓库。
MATCHES="$(git grep -nEI "$PATTERN" -- . ':!frontend/package-lock.json' 2>/dev/null || true)"

if [[ -n "$MATCHES" ]]; then
  echo "检测到疑似真实密钥/Token/私钥，禁止提交："
  # 不把命中的秘密再次写进 CI 日志，只显示文件和行号。
  printf '%s\n' "$MATCHES" | awk -F: '{print $1 ":" $2 ": [REDACTED]"}'
  echo "请立即从源码移除并改用 .env / GitHub Actions Secrets；如果是真实密钥且已经公开，应立即轮换。"
  exit 1
fi

echo "高置信度敏感信息扫描通过。"
 || true)"
if [[ -n "$FORBIDDEN_TRACKED" ]]; then
  echo "检测到不应进入 Git 的运行凭据/私钥/数据库或备份文件，禁止提交："
  printf '%s\n' "$FORBIDDEN_TRACKED"
  exit 1
fi

PATTERN='(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----)'

# 只扫描 Git 已跟踪的文本内容；.env / data / backups 本来就不应进入仓库。
MATCHES="$(git grep -nEI "$PATTERN" -- . ':!frontend/package-lock.json' 2>/dev/null || true)"

if [[ -n "$MATCHES" ]]; then
  echo "检测到疑似真实密钥/Token/私钥，禁止提交："
  # 不把命中的秘密再次写进 CI 日志，只显示文件和行号。
  printf '%s\n' "$MATCHES" | awk -F: '{print $1 ":" $2 ": [REDACTED]"}'
  echo "请立即从源码移除并改用 .env / GitHub Actions Secrets；如果是真实密钥且已经公开，应立即轮换。"
  exit 1
fi

echo "高置信度敏感信息扫描通过。"
