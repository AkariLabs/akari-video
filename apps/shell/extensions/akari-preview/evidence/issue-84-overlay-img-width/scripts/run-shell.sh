#!/bin/bash
# issue #84 shell L1: usage run-shell.sh <fixtureDir> <label> <outDir>
set -uo pipefail
REPO=${AKARI_REPO:?}
FIXTURE=$1; LABEL=$2; OUT=$3
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
PORT=${AKARI_CDP_PORT:-9487}
WORKSPACE=$(cd "$(mktemp -d /tmp/issue84-overlay-img-width-ws.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/issue84-overlay-img-width-ud.XXXXXX)" && pwd -P)
AKHOME=$(cd "$(mktemp -d /tmp/issue84-overlay-img-width-home.XXXXXX)" && pwd -P)
ELECTRON="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG="$WORKSPACE/electron.log"
PID=""
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$USERDATA" "$AKHOME"
}
trap cleanup EXIT INT TERM
mkdir -p "$OUT" "$WORKSPACE/project"
cp -R "$REPO/templates/project-default/." "$WORKSPACE/project/"
cp -R "$FIXTURE/." "$WORKSPACE/project/"
rm -f "$WORKSPACE/project/README.md"
AKARI_HOME="$AKHOME" THEIA_CONFIG_DIR="$USERDATA/theia" "$ELECTRON" "$REPO/apps/shell" "$WORKSPACE/project" \
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
node "$SCRIPT_DIR/probe-shell.mjs" "$PORT" "$WORKSPACE" "$OUT" "$LABEL"
RC=$?
cp "$LOG" "$OUT/$LABEL-electron.log" 2>/dev/null || true
rm -rf "$WORKSPACE"
exit $RC
