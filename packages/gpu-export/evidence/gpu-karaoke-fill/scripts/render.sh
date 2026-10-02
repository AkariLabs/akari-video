#!/usr/bin/env bash
# 検証用（ラッパー所掌）: render-cut を隔離環境で回す。bash render.sh <project-dir> <engine> <log>
# AKARI_HOME / HOME / TMP は C:\t\gkf 配下に隔離。--gpu-preference off（HKCU の GPU 設定を書かない）。
set -u
WT="$(cd "$(dirname "$0")/../../../../.." && pwd)"  # リポジトリのルート（この scripts/ から 5 段上）
export PATH="$HOME/.local/node:$PATH"
mkdir -p /c/t/gkf/home /c/t/gkf/tmp /c/t/gkf/cwd /c/t/gkf/userhome
export AKARI_HOME='C:\t\gkf\home' TMP='C:\t\gkf\tmp' TEMP='C:\t\gkf\tmp' HOME='C:\t\gkf\userhome' USERPROFILE='C:\t\gkf\userhome'
export AKARI_FFMPEG_BIN="$WT/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
unset ELECTRON_RUN_AS_NODE AKARI_EXPORT_ALLOW_DESKTOP
cd /c/t/gkf/cwd
PROJECT="$1"; ENGINE="$2"; LOG="$3"
start=$(date +%s)
node "$WT/packages/render-cut/bin/render-cut.mjs" "$PROJECT" --engine "$ENGINE" --gpu-preference off --progress --force --no-verify-blank --out "$PROJECT/exports/out-$ENGINE.mp4" > "$LOG" 2>&1
code=$?
echo "EXIT $code SECONDS $(( $(date +%s) - start ))" >> "$LOG"
echo "EXIT $code"
