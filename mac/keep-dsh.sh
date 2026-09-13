#!/bin/bash
# Keep one `dsh web` process alive for the app and any browser tab.
#
# The macOS app and this script share ~/.dsh/web-url plus a mkdir lock so they
# never start a second server (that would steal session write locks).
set -euo pipefail

HOME="${HOME:-$(cd ~ && pwd)}"
CACHE="$HOME/Library/Application Support/DeepSeekHarness"
URLFILE="$HOME/.dsh/web-url"
LOCKDIR="$HOME/.dsh/web.lockdir"
LOG="$CACHE/dsh-web.log"

mkdir -p "$CACHE" "$HOME/.dsh" "$CACHE/node-compile-cache"
export NODE_COMPILE_CACHE="$CACHE/node-compile-cache"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}"

resolve_dsh() {
  if [ -n "${DSH_BIN:-}" ] && [ -x "$DSH_BIN" ]; then
    printf '%s\n' "$DSH_BIN"
    return 0
  fi
  if [ -f "$CACHE/dsh-path" ]; then
    local p
    p="$(tr -d '[:space:]' < "$CACHE/dsh-path")"
    if [ -x "$p" ]; then
      printf '%s\n' "$p"
      return 0
    fi
  fi
  local npx
  npx="$(ls -t "$HOME"/.npm/_npx/*/node_modules/.bin/dsh 2>/dev/null | head -1 || true)"
  if [ -n "$npx" ] && [ -x "$npx" ]; then
    printf '%s\n' "$npx"
    return 0
  fi
  local p
  for p in /opt/homebrew/bin/dsh /usr/local/bin/dsh "$HOME/.local/bin/dsh"; do
    if [ -x "$p" ]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  return 1
}

url_ok() {
  local url="$1"
  printf '%s' "$url" | grep -qE '^http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9._~-]+$' || return 1
  local port
  port="$(printf '%s' "$url" | sed -E 's#^http://127\.0\.0\.1:([0-9]+)/.*#\1#')"
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null
}

read_url() {
  [ -r "$URLFILE" ] || return 1
  head -1 "$URLFILE" | tr -d '[:space:]'
}

acquire_lock() {
  local i
  for i in $(seq 1 600); do
    if mkdir "$LOCKDIR" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  echo "keep-dsh: could not acquire lock" >&2
  return 1
}

release_lock() {
  rmdir "$LOCKDIR" 2>/dev/null || true
}

DSH="$(resolve_dsh)" || {
  echo "keep-dsh: dsh executable not found" >&2
  exit 1
}
printf '%s\n' "$DSH" > "$CACHE/dsh-path"

acquire_lock
trap 'release_lock' EXIT

if EXISTING="$(read_url 2>/dev/null || true)" && [ -n "$EXISTING" ] && url_ok "$EXISTING"; then
  release_lock
  trap - EXIT
  echo "dsh web: $EXISTING"
  while true; do
    CURRENT="$(read_url 2>/dev/null || true)"
    if [ -n "$CURRENT" ] && url_ok "$CURRENT"; then
      sleep 3
      continue
    fi
    exit 0
  done
fi

cd "$HOME"
: > "$LOG"
"$DSH" web --no-open --port 0 >>"$LOG" 2>&1 &
PID=$!
printf '%s\n' "$PID" > "$CACHE/server.pid"

URL=""
for _ in $(seq 1 600); do
  URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9._~-]+' "$LOG" 2>/dev/null | tail -1 || true)"
  if [ -n "$URL" ]; then
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "keep-dsh: dsh exited before printing a URL" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  sleep 0.1
done

if [ -z "$URL" ]; then
  echo "keep-dsh: timed out waiting for the startup banner" >&2
  kill "$PID" 2>/dev/null || true
  exit 1
fi

printf '%s\n' "$URL" > "$URLFILE"
echo "dsh web: $URL"
release_lock
trap - EXIT
wait "$PID"
