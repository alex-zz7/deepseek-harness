#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Need Node.js 20+. Install from https://nodejs.org/ then run this again." >&2
  exit 1
fi
exec node scripts/harness.mjs start "$@"
