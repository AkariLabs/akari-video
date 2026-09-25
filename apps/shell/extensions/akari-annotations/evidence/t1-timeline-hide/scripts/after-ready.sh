#!/bin/bash
# 起動が遅い（機械の負荷）ときに setup の後段をやり直す: 起動完了のログを待ってから、開く → 右を畳む → ライブラリ → シーク。使い方: bash after-ready.sh <work> <ws名> <seek秒>
set -uo pipefail
W=$1; WS=$2; SEEK=$3; HERE=$(cd "$(dirname "$0")" && pwd); cd "$HERE"
export CDP_PORT=${CDP_PORT:-9562} AKARI_CDP_TIMEOUT_MS=${AKARI_CDP_TIMEOUT_MS:-90000}
until grep -q "Frontend application startup sequence completed" "$W/iso-$WS/electron.log"; do sleep 5; done; sleep 5
node open.mjs "$W/$WS" 1; sleep 3; node click.mjs --text 開くだけ > /dev/null; node click.mjs --text キャンセル > /dev/null; node click.mjs --text 後で > /dev/null
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
sleep 2; node click.mjs --text ライブラリ > /dev/null; sleep 4; node seek.mjs "$W/$WS" "$SEEK"
