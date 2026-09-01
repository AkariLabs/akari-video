#!/bin/bash
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
SOURCE_PROJECT=${1:-${AKARI_FIELDTEST_DIR:-}}
PORT=${AKARI_CDP_PORT:-9783}
WORKSPACE=""
USERDATA=""
ELECTRON_BIN=""
ELECTRON_LOG=""
ELECTRON_PID=""

if [ -z "$SOURCE_PROJECT" ]; then
  echo "usage: run-l1.sh <object-tree-fieldtest> (or set AKARI_FIELDTEST_DIR)" >&2
  exit 2
fi

SHELL_ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ROOT_ELECTRON_BIN="$SHELL_DIR/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ -x "$SHELL_ELECTRON_BIN" ]; then
  ELECTRON_BIN="$SHELL_ELECTRON_BIN"
elif [ -x "$ROOT_ELECTRON_BIN" ]; then
  ELECTRON_BIN="$ROOT_ELECTRON_BIN"
else
  echo "Electron binary not found at apps/shell or repository root node_modules" >&2
  exit 2
fi

WORKSPACE=$(mktemp -d "/tmp/akari-timeline-row-visuals-l1-workspace.XXXXXX")
USERDATA=$(mktemp -d "/tmp/akari-timeline-row-visuals-l1-userdata.XXXXXX")
ELECTRON_LOG="$WORKSPACE/electron.log"

cleanup() {
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$USERDATA"
}
trap cleanup EXIT INT TERM

node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE" "$SOURCE_PROJECT"
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

READY=0
for _ in $(seq 1 240); do
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
