#!/bin/bash
# L1: 画面いっぱいの入れ物を選ばない・枠は見えている中身にぴったり（シェル実機・tier 2）。
# usage: run-l1.sh <before|after>   （AKARI_PTSB_RUNS="F S" で起動の組を選ぶ。F = fixture 5 本 / S = 同梱のサンプル 9 本）
#   AKARI_PTSB_OUT_DIR = 記録の置き場（既定 /tmp/ptsb-l1/<mode>）  AKARI_REPO_DIR = リポの根（既定 = このスクリプトのリポ）
set -uo pipefail
SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_DIR=${AKARI_REPO_DIR:-$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../../../.." && pwd -P)}
export AKARI_REPO_DIR="$REPO_DIR"
SHELL_DIR=${AKARI_SHELL_DIR:-"$REPO_DIR/apps/shell"}
ELECTRON_BIN=${ELECTRON_BIN:-"$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"}
MODE=${1:-after}
case "$MODE" in before|after) ;; *) echo 'usage: run-l1.sh <before|after>' >&2; exit 2 ;; esac
PORT=${AKARI_CDP_PORT:-9763}
OUT_DIR=${AKARI_PTSB_OUT_DIR:-/tmp/ptsb-l1/$MODE}
mkdir -p "$OUT_DIR"
# tier 2 の裏取り: npm の electron（path.txt あり）で、libffmpeg が H.264 を持つ stock 版であること。
LIBFFMPEG="$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"
{
  echo "electron_bin=$ELECTRON_BIN"
  echo "path_txt=$(cat "$REPO_DIR/node_modules/electron/path.txt" 2>/dev/null || echo MISSING)"
  echo "libffmpeg_h264=$(strings "$LIBFFMPEG" 2>/dev/null | grep -c 'H264 Decoder')"
  echo "head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "${AKARI_PTSB_HEAD:-unknown}")"
  echo "overlay_runtime_dirty=$(git -C "$REPO_DIR" status --short packages/overlay-runtime/src 2>/dev/null | wc -l | tr -d ' ')"
} > "$OUT_DIR/environment.txt"

FAILED=0
for RUN in ${AKARI_PTSB_RUNS:-F S}; do
  WORKSPACE=$(cd "$(mktemp -d /tmp/ptsb-workspace.XXXXXX)" && pwd -P)
  USERDATA=$(cd "$(mktemp -d /tmp/ptsb-userdata.XXXXXX)" && pwd -P)
  node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE" > /dev/null || { echo "prepare failed"; exit 1; }
  if [ "$RUN" = F ]; then OPEN="$WORKSPACE/project"; else OPEN="$WORKSPACE/sample"; fi
  env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR="$USERDATA" AKARI_EXPORT_ALLOW_DESKTOP=0 \
    "$ELECTRON_BIN" "$SHELL_DIR" "$OPEN" \
    --remote-debugging-port="$PORT" --user-data-dir="$USERDATA" --no-sandbox \
    --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding > "$OUT_DIR/electron-$RUN.log" 2>&1 &
  ELECTRON_PID=$!
  READY=0
  DEADLINE=$((SECONDS + 600))
  while [ "$SECONDS" -lt "$DEADLINE" ]; do
    if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then break; fi
    if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
      && grep -Fq "Changed application state from 'initialized_layout' to 'ready'" "$OUT_DIR/electron-$RUN.log"; then
      READY=1; break
    fi
    sleep 1
  done
  if [ "$READY" -eq 1 ]; then
    node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE" "$OUT_DIR" "$MODE" "$RUN" || FAILED=1
  else
    echo "$MODE run $RUN: shell did not start"; FAILED=1
  fi
  kill "$ELECTRON_PID" 2>/dev/null; wait "$ELECTRON_PID" 2>/dev/null
  for _ in $(seq 1 30); do curl --silent --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || break; sleep 1; done
  rm -rf "$WORKSPACE" "$USERDATA"
done
exit "$FAILED"
