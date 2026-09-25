#!/bin/bash
# 起動〜ライブラリの画像カテゴリを開いてプレイヘッドを置くまで（P-1 の写し・ポート 9566）。使い方: bash setup.sh <repo> <work> <ws名> <seek秒>
set -uo pipefail
REPO=$1; W=$2; WS=$3; SEEK=$4; HERE=$(cd "$(dirname "$0")" && pwd)
export CDP_PORT=${CDP_PORT:-9566} AKARI_CDP_TIMEOUT_MS=${AKARI_CDP_TIMEOUT_MS:-60000}
rm -rf "$W/$WS" && cp -R "$W/fixture/spoken" "$W/$WS" && (cd "$W/$WS" && node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("edit.json","utf8"));j.tracks.push({id:"a1",lane:"audio",name:"A1",items:[]});fs.writeFileSync("edit.json",JSON.stringify(j,null,2)+"\n")' && git commit -qam "fixture: A1")
(cd "$REPO" && node "$HERE/launch.mjs" "$REPO" "$W/$WS" "$W/iso-$WS" --port=$CDP_PORT) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pid))' > "$W/pid-$WS"
cd "$HERE"
node open.mjs "$W/$WS" 1 && node click.mjs --text 開くだけ > /dev/null
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
sleep 2; node click.mjs --text ライブラリ > /dev/null; sleep 4; node opencat.mjs image > /dev/null
node seek.mjs "$W/$WS" "$SEEK"
echo "pid=$(cat "$W/pid-$WS")"
