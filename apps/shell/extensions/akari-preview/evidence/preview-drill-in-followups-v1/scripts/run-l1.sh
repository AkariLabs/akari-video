#!/bin/bash
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd -P)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd -P)
PORT=${AKARI_CDP_PORT:-9747}
# Resolve /tmp -> /private/tmp for the workspace URI containment check.
WORKSPACE=$(cd "$(mktemp -d /tmp/akari-drill-in-followups-l1-workspace.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/akari-drill-in-followups-l1-userdata.XXXXXX)" && pwd -P)
ELECTRON_LOG="$WORKSPACE/electron.log"
ELECTRON_BIN=${ELECTRON_BIN:-"$SHELL_DIR/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"}
ELECTRON_PID=''
RUNNER_STARTED=0
cleanup() {
  local result=$?
  if [ "$result" -ne 0 ] && [ "$RUNNER_STARTED" -eq 0 ]; then
    node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR" --startup-failed || true
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
# Fail instead of attaching to another lane's Electron. Does not kill its PID.
node --input-type=module - "$PORT" <<'NODE'
import net from 'node:net';
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AKARI_CDP_PORT');
const server = net.createServer();
server.on('error', error => { console.error(`CDP port ${port}: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => server.close());
NODE
node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!
READY=0
DEADLINE=$((SECONDS + 600))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then break; fi
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && rg -Fq "Changed application state from 'initialized_layout' to 'ready'" "$ELECTRON_LOG"; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  tail -100 "$ELECTRON_LOG" >&2
  # Emit a fresh FAIL log as well; a stale PASS must not survive startup failure.
  RUNNER_STARTED=1
  node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR" --startup-failed
  exit 1
fi
RUNNER_STARTED=1
node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
