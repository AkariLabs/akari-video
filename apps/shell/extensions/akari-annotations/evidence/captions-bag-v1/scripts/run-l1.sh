#!/bin/bash
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
SOURCE_PROJECT=${1:-"$SHELL_DIR/../../templates/project-default"}
WORKSPACE=$(mktemp -d "/tmp/akari-captions-bag-l1-workspace.XXXXXX")
USERDATA=$(mktemp -d "/tmp/akari-captions-bag-l1-userdata.XXXXXX")
PORT=${AKARI_CDP_PORT:-9741}
MODE=${L1_MODE:-all}
ELECTRON_BIN="$SHELL_DIR/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_LOG="$WORKSPACE/electron.log"
ELECTRON_PID=""

case "$MODE" in
  cdp|capture|all) ;;
  *) echo "L1_MODE must be cdp, capture, or all" >&2; exit 2 ;;
esac

cleanup() {
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$USERDATA"
}
trap cleanup EXIT INT TERM

node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE" "$SOURCE_PROJECT"

if [ "$MODE" = "cdp" ] || [ "$MODE" = "all" ]; then
  THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
    --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox > "$ELECTRON_LOG" 2>&1 &
  ELECTRON_PID=$!

  READY=0
  for _ in $(seq 1 180); do
    if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
      tail -100 "$ELECTRON_LOG"
      cp "$ELECTRON_LOG" "$EVIDENCE_DIR/electron-failure.log" 2>/dev/null || true
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
fi

node "$SCRIPTS_DIR/run-l1.mjs" \
  --mode "$MODE" --port "$PORT" --workspace "$WORKSPACE" --evidence "$EVIDENCE_DIR"
