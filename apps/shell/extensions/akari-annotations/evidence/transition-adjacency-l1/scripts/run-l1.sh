#!/bin/bash
set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../../../../.." && pwd -P)
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
TEMP_BASE=${TMPDIR:?TMPDIR is required}
RUN_ROOT=$(mktemp -d "${TEMP_BASE%/}/akari-transition-adjacency-l1.XXXXXX")
WORKSPACE="$RUN_ROOT/workspace"
USERDATA="$RUN_ROOT/userdata"
PORT=9471
ACTIVE_PID=""

matching_pids() {
  ps -axo pid=,command= | awk -v needle="--user-data-dir=$USERDATA" '
    index($0, needle) { print $1 }
  '
}

stop_electron() {
  local pid
  for pid in $(matching_pids); do
    case "$pid" in
      ''|*[!0-9]*) continue ;;
    esac
    kill "$pid" 2>/dev/null || true
  done
  if [ -n "$ACTIVE_PID" ]; then
    kill "$ACTIVE_PID" 2>/dev/null || true
  fi
  local attempt=0
  while [ -n "$(matching_pids)" ] && [ "$attempt" -lt 40 ]; do
    attempt=$((attempt + 1))
    sleep 0.25
  done
  for pid in $(matching_pids); do
    case "$pid" in
      ''|*[!0-9]*) continue ;;
    esac
    kill -9 "$pid" 2>/dev/null || true
  done
}

cleanup() {
  stop_electron
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT INT TERM

wait_for_cdp() {
  local attempt=0
  while ! curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 480 ]; then
      return 1
    fi
    sleep 0.25
  done
}

mkdir -p "$WORKSPACE" "$USERDATA"
node "$SCRIPT_DIR/prepare-fixture.mjs" "$WORKSPACE" || exit 1

THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  >"$RUN_ROOT/electron.log" 2>&1 &
ACTIVE_PID=$!

if ! wait_for_cdp; then
  tail -60 "$RUN_ROOT/electron.log"
  exit 1
fi

node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
