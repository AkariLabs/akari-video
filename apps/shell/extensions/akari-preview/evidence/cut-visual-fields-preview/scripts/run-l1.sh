#!/bin/bash
set -uo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: run-l1.sh <media.mp4>" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../../../../.." && pwd -P)
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
MEDIA_PATH=$1
TEMP_BASE=${TMPDIR:?TMPDIR is required}
RUN_ROOT_RAW=$(mktemp -d "${TEMP_BASE%/}/akari-cut-visual-fields-l1.XXXXXX")
RUN_ROOT=$(CDPATH= cd -- "$RUN_ROOT_RAW" && pwd -P)
WORKSPACE="$RUN_ROOT/workspace"
USERDATA="$RUN_ROOT/userdata"
PORT=${AKARI_L1_PORT:-9481}
ACTIVE_PID=""

stop_electron() {
  if [ -n "$ACTIVE_PID" ]; then
    kill "$ACTIVE_PID" 2>/dev/null || true
  fi
  local attempt=0
  while [ -n "$ACTIVE_PID" ] && kill -0 "$ACTIVE_PID" 2>/dev/null && [ "$attempt" -lt 40 ]; do
    attempt=$((attempt + 1))
    sleep 0.25
  done
  if [ -n "$ACTIVE_PID" ] && kill -0 "$ACTIVE_PID" 2>/dev/null; then
    kill -9 "$ACTIVE_PID" 2>/dev/null || true
  fi
  ACTIVE_PID=""
}

cleanup() {
  stop_electron
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for_cdp() {
  local attempt=0
  while ! curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; do
    if [ -n "$ACTIVE_PID" ] && ! kill -0 "$ACTIVE_PID" 2>/dev/null; then
      return 1
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 480 ]; then return 1; fi
    sleep 0.25
  done
}

mkdir -p "$WORKSPACE" "$USERDATA"
node "$SCRIPT_DIR/prepare-fixture.mjs" "$WORKSPACE" "$MEDIA_PATH" || exit 1

THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  >"$RUN_ROOT/electron.log" 2>&1 &
ACTIVE_PID=$!

if ! wait_for_cdp; then
  tail -60 "$RUN_ROOT/electron.log"
  exit 1
fi

node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE/project" "$EVIDENCE_DIR"
L1_EXIT=$?
if [ "$L1_EXIT" -eq 0 ]; then echo "CUT VISUAL FIELDS L1 PASS"; fi
exit "$L1_EXIT"
