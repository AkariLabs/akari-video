#!/bin/bash
# webview-theme-vars L1: スクラッチ環境で Electron（CDP 付き）を起動する。
#   使い方: launch.sh <scratch-dir> <port>
#   - <scratch-dir>/config      = THEIA_CONFIG_DIR（settings.json + deployedPlugins/ を先に用意しておく）
#   - <scratch-dir>/userdata    = --user-data-dir
#   - <scratch-dir>/ws/project  = ワークスペース
# オーナーの ~/.theia と /Applications/AKARI Video.app には触れない（複製のみ）。
set -euo pipefail

SCRATCH=${1:?scratch dir}
PORT=${2:-9762}
SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SHELL_DIR=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$SHELL_DIR/../.." && pwd)
ELECTRON_BIN="$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG="$SCRATCH/electron.log"

: > "$LOG"
THEIA_CONFIG_DIR="$SCRATCH/config" nohup "$ELECTRON_BIN" "$SHELL_DIR" "$SCRATCH/ws/project" \
  --remote-debugging-port="$PORT" --user-data-dir="$SCRATCH/userdata" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding >> "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$SCRATCH/electron.pid"

READY=0
for _ in $(seq 1 240); do
  if ! kill -0 "$PID" 2>/dev/null; then
    tail -60 "$LOG"
    echo "electron exited early" >&2
    exit 1
  fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  tail -60 "$LOG"
  echo "electron not ready" >&2
  exit 1
fi
echo "ready pid=$PID port=$PORT"
