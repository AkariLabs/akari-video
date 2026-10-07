#!/bin/bash
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../../../.." && pwd -P)
SHELL_DIR=${AKARI_SHELL_DIR:-"$REPO_DIR/apps/shell"}
ELECTRON_BIN=${ELECTRON_BIN:-"$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"}
MODE=${1:-after}
case "$MODE" in after) ;; *) echo 'usage: run-l1.sh [after]' >&2; exit 2 ;; esac
PORT=${AKARI_CDP_PORT:-9747}
OUT_DIR=${AKARI_PEBR_OUT_DIR:-/tmp/pebr-codex}
mkdir -p "$OUT_DIR"
WORKSPACE=$(cd "$(mktemp -d /tmp/pebr-codex-workspace.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/pebr-codex-userdata.XXXXXX)" && pwd -P)
ELECTRON_PID=''
RUNNER_STARTED=0
cleanup() {
  local result=$?
  if [ "$result" -ne 0 ] && [ "$RUNNER_STARTED" -eq 0 ]; then
    node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT_DIR" "$MODE" --startup-failed || true
  fi
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$USERDATA"
  return "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node --input-type=module - "$PORT" <<'NODE'
import net from 'node:net';
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AKARI_CDP_PORT');
const server = net.createServer();
server.on('error', error => { console.error(`CDP port ${port}: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => server.close());
NODE
node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"
env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR="$USERDATA" AKARI_EXPORT_ALLOW_DESKTOP=0 \
  "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding > "$OUT_DIR/electron-after.log" 2>&1 &
ELECTRON_PID=$!
READY=0
DEADLINE=$((SECONDS + 600))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then break; fi
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && rg -Fq "Changed application state from 'initialized_layout' to 'ready'" "$OUT_DIR/electron-after.log"; then
    READY=1
    break
  fi
  sleep 1
done
RUNNER_STARTED=1
if [ "$READY" -ne 1 ]; then
  node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT_DIR" "$MODE" --startup-failed
  exit 1
fi
AKARI_SHELL_DIR="$SHELL_DIR" ELECTRON_BIN="$ELECTRON_BIN" AKARI_EXPORT_ALLOW_DESKTOP=0 \
  node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT_DIR" "$MODE"
