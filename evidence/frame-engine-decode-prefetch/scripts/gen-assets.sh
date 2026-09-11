#!/bin/bash
# L1 用の検証素材を作る（作業機の絶対パスを含めないよう env で受ける）。
#   SOURCE=<実機 1080p30 H.264 の原本> FFMPEG=<ffmpeg> OUT=<出力ディレクトリ> ./gen-assets.sh
# 1080p は原本を -c copy（GOP ≈ 29〜30・B なし）、4K は videotoolbox 60 Mbps・g=30 で拡大再エンコード。
set -eu
: "${SOURCE:?}" "${FFMPEG:?}" "${OUT:?}"
mkdir -p "$OUT"
"$FFMPEG" -v error -y -t 20 -i "$SOURCE" -c copy -an "$OUT/1080p30-h264.mp4"
"$FFMPEG" -v error -y -t 30 -i "$SOURCE" -c copy -an "$OUT/1080p30-h264-30s.mp4"
"$FFMPEG" -v error -y -t 20 -i "$SOURCE" -vf scale=3840:2160:flags=lanczos -c:v h264_videotoolbox -b:v 60M -g 30 -pix_fmt yuv420p -an "$OUT/4k30-h264.mp4"
