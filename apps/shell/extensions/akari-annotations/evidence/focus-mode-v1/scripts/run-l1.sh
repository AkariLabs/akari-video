#!/bin/bash
set -uo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
# macOS の /tmp → /private/tmp symlink を解決し、isInsideWorkspace の URI 前方一致を揃える。
WORKSPACE=$(cd "$(mktemp -d "/tmp/akari-focus-mode-l1-workspace.XXXXXX")" && pwd -P)
USERDATA=$(cd "$(mktemp -d "/tmp/akari-focus-mode-l1-userdata.XXXXXX")" && pwd -P)
PORT=${AKARI_CDP_PORT:-9633}
ELECTRON_BIN="$SHELL_DIR/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_LOG="$WORKSPACE/electron.log"
ELECTRON_PID=""

cleanup() {
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$USERDATA"
}
trap cleanup EXIT INT TERM

node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

READY=0
for _ in $(seq 1 180); do
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    tail -100 "$ELECTRON_LOG"
    exit 1
  fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && rg -Fq "Changed application state from 'initialized_layout' to 'ready'" "$ELECTRON_LOG" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  tail -100 "$ELECTRON_LOG"
  exit 1
fi

node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
