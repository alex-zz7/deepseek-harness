#!/usr/bin/env bash
# Knowledge-vault retrieval maintenance.
#
#   ./kb.sh status      index statistics and staleness
#   ./kb.sh search "…"  hybrid search from the terminal
#   ./kb.sh eval        retrieval quality check (20 cases + MRR)
#   ./kb.sh rebuild     incremental re-index after vault content changes
#   ./kb.sh reindex     full re-index after changing chunking or the model
#   ./kb.sh smoke       MCP protocol smoke test
#
# Everything runs locally; the embedding model is cached in .model-cache/.

set -euo pipefail
cd "$(dirname "$0")"

case "${1:-}" in
  status)  exec node kb.mjs --status ;;
  search)  shift; exec node kb.mjs "$@" ;;
  eval)    shift; exec node eval.mjs "$@" ;;
  rebuild) exec node build-index.mjs ;;
  reindex) exec node build-index.mjs --force ;;
  smoke)   exec node smoke.mjs ;;
  "")
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "unknown command: $1" >&2
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 1
    ;;
esac
