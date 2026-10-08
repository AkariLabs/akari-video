#!/bin/bash
# L1: 途中で現れる要素の当たり判定。run（A / B / C / P）ごとにシェルを起動し直す。
# usage: run-l1.sh <before|after> [runs]     例: run-l1.sh after "A B C P"
#   AKARI_PHPSA_OUT_DIR = 記録の置き場（既定 /tmp/phpsa-l1/<mode>）
set -uo pipefail

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_DIR=${AKARI_REPO_DIR:-$(CDPATH= cd -- "$SCRIPTS_DIR/../../../../../../.." && pwd -P)}
export AKARI_REPO_DIR="$REPO_DIR"
SHELL_DIR=${AKARI_SHELL_DIR:-"$REPO_DIR/apps/shell"}
ELECTRON_BIN=${ELECTRON_BIN:-"$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"}
MODE=${1:-after}
RUNS=${2:-"A B C P"}
case "$MODE" in before|after) ;; *) echo 'usage: run-l1.sh <before|after> [runs]' >&2; exit 2 ;; esac
PORT=${AKARI_CDP_PORT:-9761}
OUT_DIR=${AKARI_PHPSA_OUT_DIR:-/tmp/phpsa-l1/$MODE}
mkdir -p "$OUT_DIR"
# tier 2 の裏取り: npm の electron（path.txt あり）で、libffmpeg が H.264 を持つ stock 版であること。
LIBFFMPEG="$REPO_DIR/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"
{
  echo "electron_bin=$ELECTRON_BIN"
  echo "path_txt=$(cat "$REPO_DIR/node_modules/electron/path.txt" 2>/dev/null || echo MISSING)"
  echo "libffmpeg_h264=$(strings "$LIBFFMPEG" 2>/dev/null | grep -c 'H264 Decoder')"
  echo "head=$(git -C "$REPO_DIR" rev-parse HEAD)"
  echo "overlay_runtime_dirty=$(git -C "$REPO_DIR" status --short packages/overlay-runtime/src | wc -l | tr -d ' ')"
} > "$OUT_DIR/environment.txt"

FAILED=0
for RUN in $RUNS; do
  WORKSPACE=$(cd "$(mktemp -d /tmp/phpsa-workspace.XXXXXX)" && pwd -P)
  USERDATA=$(cd "$(mktemp -d /tmp/phpsa-userdata.XXXXXX)" && pwd -P)
  node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE" > /dev/null || { echo "prepare failed"; exit 1; }
  env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR="$USERDATA" AKARI_EXPORT_ALLOW_DESKTOP=0 \
    "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE/project" \
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
    node "$SCRIPTS_DIR/run-l1.mjs" "$PORT" "$WORKSPACE/project" "$OUT_DIR" "$MODE" "$RUN" || FAILED=1
  else
    echo "$MODE run $RUN: shell did not start"; FAILED=1
  fi
  kill "$ELECTRON_PID" 2>/dev/null; wait "$ELECTRON_PID" 2>/dev/null
  # ポートが空くのを待つ
  for _ in $(seq 1 30); do curl --silent --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || break; sleep 1; done
  rm -rf "$WORKSPACE" "$USERDATA"
done
exit "$FAILED"
