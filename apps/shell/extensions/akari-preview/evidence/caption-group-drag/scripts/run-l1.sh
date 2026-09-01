#!/bin/bash
# caption-group-drag L1 launcher (wrapper-authored). Boots the production build in a
# throwaway workspace whose root IS the project folder (same as evidence/hit-region-pointer-events).
set -uo pipefail
REPO=${AKARI_REPO:?}
FIXTURE=${AKARI_FIXTURE:?}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
LABEL=${1:-after}
PORT=${AKARI_CDP_PORT:-9655}
OUT=${AKARI_OUT:-/tmp/caption-group-drag-out}
WORKSPACE=$(cd "$(mktemp -d /tmp/cgd-ws.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/cgd-ud.XXXXXX)" && pwd -P)
ELECTRON="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG="$WORKSPACE/electron.log"
PID=""
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$USERDATA"
}
trap cleanup EXIT INT TERM
mkdir -p "$OUT"
node "$SCRIPT_DIR/prepare-fixture.mjs" "$WORKSPACE" "$FIXTURE" || exit 1
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON" "$REPO/apps/shell" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  > "$LOG" 2>&1 &
PID=$!
READY=0
for _ in $(seq 1 300); do
  if ! kill -0 "$PID" 2>/dev/null; then echo "--- electron died ---"; tail -60 "$LOG"; exit 1; fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
     && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "--- not ready ---"; tail -60 "$LOG"; exit 1; fi
node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE/project" "$OUT" "$LABEL"
RC=$?
cp "$LOG" "$OUT/$LABEL-electron.log" 2>/dev/null || true
cp "$WORKSPACE/project/captions.json" "$OUT/$LABEL-captions-final.json" 2>/dev/null || true
echo "workspace: $WORKSPACE"
exit $RC
