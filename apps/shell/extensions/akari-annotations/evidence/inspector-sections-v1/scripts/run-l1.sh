#!/bin/bash
set -uo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
WORKSPACE=$(mktemp -d /tmp/akari-inspector-l1-workspace.XXXXXX)
USERDATA=$(mktemp -d /tmp/akari-inspector-l1-userdata.XXXXXX)
PORT=${AKARI_CDP_PORT:-9623}
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_LOG="$WORKSPACE/electron.log"
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

cleanup() {
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
  fi
  local pids
  pids=$(ps aux | grep -- "--user-data-dir=$USERDATA" | grep -v grep | awk '{print $2}')
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$USERDATA"
}
trap cleanup EXIT INT TERM

echo "=== [setup] preparing isolated v2 project ==="
node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"

echo "=== [launch] electron ==="
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

if ! wait_for_cdp; then
  tail -80 "$ELECTRON_LOG"
  exit 1
fi

node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
RESULT=$?
echo "L1_EXIT=$RESULT"
exit "$RESULT"
