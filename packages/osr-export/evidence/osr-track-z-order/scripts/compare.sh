#!/bin/bash
# 左 = プレビュー、右 = 書き出し（同じ 2 秒）を横に並べる: bash compare.sh <phase> <name> [engine=osr]
set -uo pipefail
O=${OSR_Z_WORK}/out/$1; N=$2; E=${3:-osr}
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$O/$N-preview-2s.png" -i "$O/$N-$E-2s.png" \
  -filter_complex "[0]scale=640:360[p];[1]scale=640:360[x];[p][x]hstack=inputs=2" "$O/$N-compare-$E.png"
