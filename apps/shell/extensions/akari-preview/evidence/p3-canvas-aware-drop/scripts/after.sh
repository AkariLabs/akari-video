#!/bin/bash
# AFTER の実機手順（setup.sh の後に実行）。使い方: bash after.sh <project> <out-dir>
set -uo pipefail
P=$1; A=$2; export CDP_PORT=${CDP_PORT:-9558}
cd "$(dirname "$0")"; mkdir -p "$A"
SUM='const r=require(process.argv[1]);console.log(JSON.stringify({times:r.duringDrag?.times?.filter(t=>/→/.test(t.text)).map(t=>t.text),alt:r.alt,newItems:r.newItems.map(i=>({id:i.id,track:i.track,parent:i.parent,at:i.at,absAt:i.absAt,duration:i.duration,out:i.source?.out,t:i.transform})),newCaptions:r.newCaptions?.map(c=>c.id+" "+c.start+"-"+c.end),tracks:r.tracksAfter.map(t=>t.id)}))'
CUT_AT='(s,row)=>{const w=document.getElementById("akari-annotations-widget");const b=[...w.querySelectorAll("[data-akari-item-kind=cut]")][0].getBoundingClientRect();const ce=row?[...w.querySelectorAll(`[data-akari-item-id="${row}"]`)].find(e=>/strip-overlay/.test(e.className)):null;const c=ce?ce.getBoundingClientRect():b;return Math.round(b.left+s*b.width/30)+","+Math.round(c.top+c.height/2)}'
node click.mjs --text 後で >/dev/null 2>&1
echo "== f1 写真を 0:12 のプレビューへ"
node seek.mjs "$P" 12 >/dev/null; node seek.mjs "$P" 12 >/dev/null; node ptime.mjs; node pvdrag.mjs "$P" asset:still/bg-aurora-mesh stage:0.75,0.25 "$A/f1-drop-photo-at-12s.json" --shot="$A/f1-drag-photo-at-12s.png" >/dev/null; node -e "$SUM" "$A/f1-drop-photo-at-12s.json"
node ev.mjs "(()=>{const t=document.querySelector('[data-akari-tree-toggle=\"g-1\"]');const s=t?.textContent;if(t&&t.textContent==='▸')t.click();return s})()"; sleep 1; node shot.mjs "$A/f1-timeline-canvas-expanded.png"
echo "== f2 undo"; node undo.mjs "$P" "$A/f2-undo-photo.json" | cut -c1-220
echo "== f3 ⌥"
node seek.mjs "$P" 12 >/dev/null; node pvdrag.mjs "$P" asset:still/bg-aurora-mesh stage:0.75,0.25 "$A/f3-drop-photo-alt-at-12s.json" --alt --shot="$A/f3-drag-photo-alt-at-12s.png" >/dev/null; node -e "$SUM" "$A/f3-drop-photo-alt-at-12s.json"
node key.mjs Escape; node seek.mjs "$P" 12.5 >/dev/null; node stageshot.mjs "$P" "$A/f3-stage-12.5s-alt.png" >/dev/null; node bbox.mjs "$A/f3-stage-12.5s-alt.png" 1280 720 --region=700,20,1260,340 | tee "$A/f3-measure-12.5s-alt.json"
node undo.mjs "$P" "$A/f3-undo.json" | cut -c1-220
echo "== f4 区間外 0:05"
node seek.mjs "$P" 5 >/dev/null; node pvdrag.mjs "$P" asset:still/bg-aurora-mesh stage:0.75,0.25 "$A/f4-drop-photo-outside-at-5s.json" --shot="$A/f4-drag-photo-outside-at-5s.png" >/dev/null; node -e "$SUM" "$A/f4-drop-photo-outside-at-5s.json"
node undo.mjs "$P" "$A/f4-undo.json" | cut -c1-220
echo "== f5 T タイル 0:12"
node opencat.mjs nonexistent >/dev/null 2>&1
node seek.mjs "$P" 12 >/dev/null; node pvdrag.mjs "$P" "css:[data-akari-library-primary-tile=text]" stage:0.3,0.3 "$A/f5-drop-text-at-12s.json" --shot="$A/f5-drag-text-at-12s.png" >/dev/null; node -e "$SUM" "$A/f5-drop-text-at-12s.json"
node -e 'console.log("drop outputPx",JSON.stringify(require(process.argv[1]).drop.outputPx))' "$A/f5-drop-text-at-12s.json"
node key.mjs Escape; node seek.mjs "$P" 12.5 >/dev/null; node plates2.mjs 1280 720 | tee "$A/f5-plates-12.5s.json"; node stageshot.mjs "$P" "$A/f5-stage-12.5s-text.png" >/dev/null
node undo.mjs "$P" "$A/f5-undo-text.json" | cut -c1-220
echo "== f6 タイムラインのキャンバス行 0:13"
node opencat.mjs image >/dev/null
node wheel.mjs g-1; node shot.mjs "$A/f6-timeline-before-drop.png"
XY=$(node ev.mjs "($CUT_AT)(13,'g-1')" | tr -d '"'); echo "at $XY"
node pvdrag.mjs "$P" asset:still/bg-aurora-mesh host:$XY "$A/f6-drop-photo-on-canvas-row-13s.json" --shot="$A/f6-drag-photo-on-canvas-row.png" >/dev/null; node -e "$SUM" "$A/f6-drop-photo-on-canvas-row-13s.json"
node undo.mjs "$P" "$A/f6-undo.json" | cut -c1-220
echo "== f7 タイムラインの Base 行 0:13（キャンバスの行ではない）"
XY=$(node ev.mjs "($CUT_AT)(13,null)" | tr -d '"'); echo "at $XY"
node pvdrag.mjs "$P" asset:still/bg-aurora-mesh host:$XY "$A/f7-drop-photo-on-base-row-13s.json" >/dev/null; node -e "$SUM" "$A/f7-drop-photo-on-base-row-13s.json"
node undo.mjs "$P" "$A/f7-undo.json" | cut -c1-220
echo "== f8 もう一度プレビューへ置いてキャンバスを 0:20 へ"
node seek.mjs "$P" 12 >/dev/null; node pvdrag.mjs "$P" asset:still/bg-aurora-mesh stage:0.75,0.25 "$A/f8-drop-photo-at-12s.json" >/dev/null; node -e "$SUM" "$A/f8-drop-photo-at-12s.json"
node movecanvas.mjs "$P" g-1 20 "$A/f8-move-canvas-to-20s.json" | cut -c1-600
sleep 1; node ev.mjs "(()=>{const t=document.querySelector('[data-akari-tree-toggle=\"g-1\"]');if(t&&t.textContent==='▸')t.click();return t?.textContent})()"; sleep 1; node shot.mjs "$A/f8-canvas-moved-to-20s.png"
