#!/usr/bin/env bash
# お手本の BGM（bgm.m4a）を作る — 2026-10-01 作り直し（構成表 plan.json の要素 "bgm"）
#
# 曲: AKARI Sounds bgm-lofi-minimal-085「Midnight Notepad」（85 BPM・LicenseRef-AKARI-Sounds-v0・price 0）
#     ~/Akari/library/audio/akari-sounds-bgm/bgm-lofi-minimal-085.mp3（md5 982faf7ae59a77f7e5c45787c84f0058）
# 切り出し: 原曲の 3456 サンプル目（0.072 s）から 1,804,800 サンプル（37.600 s）。
#   曲のビートグリッド宣言（bpm 84.9987・beat_offset_s 0.007、assets/audio/bgm-lofi-minimal-085/meta.json）で
#   拍 28 は原曲 19.772 s → 0.072 s ずらすと 19.700 s（「パッ」の語頭）。構成表の 0.080 は旧ファイルの
#   打点の目視値 19.78 からの丸め。0.080 だと拍は 19.692。
# 音量・フェード・持ち上げは音源へ焼かない（edit.json の gain_db / fade_in / fade_out / keyframes で指定）。
# 同じ入力と同じ ffmpeg（media-bin vendor n8.1.2）で md5 が一致する（+bitexact）。
set -euo pipefail
SRC="${1:-$HOME/Akari/library/audio/akari-sounds-bgm/bgm-lofi-minimal-085.mp3}"
OUT="${2:-bgm.m4a}"
FFMPEG="${FFMPEG:-packages/media-bin/vendor/win32-x64/ffmpeg.exe}"
"$FFMPEG" -v error -y -i "$SRC" \
  -af "atrim=start_sample=3456:end_sample=1808256,asetpts=PTS-STARTPTS" \
  -c:a aac -b:a 96k -ar 48000 -ac 2 \
  -movflags +faststart -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  "$OUT"
