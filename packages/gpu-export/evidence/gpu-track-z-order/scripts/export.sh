#!/bin/bash
# GPU / OSR 書き出し 1 本・指定秒のフレーム抽出・全フレームの framemd5 の md5・所要秒・launcher_tier:
#   bash export.sh <repo> <phase> <fixture> [engine=gpu] [frameSec=2] [runTag]
# 作業場所は環境変数 GPU_Z_WORK（fixture は $GPU_Z_WORK/fixture/<name>）
set -uo pipefail
REPO=$1; PHASE=$2; NAME=$3; ENGINE=${4:-gpu}; AT=${5:-2}; TAG=${6:-}
W=${GPU_Z_WORK}; P=$W/fixture/$NAME; O=$W/out/$PHASE; mkdir -p "$O"
export AKARI_HOME=$W/akari-home-gpu-track-z-order AKARI_EXPORT_ALLOW_DESKTOP=0
B=$NAME-$ENGINE${TAG:+-$TAG}
T0=$(python3 -c 'import time;print(time.time())')
node "$REPO/packages/render-cut/bin/render-cut.mjs" "$P" --engine "$ENGINE" --out "exports/$B.mp4" --force > "$O/$B.log" 2>&1; RC=$?
T1=$(python3 -c 'import time;print(time.time())')
SEC=$(python3 -c "print(round($T1-$T0,2))")
MD5=null; TIER=null
if [ $RC -eq 0 ]; then
  cp "$P/exports/$B.mp4" "$O/" && cp "$P/.akari/render.json" "$O/$B-render.json"
  ffmpeg -hide_banner -loglevel error -nostdin -y -ss "$AT" -i "$O/$B.mp4" -frames:v 1 "$O/$B-${AT}s.png"
  MD5=\"$(ffmpeg -hide_banner -loglevel error -nostdin -i "$O/$B.mp4" -map 0:v -f framemd5 - | grep -v '^#' | md5 -q | cut -c1-8)\"
  TIER=$(node -e "const r=require('$O/$B-render.json');const p=r.provenance||{};console.log(JSON.stringify((p.gpu&&p.gpu.provenance&&p.gpu.provenance.launcher_tier)??(p.osr&&p.osr.provenance&&p.osr.provenance.launcher_tier)??(p.osr&&p.osr.launcher_tier)??null))")
fi
echo "{\"name\":\"$NAME\",\"engine\":\"$ENGINE\",\"tag\":\"$TAG\",\"rc\":$RC,\"seconds\":$SEC,\"md5\":$MD5,\"tier\":$TIER}"
