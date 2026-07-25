#!/bin/bash
# t4-track-height-resize の L1 実測オーケストレータ。
# dogfood コピーの用意 → Electron 起動(phase1) → run-l1.mjs phase1 →
# Electron kill → Electron 再起動(同一 user-data-dir) → run-l1.mjs phase2（再起動後のティア保持）
# → Electron kill → 後片付け、まで一気通貫で行う。全ての待ちはフォアグラウンドの
# until ループで待ち切る（バックグラウンド完了通知には頼らない）。
#
# Usage: run-l1.sh
set -uo pipefail

SHELL_DIR="/Users/ryoma/_edit/30_products/akari-video-wt/t4-track-height-resize/apps/shell"
EVIDENCE_DIR="$SHELL_DIR/extensions/akari-annotations/evidence/t4-track-height-resize"
SCRIPTS_DIR="$EVIDENCE_DIR/scripts"
DOGFOOD_SRC="$HOME/Movies/AkariVideo/selection-dogfood"
WORKSPACE="/tmp/t4-track-height-resize-l1"
USERDATA="/tmp/t4-track-height-resize-l1-userdata"
PORT=9541
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

echo "=== [setup] preparing isolated workspace copy (APFS clone, .git excluded) ==="
rm -rf "$WORKSPACE" "$USERDATA"
mkdir -p "$WORKSPACE"
# APFS copy-on-write clone (-c): near-instant, no real duplication of the ~1.6GB dogfood dir.
# .git (576MB) is irrelevant to L1 and excluded to keep the clone fast.
(cd "$DOGFOOD_SRC" && find . -mindepth 1 -maxdepth 1 ! -name '.git') | while read -r entry; do
  cp -Rc "$DOGFOOD_SRC/$entry" "$WORKSPACE/$entry"
done
node "$SCRIPTS_DIR/prepare-fixture.mjs" "$WORKSPACE"
mkdir -p "$USERDATA"

wait_for_cdp() {
  local label="$1"
  local i=0
  until curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      echo "=== [$label] CDP did not become ready within 90s ==="
      return 1
    fi
    sleep 1
  done
  return 0
}

kill_electron_by_userdata() {
  local pids
  pids=$(ps aux | grep -- "--user-data-dir=$USERDATA" | grep -v grep | awk '{print $2}')
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
  local i=0
  while ps aux | grep -- "--user-data-dir=$USERDATA" | grep -v grep > /dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
      break
    fi
    sleep 1
  done
}

echo "=== [phase1] launching electron ==="
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE" \
  --remote-debugging-port=$PORT --user-data-dir="$USERDATA" --no-sandbox \
  > /tmp/t4-electron-phase1.log 2>&1 &
wait_for_cdp "phase1"
CDP_READY=$?
PHASE1_EXIT=1
if [ "$CDP_READY" -eq 0 ]; then
  node "$SCRIPTS_DIR/run-l1.mjs" phase1 $PORT "$WORKSPACE" "$EVIDENCE_DIR"
  PHASE1_EXIT=$?
else
  tail -40 /tmp/t4-electron-phase1.log
fi

echo "=== [phase1] killing electron (userdata=$USERDATA) ==="
kill_electron_by_userdata

if [ "$PHASE1_EXIT" -ne 0 ]; then
  echo "=== PHASE1 FAILED (exit=$PHASE1_EXIT), skipping restart test ==="
  exit "$PHASE1_EXIT"
fi

echo "=== [phase2] relaunching electron (same user-data-dir) for restart-persistence check ==="
THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE" \
  --remote-debugging-port=$PORT --user-data-dir="$USERDATA" --no-sandbox \
  > /tmp/t4-electron-phase2.log 2>&1 &
wait_for_cdp "phase2"
CDP_READY=$?
PHASE2_EXIT=1
if [ "$CDP_READY" -eq 0 ]; then
  node "$SCRIPTS_DIR/run-l1.mjs" phase2 $PORT "$WORKSPACE" "$EVIDENCE_DIR"
  PHASE2_EXIT=$?
else
  tail -40 /tmp/t4-electron-phase2.log
fi

echo "=== [phase2] killing electron (userdata=$USERDATA) ==="
kill_electron_by_userdata

echo "=== [cleanup] verifying no leftover processes for this run ==="
ps aux | grep -- "$USERDATA" | grep -v grep

echo "PHASE1_EXIT=$PHASE1_EXIT PHASE2_EXIT=$PHASE2_EXIT"
if [ "$PHASE1_EXIT" -ne 0 ] || [ "$PHASE2_EXIT" -ne 0 ]; then
  exit 1
fi
exit 0
