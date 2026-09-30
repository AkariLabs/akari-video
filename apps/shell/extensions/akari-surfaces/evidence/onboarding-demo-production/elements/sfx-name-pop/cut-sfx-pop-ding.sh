#!/usr/bin/env bash
# sfx-name-pop の音源（audio/sfx-pop-ding.m4a）を作り直すための切り出し（再現用）。
#
# 使い方: bash cut-sfx-pop-ding.sh <ffmpeg> <sfx-pop-ding.mp3> <out.m4a>
#
# - 素材: AKARI Sounds sfx-pop-ding（md5 5ff54570ae103ac2a7cb77f191841807・sha256 fb89816d…
#   = 台帳 provenance.jsonl の sfx-pop-ding-b・LicenseRef-AKARI-Sounds-v0・price 0）
# - 0〜0.5 s（24000 サンプル）を頭を切らずに切り出し、末尾 30 ms（1440 サンプル）を線形フェード。
#   音量は素材のまま（構成表の gain_db −6 で 10 ms 包絡の山 −12.3 dBFS になる）
# - AAC-LC 128 kbps / 48 kHz / 2ch の m4a。bitexact なので同じ ffmpeg なら同じ md5
# - 期待値（公開リポ packages/media-bin/vendor/win32-x64/ffmpeg.exe = n8.1.2 で作った場合）:
#   md5 ebadffece346be33ecd9f1f33533a405
set -euo pipefail
ffmpeg="$1"; src="$2"; out="$3"
"$ffmpeg" -hide_banner -loglevel error -y -i "$src" -map 0:a:0 -map_metadata -1 \
  -af "asetpts=N/SR/TB,atrim=end_sample=24000,afade=t=out:start_sample=22560:nb_samples=1440" \
  -ar 48000 -ac 2 -c:a aac -b:a 128k -movflags +faststart -fflags +bitexact -flags:a +bitexact "$out"
