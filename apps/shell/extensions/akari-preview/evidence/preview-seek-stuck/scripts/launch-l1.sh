#!/bin/bash
# 実 Electron（開発ビルド）を CDP 付きで起動し、run-l1.mjs で再生・シークを実測する。
#
#   bash launch-l1.sh <projectDir> <outDir> <label> [port]
#
# 前提:
# - リポジトリルートで `npm install --ignore-scripts` 済み（native .node は健全な checkout から
#   コピーしてよい）／`apps/shell` で `npm run build` 済み
# - H.264 を確実にデコードさせるため node_modules/electron の libffmpeg は stock 版に戻しておく
#   （apps/shell の build が非プロプライエタリ版へ差し替えるため。差し替え後は resign-electron.mjs）
set -uo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../../../.." && pwd)
PROJECT="$1"; OUTDIR="$2"; LABEL="$3"; PORT="${4:-9741}"
USERDATA=$(mktemp -d "${TMPDIR:-/tmp}/akari-preview-seek-stuck-userdata.XXXXXX")
mkdir -p "$OUTDIR"
LOG="$OUTDIR/$LABEL-electron.log"
ELECTRON_BIN="$REPO_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

cleanup() {
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true; sleep 1; kill -9 "$PID" 2>/dev/null || true
  fi
  rm -rf "$USERDATA"
}
trap cleanup EXIT INT TERM

# rAF を 5Hz へ落とさないためのフラグ 3 点（webview の計測が 6 分の 1 に見える）
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$REPO_ROOT/apps/shell" "$PROJECT" \
  --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding > "$LOG" 2>&1 &
PID=$!

READY=0
for _ in $(seq 1 180); do
  if ! kill -0 "$PID" 2>/dev/null; then echo "ELECTRON DIED"; tail -60 "$LOG"; exit 1; fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then
    READY=1; break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "NOT READY"; tail -60 "$LOG"; exit 1; fi

node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$PROJECT" "$OUTDIR" "$LABEL"
RC=$?
echo "--- webview/console lines from electron.log ---"
grep -nE "webview|SyntaxError|Uncaught|frame-engine|akari-preview" "$LOG" | head -60
exit $RC
