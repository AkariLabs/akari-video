#!/bin/bash
# AFTER (d) symlink 経由 + (e) 見本の札 + 回帰（タイムラインへのドロップ・トランジション・LUT・クリック）。使い方: bash after-d.sh <repo> <work>
set -uo pipefail
REPO=$1; W=$2; HERE=$(cd "$(dirname "$0")" && pwd); A="$HERE/../after"; cd "$HERE"
SYM=${W#/private}  # macOS の /tmp は /private/tmp への symlink（<work> は /private/tmp の下に置く）
bash setup.sh "$REPO" "$W" ws-d 3 "$SYM/ws-d" | tail -1; P=$SYM/ws-d
node uris.mjs $A/d0-symlink-uris.json > /dev/null
node drag.mjs $P material:assets/photo-orange.png stage:0.7,0.7 $A/d4-symlink-material.json --mode=mouse --hold=$A/e0-material-hold-over-project.png >/dev/null
node click.mjs --text ライブラリ >/dev/null; sleep 2
node drag.mjs $P "css:[data-akari-library-primary-tile=text]" stage:0.3,0.3 $A/d1-symlink-text.json --mode=mouse --shot=$A/d1-symlink-text-drag.png >/dev/null
node opencat.mjs image >/dev/null; node drag.mjs $P asset:still/bg-aurora-mesh stage:0.75,0.25 $A/d2-symlink-photo.json --mode=mouse --hold=$A/e4-photo-hold-over-library.png >/dev/null
node opencat.mjs shapes >/dev/null; node drag.mjs $P shape:star-5 stage:0.3,0.7 $A/d3-symlink-shape.json --mode=mouse >/dev/null
node click.mjs --text "← ライブラリ" >/dev/null; sleep 1
N0=$(node -e "console.log(require('$W/ws-d/captions.json').captions.length)")
XY=$(node ev.mjs "(()=>{const e=document.querySelector('[data-akari-library-primary-tile=text]');const r=e.getBoundingClientRect();return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2)})()" | tr -d '"')
node click.mjs ${XY%,*} ${XY#*,} >/dev/null; sleep 4
N1=$(node -e "console.log(require('$W/ws-d/captions.json').captions.length)")
echo "T タイルを押す（symlink の editUri で開いたセッション）: ws-d/captions.json の行数 ${N0} -> ${N1}。プレビューへ落とした c-0005 も同じ ws-d/captions.json に入っている" > $A/d5-symlink-click-same-project.txt
node opencat.mjs image >/dev/null
TL=$(node ev.mjs "(()=>{const t=[...document.querySelectorAll('.akari-annotations-strip-caption')].find(e=>e.dataset.akariItemId==='c-0004');const b=document.querySelector('[data-akari-paste-target=v-main]')?.closest('*');const r=t.getBoundingClientRect();const rows=[...document.querySelectorAll('[data-akari-paste-target=v-main]')].map(e=>e.getBoundingClientRect());return Math.round(r.x-70)+','+Math.round((rows[0]?.y??r.y+40)+10)})()" | tr -d '"')
node drag.mjs $P asset:still/bg-blue-nebula-pillars host:$TL $A/g1-timeline-drop-photo.json --mode=mouse --shot=$A/e2-sample-over-timeline.png >/dev/null
node click.mjs --text "← ライブラリ" >/dev/null; sleep 1
node ev.mjs "(()=>{const t=document.querySelector('[data-akari-library-details-toggle]');if(t&&/▸/.test(t.textContent))t.click();return 1})()" >/dev/null; sleep 1
node ev.mjs "(()=>{document.querySelector('[data-akari-library-category=transition]').click();return 1})()" >/dev/null; sleep 3
node drag.mjs $P "css:[data-akari-library-transition=dissolve]" stage:0.5,0.5 $A/g2-transition-on-preview.json --mode=mouse --shot=$A/g2-transition-drag.png >/dev/null
node click.mjs --text "← ライブラリ" >/dev/null; sleep 1
node ev.mjs "(()=>{const t=document.querySelector('[data-akari-library-details-toggle]');if(t&&/▸/.test(t.textContent))t.click();return 1})()" >/dev/null; sleep 1
node ev.mjs "(()=>{document.querySelector('[data-akari-library-category=lut]').click();return 1})()" >/dev/null; sleep 3
node drag.mjs $P "css:[data-akari-catalog-preset-item='lut/cinematic']" stage:0.1,0.1 $A/g3-lut-on-base-cut.json --mode=mouse --shot=$A/g3-lut-drag.png >/dev/null
node sum.mjs $A/d4-symlink-material.json $A/d1-symlink-text.json $A/d2-symlink-photo.json $A/d3-symlink-shape.json $A/g1-timeline-drop-photo.json $A/g2-transition-on-preview.json $A/g3-lut-on-base-cut.json > $A/summary-dg.jsonl
git -C $W/ws-d diff edit.json > $A/g3-lut-edit-diff.txt
bash stop.sh "$W" ws-d
