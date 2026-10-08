#!/bin/bash
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_DIR=${AKARI_REPO_DIR:-$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../../../.." && pwd -P)}
SHELL_DIR=${AKARI_SHELL_DIR:-"$REPO_DIR/apps/shell"}
ELECTRON_BIN=${ELECTRON_BIN:-"$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"}
MODE=${1:-after}
case "$MODE" in before|after) ;; *) echo 'usage: run-l1.sh [before|after]' >&2; exit 2 ;; esac
VARIANT=${AKARI_FTW_VARIANT:-plain}
PORT=${AKARI_CDP_PORT:-9757}
OUT_DIR=${AKARI_FTW_OUT_DIR:-/tmp/ftw-l1}
mkdir -p "$OUT_DIR"
WORKSPACE=$(cd "$(mktemp -d /tmp/ftw-l1-workspace.XXXXXX)" && pwd -P)
USERDATA=$(cd "$(mktemp -d /tmp/ftw-l1-userdata.XXXXXX)" && pwd -P)
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
  if [ -n "${AKARI_FTW_KEEP_WORKSPACE:-}" ]; then
    rm -rf "$AKARI_FTW_KEEP_WORKSPACE"; cp -R "$WORKSPACE" "$AKARI_FTW_KEEP_WORKSPACE"
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
AKARI_REPO_DIR="$REPO_DIR" node "$SCRIPTS_DIR/prepare-sample.mjs" "$WORKSPACE" "$VARIANT" > "$OUT_DIR/fixture-$MODE-$VARIANT.json"
env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR="$USERDATA" AKARI_EXPORT_ALLOW_DESKTOP=0 \
  "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding > "$OUT_DIR/electron-$MODE-$VARIANT.log" 2>&1 &
ELECTRON_PID=$!
READY=0
DEADLINE=$((SECONDS + 600))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then break; fi
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$OUT_DIR/electron-$MODE-$VARIANT.log"; then
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
AKARI_REPO_DIR="$REPO_DIR" AKARI_SHELL_DIR="$SHELL_DIR" ELECTRON_BIN="$ELECTRON_BIN" AKARI_FTW_VARIANT="$VARIANT" \
  node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT_DIR" "$MODE"
