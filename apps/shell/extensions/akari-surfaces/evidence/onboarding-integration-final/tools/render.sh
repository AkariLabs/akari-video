#!/usr/bin/env bash
# 検証用（ラッパー所掌）: 統合ブランチでお手本を edit-lint と render-cut --engine auto にかける（隔離）。bash render.sh <name>
set -u
WT="<WORKTREE>"
export PATH="$HOME/.local/node:$PATH"
unset ELECTRON_RUN_AS_NODE
export AKARI_HOME='C:\t\oif\home' HOME='C:\t\oif\home' USERPROFILE='C:\t\oif\home' TMP='C:\t\oif\rtmp' TEMP='C:\t\oif\rtmp'
export ELECTRON_OVERRIDE_DIST_PATH="${ELECTRON_OVERRIDE_DIST_PATH:-<WORKTREE>/node_modules/electron/dist}"  # 同版 39.8.7・GPU 優先登録済みの dist を読み取り専用で借りる（HKCU は書かない）
export AKARI_FFMPEG_BIN="$WT/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
mkdir -p /c/t/oif/home /c/t/oif/rtmp /c/t/oif/cwd
cd /c/t/oif/cwd
n=$1
node "$WT/packages/edit-lint/bin/edit-lint.mjs" "C:/t/oif/$n" > "/c/t/oif/lint-$n.txt" 2>&1; echo "$n lint EXIT $?" >> /c/t/oif/render-status.txt
s=$(date +%s)
node "$WT/packages/render-cut/bin/render-cut.mjs" "C:/t/oif/$n" --engine auto --gpu-preference off --progress --force > "/c/t/oif/render-$n.log" 2>&1
echo "$n render EXIT $? secs=$(( $(date +%s) - s ))" >> /c/t/oif/render-status.txt
