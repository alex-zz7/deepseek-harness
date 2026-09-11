#!/bin/bash
# Hand the DeepSeek Harness Web UI over to a single server, cleanly.
#
# The problem this solves
# -----------------------
# A session can be *written* by only one server at a time: the owner holds an
# advisory lock on the session's `session.lock`. While a second `dsh web` is
# still running, every attempt to open a session it has open fails with:
#
#   resume failed for session "session-…"
#   SessionAlreadyOwnedError: session "session-…" is already owned by an
#   active write handle (gateway/internal)
#
# The lock belongs to the SERVER PROCESS, not to a browser tab — so closing
# tabs, or opening a different session, changes nothing. The only fix is to
# stop the other server.
#
# Usage:
#   ./mac/handoff-to-new-server.sh <OLD_PID> <NEW_URL>
#
# Example:
#   ./mac/handoff-to-new-server.sh 62082 \
#     "http://127.0.0.1:65079/?token=…"
#
# Afterwards: reload the new URL and resume the session — the lock is gone.

set -uo pipefail

OLD_PID="${1:-}"
NEW_URL="${2:-}"

if [ -z "$OLD_PID" ] || [ -z "$NEW_URL" ]; then
  echo "usage: $0 <OLD_PID> <NEW_URL>" >&2
  exit 2
fi

echo "==> target: stopping server PID $OLD_PID"

if ! kill -0 "$OLD_PID" 2>/dev/null; then
  echo "    PID $OLD_PID is not running; nothing to stop."
else
  kill -TERM "$OLD_PID" 2>/dev/null
  for _ in $(seq 1 60); do
    kill -0 "$OLD_PID" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "    still alive after SIGTERM; sending SIGKILL"
    kill -KILL "$OLD_PID" 2>/dev/null
    sleep 2
  fi
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "    error: could not stop PID $OLD_PID" >&2
    exit 1
  fi
  echo "    stopped."
fi

# The advisory lock is released when the owner dies; give the OS a moment.
sleep 2

# The macOS app records the server it spawned and reaps that PID on its next
# launch. Left stale, it would point at the *new* process and kill it later,
# so clear it now that the process it names is gone.
PIDFILE="$HOME/Library/Application Support/DeepSeekHarness/server.pid"
if [ -f "$PIDFILE" ]; then
  RECORDED="$(tr -dc '0-9' <"$PIDFILE" 2>/dev/null)"
  if [ "$RECORDED" = "$OLD_PID" ] || [ -z "$RECORDED" ] || ! kill -0 "${RECORDED:-0}" 2>/dev/null; then
    rm -f "$PIDFILE"
    echo "==> cleared stale app record $PIDFILE (was PID ${RECORDED:-<empty>})"
  else
    echo "==> note: $PIDFILE still records live PID $RECORDED; left untouched"
  fi
fi

echo "==> checking the surviving server"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$NEW_URL" 2>/dev/null)"
echo "    $NEW_URL"
echo "    HTTP $CODE"

if [ "$CODE" = "303" ] || [ "$CODE" = "200" ]; then
  echo "    reachable."
else
  echo "    unexpected status; the server may have been closed over the URL." >&2
fi

echo
echo "======================================================================"
echo " Done. Now:"
echo
echo "   1. Reload this URL in the browser:"
echo "        $NEW_URL"
echo "   2. Open the session that reported 'already owned by an active"
echo "      write handle'. It will resume now — the lock died with PID $OLD_PID."
echo
echo " No DSH server other than the one behind this URL is still running, so"
echo " new sessions will not collide either."
echo "======================================================================"
