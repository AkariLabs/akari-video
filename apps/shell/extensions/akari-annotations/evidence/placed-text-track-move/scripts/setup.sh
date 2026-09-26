#!/bin/bash
# 起動〜タイムラインを開いて置いた文字を 1 本（3〜6 秒）置き、fixture の git に積むまで（ラッパー作成の検証スクリプト）。
# 使い方: bash setup.sh <repo> <work> <ws名>   （<work>/fixture/base が gen-fixture.mjs の出力。CDP_PORT 既定 9627）
set -uo pipefail
REPO=$1; W=$2; WS=$3; HERE=$(cd "$(dirname "$0")" && pwd)
export CDP_PORT=${CDP_PORT:-9627} AKARI_CDP_TIMEOUT_MS=${AKARI_CDP_TIMEOUT_MS:-60000}
rm -rf "$W/$WS" && cp -R "$W/fixture/base" "$W/$WS"
(cd "$REPO" && node "$HERE/launch.mjs" "$REPO" "$W/$WS" "$W/iso-$WS" --port=$CDP_PORT) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pid))' > "$W/pid-$WS"
cd "$HERE"
node open.mjs "$W/$WS" 4 && node click.mjs --text 開くだけ > /dev/null
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
if [ "${PLACE:-1}" = 1 ]; then
  node ev.mjs "$(node -e 'import("./l1-lib.mjs").then(m=>console.log(m.command("akari.caption.placeText",{start:3,end:6,text:"置いた文字"})))')" > /dev/null
  for i in $(seq 1 40); do grep -q '"output"' "$W/$WS/captions.json" && break; sleep 0.5; done
  sleep 2
  (cd "$W/$WS" && git add -A && git commit -qm "fixture: placed text")
fi
echo "pid=$(cat "$W/pid-$WS")"
