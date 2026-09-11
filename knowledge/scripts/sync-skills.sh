#!/usr/bin/env bash
# 从外部 skill 知识库同步一份「可入库的文本副本」到 knowledge/skills/。
#
# 只复制能安全提交的文本资产：SKILL.md、references/**.md、*.md
# 跳过图片、模板工程、二进制、node_modules。
# 命中凭据模式的文件会被隔离到 knowledge/skills/_quarantine.txt，不进入副本。
#
# 用法: ./knowledge/scripts/sync-skills.sh [源目录]
set -euo pipefail

SRC="${1:-$HOME/Desktop/skill-knowledge-base}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DST="$ROOT/knowledge/skills"
QUAR="$DST/_quarantine.txt"

[ -d "$SRC" ] || { echo "源目录不存在: $SRC" >&2; exit 1; }

echo "源: $SRC"
echo "目标: $DST"

rm -rf "$DST/vault"
mkdir -p "$DST/vault"

# 凭据/敏感信息模式：命中即打码（保留文件，避免误删有用文档）
SECRET_RE='(api[_-]?key|secret|password|passwd|cookie|token|bearer)[[:space:]]*["'"'"':=]{1,4}[[:space:]]*[A-Za-z0-9_/+-]{16,}'
GENERIC_RE='(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'

copied=0
masked=0
: > "$QUAR"

while IFS= read -r -d '' f; do
  rel="${f#$SRC/}"
  mkdir -p "$DST/vault/$(dirname "$rel")"
  if grep -qEi "$SECRET_RE" "$f" 2>/dev/null || grep -qE "$GENERIC_RE" "$f" 2>/dev/null; then
    # 逐行处理：命中行里把长串值替换成占位符，保留键名和上下文
    perl -pe '
      s/((?:api[_-]?key|secret|password|passwd|cookie|token|bearer)[^A-Za-z0-9\n]{0,6})([A-Za-z0-9_\/+\-]{16,})/$1***MASKED***/gi;
      s/(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})/***MASKED***/g;
    ' "$f" > "$DST/vault/$rel"
    echo "$rel" >> "$QUAR"
    masked=$((masked + 1))
  else
    cp "$f" "$DST/vault/$rel"
  fi
  copied=$((copied + 1))
done < <(find "$SRC" -type f -name '*.md' \
           -not -path '*/node_modules/*' \
           -not -path '*/.git/*' \
           -not -path '*/.obsidian/*' \
           -not -name 'TREE.txt' \
           -not -name 'TREE-skills.txt' \
           -print0)

echo "已复制 $copied 个 md，其中 $masked 个做过凭据打码（见 _quarantine.txt 清单）"

python3 "$ROOT/knowledge/scripts/gen-skill-index.py" "$DST/vault" "$DST" "$QUAR"

echo "完成。"
echo "  副本: $DST/vault"
echo "  索引: $DST/INDEX.md"
echo "  隔离清单: $QUAR"
