#!/bin/bash
# 起動〜プレビューを出してシークするまで（文字 1 つ + 写真 1 枚を置いた fixture = fixture/placed を複製）。使い方: bash setup-placed.sh <repo> <work> <ws名> <seek秒>
set -uo pipefail
REPO=$1; W=$2; WS=$3; SEEK=$4; HERE=$(cd "$(dirname "$0")" && pwd)
export CDP_PORT=${CDP_PORT:-9557} AKARI_CDP_TIMEOUT_MS=${AKARI_CDP_TIMEOUT_MS:-60000}
rm -rf "$W/$WS" && cp -R "$W/fixture/placed" "$W/$WS"
(cd "$REPO" && node "$HERE/launch.mjs" "$REPO" "$W/$WS" "$W/iso-$WS" --port=$CDP_PORT) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pid))' > "$W/pid-$WS"
# ライブラリの写真の実体（BEFORE の走行で取得済み）を専用 AKARI_HOME へ敷く
[ -d "$W/seed/assets" ] && cp -R "$W/seed/assets" "$W/iso-$WS/akari-home/assets"
cd "$HERE"
node open.mjs "$W/$WS" 1 && node click.mjs --text 開くだけ > /dev/null
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
sleep 2; node click.mjs --text ライブラリ > /dev/null; sleep 4; node home.mjs > /dev/null
node seek.mjs "$W/$WS" "$SEEK"
echo "pid=$(cat "$W/pid-$WS")"
