#!/bin/bash
# 左 = OSR、右 = GPU（同じ秒）を横に並べる: bash compare.sh <phase> <name> [frameSec=2] [osrPhase=<phase>]
set -uo pipefail
O=${GPU_Z_WORK}/out/$1; N=$2; AT=${3:-2}; OO=${GPU_Z_WORK}/out/${4:-$1}
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$OO/$N-osr-${AT}s.png" -i "$O/$N-gpu-${AT}s.png" \
  -filter_complex "[0]scale=640:360[p];[1]scale=640:360[x];[p][x]hstack=inputs=2" "$O/$N-compare-osr-gpu.png"
