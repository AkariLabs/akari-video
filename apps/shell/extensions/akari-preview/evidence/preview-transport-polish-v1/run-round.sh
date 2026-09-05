#!/usr/bin/env bash
# Runs one BEFORE/AFTER L1 round: boots apps/shell Electron (tier 2, worktree
# node_modules/electron) once per fixture workspace, drives run-l1.mjs against
# it over CDP, then tears the app down.
#
#   bash run-round.sh <label> [fixture ...]      # label = before | after
#
# Fixture workspaces are prepared by the wrapper under $SCRATCH (see report.md).
# Teardown is scoped to this worktree's electron binary + the run's
# --user-data-dir so that Electron instances of other worktrees are never hit.
set -uo pipefail

LABEL="${1:?label (before|after)}"; shift || true
FIXTURES=("$@")
[ ${#FIXTURES[@]} -eq 0 ] && FIXTURES=(16x9 9x16 look raw)
SCRATCH="${SCRATCH:-/tmp/akari-ptp/scratch}"
OUT="${OUT:-/tmp/akari-ptp/out}"
PORT="${PORT:-9412}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/../../../.." && pwd)"      # apps/shell
REPO_ROOT="$(cd "$SHELL_DIR/../.." && pwd)"
ELECTRON="$REPO_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

mkdir -p "$OUT"
rc=0

kill_scoped() {   # only processes of THIS worktree on THIS user-data-dir
  local ud="$1"
  pkill -9 -f "user-data-dir=$ud" 2>/dev/null
  sleep 1
  local i=0
  until ! curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; do
    i=$((i+1)); [ $i -gt 20 ] && break
    pkill -9 -f "user-data-dir=$ud" 2>/dev/null
    sleep 1
  done
}

run_one() {
  local key="$1" ws="$2" target="$3"
  local ud="/tmp/akari-ptp/ud-$key" cfg="/tmp/akari-ptp/cfg-$key"
  mkdir -p "$ud" "$cfg"   # kept warm across rounds: a cold boot takes ~180 s
  # make sure nothing else of ours holds the debug port
  for other in /tmp/akari-ptp/ud-*; do kill_scoped "$other"; done
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
    echo "!! port $PORT still busy — aborting $key"; return 1
  fi
  echo "=== [$LABEL/$key] booting Electron on $ws ==="
  ( cd "$SHELL_DIR" && THEIA_CONFIG_DIR="$cfg" "$ELECTRON" "$SHELL_DIR" "$ws" \
      --remote-debugging-port="$PORT" --user-data-dir="$ud" --no-sandbox \
      --disable-background-timer-throttling \
      --disable-backgrounding-occluded-windows \
      --disable-renderer-backgrounding \
      > "$OUT/$LABEL-$key-electron.log" 2>&1 ) &
  local i=0
  until curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; do
    i=$((i+1)); [ $i -gt 120 ] && { echo "CDP never came up"; kill_scoped "$ud"; return 1; }
    sleep 1
  done
  sleep 3
  node "$HERE/run-l1.mjs" "$PORT" "$LABEL" "$key" "$target" "$OUT" \
    > "$OUT/$LABEL-$key-driver.log" 2>&1
  local drc=$?
  echo "=== [$LABEL/$key] driver exit=$drc ==="
  tail -4 "$OUT/$LABEL-$key-driver.log"
  kill_scoped "$ud"
  return $drc
}

for key in "${FIXTURES[@]}"; do
  case "$key" in
    16x9) run_one 16x9 "$SCRATCH/w16x9" edit.json || rc=1 ;;
    9x16) run_one 9x16 "$SCRATCH/w9x16" edit.json || rc=1 ;;
    look) run_one look "$SCRATCH/wlook" edit.json || rc=1 ;;
    raw)  run_one raw  "$SCRATCH/w16x9" assets/base-black.mp4 || rc=1 ;;
    *) echo "unknown fixture $key"; rc=1 ;;
  esac
done

echo "round $LABEL rc=$rc"
exit $rc
