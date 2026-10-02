#!/usr/bin/env bash
# 検証用（ラッパー所掌）: edit-lint と render-cut を隔離環境で回す。bash render.sh <name...>
set -u
WT="<WORKTREE>"
export PATH="$HOME/.local/node:$PATH"
export AKARI_HOME='C:\t\odg-1002\home' TMP='C:\t\odg-1002\tmp' TEMP='C:\t\odg-1002\tmp'
export ELECTRON_OVERRIDE_DIST_PATH="<WORKTREE>/apps/shell/node_modules/electron/dist"  # 同版 39.8.7・HKCU に GpuPreference=2 登録済みの dist を読み取り専用で借りる（HKCU は書かない）
export AKARI_FFMPEG_BIN="$WT/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
mkdir -p /c/t/odg-1002/home /c/t/odg-1002/tmp /c/t/odg-1002/cwd
cd /c/t/odg-1002/cwd
for n in "$@"; do
  node "$WT/packages/edit-lint/bin/edit-lint.mjs" "C:/t/odg-1002/$n" > "/c/t/odg-1002/lint-$n.txt" 2>&1
  echo "$n lint EXIT $?" >> /c/t/odg-1002/render-status.txt
  node "$WT/packages/render-cut/bin/render-cut.mjs" "C:/t/odg-1002/$n" --engine auto --gpu-preference off --progress --force > "/c/t/odg-1002/render-$n.log" 2>&1
  echo "$n render EXIT $?" >> /c/t/odg-1002/render-status.txt
done
echo DONE "$@" >> /c/t/odg-1002/render-status.txt
