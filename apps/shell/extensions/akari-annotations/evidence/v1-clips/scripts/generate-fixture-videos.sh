#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR="$SCRIPT_DIR/../fixture/project"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=red:s=320x180:r=30:d=2.2" \
  -c:v libx264 -pix_fmt yuv420p -an "$PROJECT_DIR/source-red.mp4"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=blue:s=320x180:r=30:d=2.2" \
  -c:v libx264 -pix_fmt yuv420p -an "$PROJECT_DIR/source-blue.mp4"

ffprobe -v error -show_entries stream=codec_name,width,height \
  -of default=noprint_wrappers=1 "$PROJECT_DIR/source-red.mp4"
ffprobe -v error -show_entries stream=codec_name,width,height \
  -of default=noprint_wrappers=1 "$PROJECT_DIR/source-blue.mp4"
