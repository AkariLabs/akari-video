#!/bin/bash
# caption-plate-drag-clamp L1 ランナー（検証スクリプト・ラッパー作成）。
# fixture/ を runs/ 配下の使い捨てワークスペースへ複製し、本番ビルドの Electron（OSR tier 2）を
# launch-shell.sh で起動して run-l1.mjs を回す。証跡は results/ にだけ残す。
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
LAB_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
LABEL=${1:-after}
PORT=${AKARI_CDP_PORT:-9671}
RUNS="$LAB_ROOT/runs"
WORKSPACE="$RUNS/ws-$LABEL"
ISO="$RUNS/userdata-$LABEL"
LOG="$RUNS/electron-$LABEL.log"
OUT=${AKARI_OUT:-$LAB_ROOT/results}
mkdir -p "$RUNS" "$OUT"
rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE"
node "$SCRIPT_DIR/gen-fixture.mjs" || exit 1
cp -R "$LAB_ROOT/fixture/." "$WORKSPACE/" || exit 1
PID=$(/bin/zsh "$SCRIPT_DIR/launch-shell.sh" "$WORKSPACE" "$PORT" "$ISO" "$LOG" | tail -1)
cleanup() {
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
READY=0
for _ in $(seq 1 600); do
  if ! kill -0 "$PID" 2>/dev/null; then echo "--- electron died ---"; tail -60 "$LOG"; exit 1; fi
  if curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
     && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$LOG" 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "--- not ready ---"; tail -60 "$LOG"; exit 1; fi
node "$SCRIPT_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT" "$LABEL"
RC=$?
cp "$WORKSPACE/captions.json" "$OUT/$LABEL-captions-final.json" 2>/dev/null || true
exit $RC
