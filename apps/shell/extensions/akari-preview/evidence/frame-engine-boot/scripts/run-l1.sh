#!/bin/bash
set -uo pipefail

REPO=${AKARI_REPO:?AKARI_REPO を指定してください}
FIXTURE=${AKARI_FIXTURE:?AKARI_FIXTURE を指定してください}
PORT=${AKARI_CDP_PORT:-9645}
OUT=${AKARI_OUT:?AKARI_OUT を指定してください}
ELECTRON=${AKARI_ELECTRON:-$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}
SHELL_APP=${AKARI_SHELL:-$REPO/apps/shell}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
LABEL=${1:-frame-engine}
OPTIONS=${2:-}
if [ -z "$OPTIONS" ]; then
  OPTIONS='{}'
fi
WORKSPACE=$(cd "$(mktemp -d /tmp/akari-frame-engine-boot-ws.XXXXXX)" && pwd -P)
USER_DATA=$(cd "$(mktemp -d /tmp/akari-frame-engine-boot-user-data.XXXXXX)" && pwd -P)
LOG="$OUT/$LABEL-electron.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$USER_DATA"
}
trap cleanup EXIT INT TERM

mkdir -p "$OUT"
node "$SCRIPT_DIR/prepare-fixture.mjs" "$WORKSPACE" "$REPO" "$FIXTURE" || exit 1

THEIA_CONFIG_DIR="$USER_DATA" \
AKARI_FRAME_ENGINE="${AKARI_FRAME_ENGINE:-}" \
AKARI_FRAME_ENGINE_READY_TIMEOUT_MS="${AKARI_FRAME_ENGINE_READY_TIMEOUT_MS:-}" \
"$ELECTRON" "$SHELL_APP" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USER_DATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding > "$LOG" 2>&1 &
PID=$!

READY=0
for _ in $(seq 1 240); do
  if ! kill -0 "$PID" 2>/dev/null; then
    tail -60 "$LOG"
    exit 1
  fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  tail -60 "$LOG"
  exit 1
fi

node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT" "$LABEL" "$OPTIONS"
