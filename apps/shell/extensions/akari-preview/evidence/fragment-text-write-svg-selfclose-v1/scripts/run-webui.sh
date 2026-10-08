#!/bin/bash
set -euo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_DIR=${AKARI_REPO_DIR:-$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../../../.." && pwd -P)}
MODE=${1:-after}
case "$MODE" in before|after) ;; *) echo 'usage: run-webui.sh [before|after]' >&2; exit 2 ;; esac
PORT=${AKARI_WEBUI_PORT:-48931}
OUT_DIR=${AKARI_FTW_OUT_DIR:-/tmp/ftw-l1}
mkdir -p "$OUT_DIR"
WORKSPACE=$(cd "$(mktemp -d /tmp/ftw-webui-workspace.XXXXXX)" && pwd -P)
SERVER_PID=''
cleanup() {
  local result=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE"
  return "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
FIXTURE="$OUT_DIR/fixture-webui-$MODE.json"
AKARI_REPO_DIR="$REPO_DIR" node "$SCRIPTS_DIR/prepare-sample.mjs" "$WORKSPACE" plain > "$FIXTURE"
node "$REPO_DIR/packages/preview-server/src/server.mjs" "$WORKSPACE/project" --port "$PORT" > "$OUT_DIR/server-$MODE.log" 2>&1 &
SERVER_PID=$!
READY=0
DEADLINE=$((SECONDS + 120))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/api/summary" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo 'preview server did not start' >&2; exit 1; fi
node "$SCRIPTS_DIR/run-webui.mjs" "http://127.0.0.1:$PORT" "$FIXTURE" "$OUT_DIR" "$MODE"
