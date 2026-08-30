#!/bin/bash
set -uo pipefail
REPO=${AKARI_REPO:-$(git rev-parse --show-toplevel)}
FIXTURE=${AKARI_FIXTURE:?検証用 fixture ディレクトリを指定してください}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
LABEL=${1:-before}
OPTS="${2:-{}}"
PORT=${AKARI_CDP_PORT:-9645}
OUT=/tmp/i36-out
WORKSPACE=$(cd "$(mktemp -d /tmp/i36-ws-run.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/i36-ud.XXXXXX)" && pwd -P)
ELECTRON="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG="$WORKSPACE/electron.log"
PID=""
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$USERDATA"
}
trap cleanup EXIT INT TERM
mkdir -p "$OUT"
node "$SCRIPT_DIR/prepare-fixture.mjs" "$WORKSPACE" "$REPO" "$FIXTURE" || exit 1
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON" "$REPO/apps/shell" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  > "$LOG" 2>&1 &
PID=$!
READY=0
for _ in $(seq 1 240); do
  if ! kill -0 "$PID" 2>/dev/null; then echo "--- electron died ---"; tail -60 "$LOG"; exit 1; fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
     && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "--- not ready ---"; tail -60 "$LOG"; exit 1; fi
node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT" "$LABEL" "$OPTS"
RC=$?
cp "$LOG" "$OUT/$LABEL-electron.log" 2>/dev/null || true
exit $RC
