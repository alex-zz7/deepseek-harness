#!/bin/bash
# Open DeepSeek Harness in a plain browser tab.
#
# Why this script exists
# ----------------------
# `dsh web` guards its UI with a launch token: the trust fence accepts the root
# URL only when it carries `?token=…`, then trades that token for a signed cookie
# and redirects to a clean `/`. The token is `randomBytes(32)`, lives only in the
# server process's memory, and is printed exactly once at startup
# (`dsh web: http://127.0.0.1:PORT/?token=…`). It is never written to disk, so if
# you lose that line the running server becomes unreachable from a browser and
# there is nothing to recover from.
#
# This script therefore does the one thing that always works: it starts a fresh
# server itself, captures the banner, makes the URL available, and optionally
# opens it. Keep it running — the server is a child of this script.
#
# Usage:
#   ./mac/open-in-browser.sh              # reuse a running server, else start one
#   ./mac/open-in-browser.sh --new        # always start a fresh server
#   ./mac/open-in-browser.sh --no-open    # print the URL only
#   ./mac/open-in-browser.sh --port 3080  # pin the port (default: 0 = auto)
#
# Sharing servers
# ---------------
# A session can be written by only one server at a time — the owner holds a
# kernel flock(2) lease on `session.lock`, and a second server resuming that
# session reports `SessionAlreadyOwnedError` ("already owned by an active write
# handle"). A server can serve many clients, though, so the fix is to share one.
#
# The macOS app publishes the launch URL it spawns to `~/.dsh/web-url`; this
# script does the same. Either side attaches when that URL still answers, so the
# app and browser tabs end up on one server instead of two competing ones.
# The probe is a bare TCP connect — following the URL would consume the token.

set -uo pipefail

OPEN_BROWSER=1
PORT=0
FORCE_NEW=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-open) OPEN_BROWSER=0; shift ;;
    --new)     FORCE_NEW=1; shift ;;
    --port)    PORT="${2:-0}"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=/tmp/dsh-web.log
URLFILE=/tmp/dsh-web-url.txt
SHARED_URL="$HOME/.dsh/web-url"

# Resolve `dsh`: prefer a login shell (GUI apps and cron get a minimal PATH),
# then fall back to the newest npx cache entry.
DSH_BIN="$(zsh -lc 'command -v dsh' 2>/dev/null || true)"
if [ -z "$DSH_BIN" ] || [ ! -x "$DSH_BIN" ]; then
  DSH_BIN="$(ls -d "$HOME"/.npm/_npx/*/node_modules/.bin/dsh 2>/dev/null | head -1)"
fi
if [ -z "$DSH_BIN" ] || [ ! -x "$DSH_BIN" ]; then
  echo "error: could not find the 'dsh' executable." >&2
  echo "install it with:  npx @deepseek-ai/dsh --version" >&2
  exit 1
fi

cd "$WORKDIR" || exit 1

# Attach to a server that is already running, unless a fresh one was demanded.
# Sharing one server is what keeps the app and browser tabs from holding
# competing write leases on the same sessions.
if [ "$FORCE_NEW" = "0" ] && [ -r "$SHARED_URL" ]; then
  EXISTING="$(head -1 "$SHARED_URL" 2>/dev/null | tr -d '[:space:]')"
  if printf '%s' "$EXISTING" | grep -qE '^http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9._~-]+$'; then
    EXISTING_PORT="$(printf '%s' "$EXISTING" | sed -E 's#^http://127\.0\.0\.1:([0-9]+)/.*#\1#')"
    if (exec 3<>"/dev/tcp/127.0.0.1/$EXISTING_PORT") 2>/dev/null; then
      printf '%s\n' "$EXISTING" > "$URLFILE"
      echo "==> attaching to the DeepSeek Harness server already running on port $EXISTING_PORT"
      echo
      echo "======================================================================"
      echo " Open this URL (it carries the auth token):"
      echo
      echo "   $EXISTING"
      echo
      echo " also saved to: $URLFILE"
      echo "======================================================================"
      echo
      echo "This is the SAME server the macOS app uses, so both share one writer"
      echo "per session instead of contending. To force a separate server, pass"
      echo "--new (you will then have two, and must not open one session in both)."
      if [ "$OPEN_BROWSER" = "1" ]; then open "$EXISTING"; fi
      exit 0
    fi
    echo "note: the published URL on port $EXISTING_PORT does not answer; starting a fresh server." >&2
  fi
fi

# Pick the port, then refuse to fight an existing server for it. A pre-existing
# `dsh web` holds a write lock on the sessions it has open, so a second server
# cannot resume those; you would be told "already owned by an active write
# handle". If that is what you are hitting, stop the other server first — read
# its PID from the app's record or from `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
if [ "$PORT" != "0" ]; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "error: port $PORT is already in use:" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
    echo >&2
    echo "Another DSH server on that port cannot be authenticated against from" >&2
    echo "here (its token died with the process that printed it). Stop it first," >&2
    echo "or run this script without --port to take a fresh OS-assigned port." >&2
    exit 1
  fi
fi

: > "$LOG"
: > "$URLFILE"

echo "starting: $DSH_BIN web --no-open --port $PORT"
"$DSH_BIN" web --no-open --port "$PORT" >>"$LOG" 2>&1 &
SERVER_PID=$!
echo "server PID: $SERVER_PID   (this script waits on it; Ctrl-C stops both)"

# The banner is one line; 90s is generous for a cold profile boot.
URL=""
for _ in $(seq 1 900); do
  URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9._~-]+' "$LOG" 2>/dev/null | head -1)"
  [ -n "$URL" ] && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "error: the server exited before printing a URL. Last output:" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  sleep 0.1
done

if [ -z "$URL" ]; then
  echo "error: timed out waiting for the startup banner. Last output:" >&2
  tail -30 "$LOG" >&2
  kill "$SERVER_PID" 2>/dev/null
  exit 1
fi

printf '%s\n' "$URL" > "$URLFILE"
# Publish for the app and for later runs of this script, so everyone shares this
# one server instead of starting a second that would contend for session locks.
mkdir -p "$(dirname "$SHARED_URL")"
printf '%s\n' "$URL" > "$SHARED_URL"

echo
echo "======================================================================"
echo " DeepSeek Harness is up. Open this URL (it carries the auth token):"
echo
echo "   $URL"
echo
echo " also saved to: $URLFILE"
echo " server log:    $LOG"
echo "======================================================================"
echo
echo "Notes:"
echo "  * The token is single-use as a URL: it is exchanged for a cookie and"
echo "    the address bar settles on the clean '/' form. An expired cookie"
echo "    means re-open THIS script (a dead token cannot be recovered)."
echo "  * Ctrl-C here stops the server."
echo

if [ "$OPEN_BROWSER" = "1" ]; then
  open "$URL"
fi

wait "$SERVER_PID"
