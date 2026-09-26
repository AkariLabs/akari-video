#!/bin/bash
# 起動済みの Electron で、タイムライン・プレビューを開き、右パネルを畳み、ライブラリの画像カテゴリを開いて再生位置を置く（setup.sh の後半）。
# 使い方: bash post-launch.sh <project> <seek秒>
set -uo pipefail
P=$1; SEEK=$2; HERE=$(cd "$(dirname "$0")" && pwd); cd "$HERE"
export CDP_PORT=${CDP_PORT:-9622} AKARI_CDP_TIMEOUT_MS=${AKARI_CDP_TIMEOUT_MS:-120000}
# 起動直後の読み込み表示が消えるまで待つ（負荷が高い機械では数分かかる）
for i in $(seq 1 120); do r=$(node ev.mjs "Boolean(document.getElementById('theia-app-shell'))&&!document.querySelector('.theia-preload:not(.theia-hidden)')" 2>/dev/null); [ "$r" = "true" ] && break; sleep 5; done
node open.mjs "$P" 1 && node click.mjs --text 開くだけ > /dev/null
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
sleep 2; node click.mjs --text ライブラリ > /dev/null; sleep 4; node opencat.mjs image > /dev/null
node seek.mjs "$P" "$SEEK"
