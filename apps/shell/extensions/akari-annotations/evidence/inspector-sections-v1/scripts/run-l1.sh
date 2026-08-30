#!/bin/bash
set -uo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
WORKSPACE=""
USERDATA=""
PORT=${AKARI_CDP_PORT:-9623}
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_LOG=""
ELECTRON_PID=""

if [ -z "${AKARI_FIELDTEST_DIR:-}" ]; then
  echo "AKARI_FIELDTEST_DIR is required"
  exit 2
fi

wait_for_cdp() {
  local i=0
  until curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      echo "CDP did not become ready within 90s"
      return 1
    fi
    sleep 1
  done
}

wait_for_frontend_ready() {
  local i=0
  local ready_message="Changed application state from 'initialized_layout' to 'ready'"
  until rg -Fq "$ready_message" "$ELECTRON_LOG" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 240 ]; then
      echo "Theia frontend did not become ready within 240s"
      tail -80 "$ELECTRON_LOG"
      return 1
    fi
    sleep 1
  done
}

cleanup_current() {
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  local pids
  if [ -n "$USERDATA" ]; then
    pids=$(ps aux | grep -- "--user-data-dir=$USERDATA" | grep -v grep | awk '{print $2}')
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  fi
  ELECTRON_PID=""
}

cleanup() {
  cleanup_current
  if [ -n "$WORKSPACE" ]; then rm -rf "$WORKSPACE"; fi
  if [ -n "$USERDATA" ]; then rm -rf "$USERDATA"; fi
}
trap cleanup EXIT INT TERM

run_mode() {
  local mode="$1"
  WORKSPACE=$(mktemp -d "/tmp/akari-inspector-l1-${mode}-workspace.XXXXXX")
  USERDATA=$(mktemp -d "/tmp/akari-inspector-l1-${mode}-userdata.XXXXXX")
  ELECTRON_LOG="$WORKSPACE/electron.log"

  echo "=== [setup] preparing isolated $mode project ==="
  if [ "$mode" = "legacy" ]; then
    AKARI_L1_MODE=legacy node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"
  else
    node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"
  fi

  echo "=== [launch] $mode electron ==="
  AKARI_L1_MODE="$mode" THEIA_CONFIG_DIR="$USERDATA" \
    "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
    --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
    > "$ELECTRON_LOG" 2>&1 &
  ELECTRON_PID=$!

  if ! wait_for_cdp; then
    tail -80 "$ELECTRON_LOG"
    return 1
  fi
  if ! wait_for_frontend_ready; then
    return 1
  fi

  AKARI_L1_MODE="$mode" node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
  local result=$?
  cleanup_current
  rm -rf "$WORKSPACE" "$USERDATA"
  WORKSPACE=""
  USERDATA=""
  return "$result"
}

run_mode v2
RESULT=$?
if [ "$RESULT" -eq 0 ] && [ -n "${AKARI_FIELDTEST_V1_DIR:-}" ]; then
  PORT=${AKARI_LEGACY_CDP_PORT:-$((PORT + 1))}
  run_mode legacy
  RESULT=$?
fi
echo "L1_EXIT=$RESULT"
exit "$RESULT"
