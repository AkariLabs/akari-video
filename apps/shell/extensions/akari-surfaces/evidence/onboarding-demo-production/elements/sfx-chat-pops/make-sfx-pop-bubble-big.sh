#!/usr/bin/env bash
# sfx-chat-pops（構成表 #4）の音源を作り直す手順。入力は読むだけ。
# 元: AKARI Sounds sfx-pop-bubble-big.mp3（md5 0a4a1d03782415ea48a9996cd829217e・LicenseRef-AKARI-Sounds-v0・price 0）
#   ~/Akari/library/audio/akari-sounds-sfx/sfx-pop-bubble-big.mp3（工房の台帳: akari-video-internal assets/audio/sfx-pop-bubble-big/meta.json）
# 出力: apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/audio/sfx-pop-bubble-big.m4a
#   md5 549003034b7909765d269e0edf1fb83d（ffmpeg n8.1.2 = packages/media-bin/vendor/win32-x64 で作成）
set -euo pipefail
FF="${FF:-packages/media-bin/vendor/win32-x64/ffmpeg.exe}"
SRC="${1:-$HOME/Akari/library/audio/akari-sounds-sfx/sfx-pop-bubble-big.mp3}"
OUT="${2:-apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/audio/sfx-pop-bubble-big.m4a}"
TMP="$(mktemp -d)"
# 1) 左右を中央へ寄せる（元は L −1.7 / R −8.2 dBFS で左に 8 dB 偏る。吹き出しは画面右なので左寄りの音は逆向き）。
#    頭は切らない（アタック 18 ms の位置を保つ）。0〜0.15 s
"$FF" -hide_banner -loglevel error -y -i "$SRC" \
  -af "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,atrim=start=0:end=0.15,asetpts=PTS-STARTPTS" \
  -c:a pcm_f32le -ar 48000 "$TMP/stage1.wav"
# 2) ピークを −12 dBFS へ（中央寄せ後のピーク −5.025 dBFS → −6.975 dB）。edit.json の gain_db −4 で
#    書き出しのピークが構成表の目安 −16 dBFS になる。末尾 30 ms フェード
"$FF" -hide_banner -loglevel error -y -i "$TMP/stage1.wav" \
  -af "volume=-6.975dB,afade=t=out:st=0.12:d=0.03" -c:a pcm_f32le -ar 48000 "$TMP/stage2.wav"
# 3) AAC 128 kbps / 48 kHz / stereo の m4a。タグは持ち込まない
"$FF" -hide_banner -loglevel error -y -i "$TMP/stage2.wav" -map_metadata -1 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -movflags +faststart "$OUT"
rm -rf "$TMP"
