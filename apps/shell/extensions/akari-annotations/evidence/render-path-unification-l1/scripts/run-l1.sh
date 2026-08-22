#!/bin/bash
# render-path-unification-l1 の L1 実測オーケストレータ。
# 3シナリオそれぞれについて: フィクスチャ用意（Electron 起動前・ディスクへ書く）->
# Electron 起動 -> run-l1.mjs <phase> -> Electron kill、を順に行う。
# t4-track-height-resize/scripts/run-l1.sh のフェーズ分割パターンを流用（理由は
# scripts/prepare-fixture.mjs の冒頭コメント: Page.reload だけでは別プロジェクトへ
# 切り替わらないため、シナリオごとに新しい Electron プロセスが要る）。
#
# Usage: run-l1.sh
set -uo pipefail

SHELL_DIR="<WORKTREE>/apps/shell"
EVIDENCE_DIR="$SHELL_DIR/extensions/akari-annotations/evidence/render-path-unification-l1"
SCRIPTS_DIR="$EVIDENCE_DIR/scripts"
WORKSPACE="/tmp/render-path-unification-l1-ws"
USERDATA="/tmp/render-path-unification-l1-userdata"
PORT=9611
ELECTRON_BIN="$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

echo "=== [setup] preparing isolated workspace ==="
rm -rf "$WORKSPACE" "$USERDATA"
mkdir -p "$WORKSPACE"

wait_for_cdp() {
  local i=0
  until curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      echo "=== CDP did not become ready within 90s ==="
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

OVERALL_EXIT=0
for PHASE in 1 2a 2b 3a 3b; do
  echo "=== [phase$PHASE] preparing fixture ==="
  node "$SCRIPTS_DIR/prepare-fixture.mjs" "$PHASE" "$WORKSPACE"

  rm -rf "$USERDATA"
  mkdir -p "$USERDATA"

  echo "=== [phase$PHASE] launching electron ==="
  THEIA_CONFIG_DIR="$USERDATA" "$ELECTRON_BIN" "$SHELL_DIR" "$WORKSPACE" \
    --remote-debugging-port=$PORT --user-data-dir="$USERDATA" --no-sandbox \
    > "/tmp/render-path-unification-l1-electron-phase$PHASE.log" 2>&1 &
  wait_for_cdp
  CDP_READY=$?
  PHASE_EXIT=1
  if [ "$CDP_READY" -eq 0 ]; then
    node "$SCRIPTS_DIR/run-l1.mjs" "$PHASE" $PORT "$WORKSPACE" "$EVIDENCE_DIR"
    PHASE_EXIT=$?
  else
    tail -60 "/tmp/render-path-unification-l1-electron-phase$PHASE.log"
  fi

  echo "=== [phase$PHASE] killing electron (userdata=$USERDATA) ==="
  kill_electron_by_userdata

  echo "PHASE${PHASE}_EXIT=$PHASE_EXIT"
  if [ "$PHASE_EXIT" -ne 0 ]; then
    OVERALL_EXIT=1
  fi
done

echo "=== [cleanup] verifying no leftover processes for this run ==="
ps aux | grep -- "$USERDATA" | grep -v grep

echo "=== [compare] scenario 2 / scenario 3 before-vs-after (no live drag; see run-l1.mjs comment) ==="
node "$SCRIPTS_DIR/compare-states.mjs" "$EVIDENCE_DIR"
COMPARE_EXIT=$?
if [ "$COMPARE_EXIT" -ne 0 ]; then
  OVERALL_EXIT=1
fi

echo "OVERALL_EXIT=$OVERALL_EXIT"
exit "$OVERALL_EXIT"
