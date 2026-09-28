#!/bin/bash
# frames.sh <mp4> <outdir> : 各字幕の中央時刻（i+0.5 秒）の 1 枚を PNG に切り出す（18 枚）
set -e
mkdir -p "$2"
for i in $(seq 0 17); do ffmpeg -hide_banner -loglevel error -y -ss $i.5 -i "$1" -frames:v 1 "$2/cue-$(printf %02d $((i+1))).png"; done
