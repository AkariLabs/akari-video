#!/bin/bash
# ラッパー（実装レーン）が検証のために書いた起動スクリプト。製品コードではない。
# AKARI_POLISH_PHASE=before|after で出力名を分ける。
set -uo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/.." && pwd)
SHELL_DIR=${AKARI_POLISH_SHELL_DIR:-$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)}
FOCUS_SCRIPTS="$SCRIPTS_DIR/../../focus-mode-v1/scripts"
WORKSPACE=$(cd "$(mktemp -d "/tmp/akari-polish-workspace.XXXXXX")" && pwd -P)
USERDATA=$(cd "$(mktemp -d "/tmp/akari-polish-userdata.XXXXXX")" && pwd -P)
PORT=${AKARI_CDP_PORT:-9653}
ELECTRON_BIN=${AKARI_POLISH_ELECTRON:-"$SHELL_DIR/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"}
ELECTRON_LOG="$WORKSPACE/electron.log"
ELECTRON_PID=""

cleanup() {
  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  if [ "${AKARI_POLISH_KEEP:-0}" = "1" ]; then echo "kept: $WORKSPACE $USERDATA"; else rm -rf "$WORKSPACE" "$USERDATA"; fi
}
trap cleanup EXIT INT TERM

node "$FOCUS_SCRIPTS/prepare-fixture.mjs" "$WORKSPACE" || exit 1
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

READY=0
for _ in $(seq 1 1200); do
  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then tail -100 "$ELECTRON_LOG"; exit 1; fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && rg -Fq "Changed application state from 'initialized_layout' to 'ready'" "$ELECTRON_LOG" 2>/dev/null; then
    READY=1; break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then tail -100 "$ELECTRON_LOG"; exit 1; fi

node "$SCRIPTS_DIR/capture.mjs" "$PORT" "$WORKSPACE" "$EVIDENCE_DIR"
RESULT=$?
echo "CAPTURE_EXIT=$RESULT"
exit "$RESULT"
