#!/usr/bin/env bash
# 検証用（ラッパー所掌）: edit-lint と render-cut を隔離環境で回す。bash render.sh <name...>
set -u
WT="<WORKTREE>"
export PATH="$HOME/.local/node:$PATH"
export AKARI_HOME='C:\t\odt-1001\home' TMP='C:\t\odt-1001\tmp' TEMP='C:\t\odt-1001\tmp'
export AKARI_FFMPEG_BIN="$WT/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
mkdir -p /c/t/odt-1001/home /c/t/odt-1001/tmp /c/t/odt-1001/cwd
cd /c/t/odt-1001/cwd
for n in "$@"; do
  node "$WT/packages/edit-lint/bin/edit-lint.mjs" "C:/t/odt-1001/$n" > "/c/t/odt-1001/lint-$n.txt" 2>&1
  echo "$n lint EXIT $?" >> /c/t/odt-1001/render-status.txt
  node "$WT/packages/render-cut/bin/render-cut.mjs" "C:/t/odt-1001/$n" --engine auto --gpu-preference off --progress --force > "/c/t/odt-1001/render-$n.log" 2>&1
  echo "$n render EXIT $?" >> /c/t/odt-1001/render-status.txt
done
echo DONE "$@" >> /c/t/odt-1001/render-status.txt
