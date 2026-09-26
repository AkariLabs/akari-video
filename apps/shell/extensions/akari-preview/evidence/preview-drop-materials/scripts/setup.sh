#!/bin/bash
# 起動〜タイムラインとプレビューを開いてプレイヘッドを置くまで。
# 使い方: bash setup.sh <repo> <work> <ws名> <seek秒> [<開くパス>]
#   <開くパス> を渡すと、そのパス（symlink・NFD 名など）で作業場所を開く（既定は <work>/<ws名>）
set -uo pipefail
REPO=$1; W=$2; WS=$3; SEEK=$4; OPEN=${5:-$W/$WS}; HERE=$(cd "$(dirname "$0")" && pwd)
export CDP_PORT=${CDP_PORT:-9621} AKARI_CDP_TIMEOUT_MS=${AKARI_CDP_TIMEOUT_MS:-60000}
rm -rf "$W/$WS" && cp -R "$W/fixture/spoken" "$W/$WS"
(cd "$REPO" && node "$HERE/launch.mjs" "$REPO" "$OPEN" "$W/iso-$WS" --port=$CDP_PORT) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pid))' > "$W/pid-$WS"
cd "$HERE"
# ウィンドウの大きさを揃える（本票の PID のウィンドウだけ）
osascript -e "tell application \"System Events\" to set size of window 1 of (first process whose unix id is $(cat "$W/pid-$WS")) to {1440, 900}" > /dev/null 2>&1 || true
node open.mjs "$OPEN" 1 && node click.mjs --text 開くだけ > /dev/null
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
node click.mjs --text 出力プレビュー > /dev/null; sleep 2
node seek.mjs "$OPEN" "$SEEK"
echo "pid=$(cat "$W/pid-$WS")"
