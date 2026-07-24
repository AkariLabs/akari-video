#!/usr/bin/env bash
# out-clamp-hardening の L1 検証用ワークスペースを SCRATCH 配下に用意する。
# fixtures/{fresh-open,no-sidecar,unresolvable}/ の JSON をコピーし、
# fresh-open と no-sidecar には ffmpeg lavfi で実尺 6.0 秒ちょうどの実動画を生成する
# （unresolvable は意図的に動画を置かない — 存在しないパスのテスト）。
#
# Usage: scripts/prepare-workspaces.sh <SCRATCH_DIR>
set -euo pipefail
SCRATCH="${1:?usage: prepare-workspaces.sh <SCRATCH_DIR>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$HERE/../fixtures"

mkdir -p "$SCRATCH"

for name in fresh-open no-sidecar unresolvable; do
  dest="$SCRATCH/$name"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$FIXTURES/$name/." "$dest/"
done

mkdir -p "$SCRATCH/fresh-open/assets" "$SCRATCH/no-sidecar/assets"
ffmpeg -y -f lavfi -i "testsrc=size=320x180:rate=30:duration=6" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$SCRATCH/fresh-open/assets/source.mp4" -loglevel error
ffmpeg -y -f lavfi -i "testsrc=size=320x180:rate=30:duration=6" \
  -f lavfi -i "sine=frequency=880:duration=6" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$SCRATCH/no-sidecar/assets/source.mp4" -loglevel error

echo "real durations (ffprobe):"
for name in fresh-open no-sidecar; do
  dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$SCRATCH/$name/assets/source.mp4")
  echo "  $name/assets/source.mp4 = ${dur}s"
done
echo "workspaces ready under $SCRATCH"
