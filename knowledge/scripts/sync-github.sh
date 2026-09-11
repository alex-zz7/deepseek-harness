#!/usr/bin/env bash
# 重新生成 knowledge/github/ 下的仓库索引。
# 用法: ./knowledge/scripts/sync-github.sh [github用户名]
set -euo pipefail

OWNER="${1:-alex-zz7}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/knowledge/github"

command -v gh >/dev/null || { echo "需要 gh CLI: brew install gh" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh 未登录: gh auth login" >&2; exit 1; }

echo "拉取 $OWNER 的仓库列表..."
TMP="$(mktemp)"
gh repo list "$OWNER" --limit 400 \
  --json name,description,visibility,primaryLanguage,pushedAt,createdAt,isArchived,isFork,stargazerCount,diskUsage,url,repositoryTopics \
  > "$TMP"

mkdir -p "$OUT"
python3 "$ROOT/knowledge/scripts/gen-github-index.py" "$TMP" "$OWNER" "$OUT"
rm -f "$TMP"

COUNT=$(ls "$OUT" | grep -c '\.md$' || true)
echo "完成: $OUT ($COUNT 个文件)"
