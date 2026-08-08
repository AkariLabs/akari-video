#!/usr/bin/env bash
# マシンが空くのを待ってからレンダーする。
# 混んでいる最中に焼くと 1 フレームのタイムアウトに引っかかって全体が落ちるため、待つほうが速い。
#
#   akari internal beat-sync-render-when-idle <project> [--max-load N] [--wait-minutes N] [--timeout-ms N] [-- <render-cut への追加引数>]
set -uo pipefail

PROJECT="${1:-.}"; shift || true
MAX_LOAD=8
WAIT_MINUTES=240
TIMEOUT_MS=300000
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-load) MAX_LOAD="$2"; shift 2 ;;
    --wait-minutes) WAIT_MINUTES="$2"; shift 2 ;;
    --timeout-ms) TIMEOUT_MS="$2"; shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_CUT="$SCRIPT_DIR/../../render-cut/bin/render-cut.mjs"
LOG_DIR="$PROJECT/.akari/work"
mkdir -p "$LOG_DIR"
WAIT_LOG="$LOG_DIR/render-wait.log"

current_load() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ','; }

for ((i = 0; i < WAIT_MINUTES; i++)); do
  LA="$(current_load)"
  OK="$(awk -v a="$LA" -v b="$MAX_LOAD" 'BEGIN { print (a + 0 < b + 0) ? 1 : 0 }')"
  echo "$(date +%H:%M:%S) load=$LA threshold=$MAX_LOAD ok=$OK" >> "$WAIT_LOG"
  if [[ "$OK" == "1" ]]; then
    echo "$(date +%H:%M:%S) starting render (load=$LA)" >> "$WAIT_LOG"
    RENDER_CUT_CAPTURE_TIMEOUT_MS="$TIMEOUT_MS" node "$RENDER_CUT" "$PROJECT" "${EXTRA[@]}"
    RC=$?
    echo "$(date +%H:%M:%S) render exited rc=$RC" >> "$WAIT_LOG"
    exit $RC
  fi
  sleep 60
done

echo "$(date +%H:%M:%S) gave up waiting (load stayed >= $MAX_LOAD for $WAIT_MINUTES min)" >> "$WAIT_LOG"
exit 1
