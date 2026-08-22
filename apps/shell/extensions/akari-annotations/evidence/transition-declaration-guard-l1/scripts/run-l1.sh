#!/bin/bash
set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../../../../.." && pwd -P)
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
TEMP_BASE=${TMPDIR:?TMPDIR is required}
RUN_ROOT=$(mktemp -d "${TEMP_BASE%/}/akari-transition-guard-l1.XXXXXX")
PORT=9467
ACTIVE_USERDATA=""
ACTIVE_PID=""

matching_pids() {
  [ -n "$ACTIVE_USERDATA" ] || return 0
  ps -axo pid=,command= | awk -v needle="--user-data-dir=$ACTIVE_USERDATA" '
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
  ACTIVE_USERDATA=""
  ACTIVE_PID=""
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

OVERALL_EXIT=0
for PHASE in a b c; do
  WORKSPACE="$RUN_ROOT/workspace-$PHASE"
  USERDATA="$RUN_ROOT/userdata-$PHASE"
  mkdir -p "$WORKSPACE" "$USERDATA"
  if ! node "$SCRIPT_DIR/prepare-fixture.mjs" "$PHASE" "$WORKSPACE"; then
    OVERALL_EXIT=1
    continue
  fi

  ACTIVE_USERDATA="$USERDATA"
  THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
    --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
    >"$RUN_ROOT/electron-$PHASE.log" 2>&1 &
  ACTIVE_PID=$!

  PHASE_EXIT=1
  if wait_for_cdp; then
    node "$SCRIPT_DIR/run-l1.mjs" "$PHASE" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
    PHASE_EXIT=$?
  else
    tail -60 "$RUN_ROOT/electron-$PHASE.log"
  fi
  stop_electron

  if [ "$PHASE_EXIT" -ne 0 ]; then
    OVERALL_EXIT=1
  fi
done

exit "$OVERALL_EXIT"
