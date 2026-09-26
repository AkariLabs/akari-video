#!/bin/bash
# 本票が起動した Electron（user-data-dir が iso-osr-track-z-order-* のもの）だけを PID で止めてから、指定 fixture で起動し直す
# 使い方: bash relaunch.sh <fixture 名> <repo>
set -uo pipefail
W=${OSR_Z_WORK}; NAME=$1; REPO=$2
export CDP_PORT=9629
for p in $(pgrep -f "user-data-dir=$W/iso-osr-track-z-order-"); do kill -TERM "$p" 2>/dev/null; done; sleep 5
for p in $(pgrep -f "user-data-dir=$W/iso-osr-track-z-order-"); do kill -KILL "$p" 2>/dev/null; done; sleep 1
cd "$W/scripts"
node launch.mjs "$REPO" "$W/fixture/$NAME" "$W/iso-osr-track-z-order-$NAME" --port=9629 > "$W/pid-$NAME.json"
node open2.mjs "$W/fixture/$NAME" 2 >/dev/null 2>&1 || true
node click.mjs --text 開くだけ >/dev/null 2>&1 || true; node click.mjs --text キャンセル >/dev/null 2>&1 || true
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);s.collapsePanel('right');s.collapsePanel('left');return true})()" >/dev/null
sleep 3
cat "$W/pid-$NAME.json"
node click.mjs --text 出力プレビュー >/dev/null 2>&1 || true; sleep 3
