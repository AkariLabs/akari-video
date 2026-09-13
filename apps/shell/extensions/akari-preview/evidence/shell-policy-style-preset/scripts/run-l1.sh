#!/bin/bash
# shell-policy-style-preset L1 launcher (wrapper-authored).
# AKARI_HOME / --user-data-dir are throwaway temp dirs; only the PID started here is killed.
set -uo pipefail
REPO=${AKARI_REPO:?}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
PORT=${AKARI_CDP_PORT:-9661}
OUT=${AKARI_OUT:?}
FFMPEG=${AKARI_FFMPEG:-ffmpeg}
WORKSPACE=$(cd "$(mktemp -d /tmp/spsp-ws.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/spsp-ud.XXXXXX)" && pwd -P)
AKARIHOME=$(cd "$(mktemp -d /tmp/spsp-home.XXXXXX)" && pwd -P)
ELECTRON="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG="$WORKSPACE/electron.log"
PID=""
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
mkdir -p "$OUT"
node "$SCRIPT_DIR/prepare-fixture.mjs" "$WORKSPACE" "$FFMPEG" "$REPO" || exit 1
AKARI_HOME="$AKARIHOME" THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON" "$REPO/apps/shell" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  > "$LOG" 2>&1 &
PID=$!
echo "electron pid: $PID"
READY=0
for _ in $(seq 1 300); do
  if ! kill -0 "$PID" 2>/dev/null; then echo "--- electron died ---"; tail -60 "$LOG"; exit 1; fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
     && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "--- not ready ---"; tail -60 "$LOG"; exit 1; fi
node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE/project" "$OUT"
RC=$?
echo "workspace: $WORKSPACE / userdata: $USERDATA / akari_home: $AKARIHOME"
exit $RC
