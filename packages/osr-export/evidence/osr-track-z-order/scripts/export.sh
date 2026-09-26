#!/bin/bash
# OSR / GPU 書き出し 1 本と 2.0 秒のフレーム抽出: bash export.sh <repo> <phase> <fixture> [engine=osr] [frameSec=2]
set -uo pipefail
REPO=$1; PHASE=$2; NAME=$3; ENGINE=${4:-osr}; AT=${5:-2}
W=${OSR_Z_WORK}; P=$W/fixture/$NAME; O=$W/out/$PHASE; mkdir -p "$O"
export AKARI_HOME=$W/akari-home-osr-track-z-order AKARI_EXPORT_ALLOW_DESKTOP=0
T0=$(python3 -c 'import time;print(time.time())')
node "$REPO/packages/render-cut/bin/render-cut.mjs" "$P" --engine "$ENGINE" --out "exports/$NAME-$ENGINE.mp4" --force > "$O/$NAME-$ENGINE.log" 2>&1; RC=$?
T1=$(python3 -c 'import time;print(time.time())')
SEC=$(python3 -c "print(round($T1-$T0,2))")
[ $RC -eq 0 ] && cp "$P/exports/$NAME-$ENGINE.mp4" "$O/" && cp "$P/.akari/render.json" "$O/$NAME-$ENGINE-render.json" && ffmpeg -hide_banner -loglevel error -nostdin -y -ss "$AT" -i "$O/$NAME-$ENGINE.mp4" -frames:v 1 "$O/$NAME-$ENGINE-${AT}s.png"
echo "{\"name\":\"$NAME\",\"engine\":\"$ENGINE\",\"rc\":$RC,\"seconds\":$SEC}"
