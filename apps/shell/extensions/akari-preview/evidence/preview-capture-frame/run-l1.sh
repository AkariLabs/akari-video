#!/usr/bin/env bash
# Boots apps/shell Electron (worktree node_modules/electron) on a fixture workspace with
# temporary AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir, drives run-l1.mjs over CDP,
# then tears down only this run's processes.
#   WS=/tmp/akari-pcf/ws OUT=/tmp/akari-pcf/out bash run-l1.sh
set -uo pipefail
WS="${WS:?fixture workspace}"; OUT="${OUT:?output dir}"; PORT="${PORT:-9431}"
TMPROOT="${TMPROOT:-/tmp/akari-pcf}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/../../../.." && pwd)"
REPO_ROOT="$(cd "$SHELL_DIR/../.." && pwd)"
ELECTRON="$REPO_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
export FFMPEG="$REPO_ROOT/packages/media-bin/vendor/darwin-arm64/ffmpeg"
UD="$TMPROOT/ud"; CFG="$TMPROOT/cfg"; AH="$TMPROOT/akari-home"
mkdir -p "$OUT" "$UD" "$CFG" "$AH"
kill_scoped() { pkill -9 -f "user-data-dir=$UD" 2>/dev/null; sleep 1; }
kill_scoped
if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then echo "port $PORT busy"; exit 1; fi
( cd "$SHELL_DIR" && AKARI_HOME="$AH" THEIA_CONFIG_DIR="$CFG" "$ELECTRON" "$SHELL_DIR" "$WS" \
    --remote-debugging-port="$PORT" --user-data-dir="$UD" --no-sandbox \
    --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
    > "$OUT/electron.log" 2>&1 ) &
i=0
until curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 180 ] && { echo "CDP never came up"; kill_scoped; exit 1; }; sleep 1
done
sleep 3
node "$HERE/run-l1.mjs" "$PORT" "$WS" "$OUT" > "$OUT/driver.log" 2>&1
rc=$?
echo "driver exit=$rc"; tail -12 "$OUT/driver.log"
kill_scoped
exit $rc
