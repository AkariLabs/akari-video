#!/bin/bash
# AFTER の実機手順（setup.sh の後に実行。setup.sh の作業場所は実パスで渡す: macOS の /tmp は /private/tmp へのリンクで、
# 起動したプロジェクトのパスと editUri の文字列が食い違うとプレビューからの配置が「プロジェクトを特定できません。」になる）。
# 使い方: bash after.sh <project> <out-dir>
set -uo pipefail
P=$1; A=$2; export CDP_PORT=${CDP_PORT:-9566}
cd "$(dirname "$0")"; mkdir -p "$A"
STAR='css:[data-akari-shape-tile="star-5"]'; LINE='css:[data-akari-shape-tile="line-solid-none-none"]'
node click.mjs --text 後で >/dev/null 2>&1; node opencat.mjs shapes >/dev/null
echo "== f1 星を 0:03 のプレビューの右上へ"; node seek.mjs "$P" 3 >/dev/null; sleep 2
node pvdrag.mjs "$P" "$STAR" stage:0.75,0.25 "$A/f1-drop-star-at-3s.json" --shot="$A/f1-drag-star.png" >/dev/null; node sumshape.cjs "$A/f1-drop-star-at-3s.json"
node ev.mjs "[...document.querySelectorAll('[data-akari-item-id=\"shape-1\"]')].map(n=>String(n.className))"
node key.mjs Escape; node seek.mjs "$P" 3.5 >/dev/null; node stageshot.mjs "$P" "$A/f1-stage-3.5s.png" >/dev/null
node bbox.mjs "$A/f1-stage-3.5s.png" 1280 720 --region=700,20,1260,340 | tee "$A/f1-measure-3.5s.json"
echo "== f2 undo"; node undo.mjs "$P" "$A/f2-undo-star.json" | cut -c1-220; sleep 3
echo "== f3 ライン 0:04"; node seek.mjs "$P" 4 >/dev/null; sleep 2
node pvdrag.mjs "$P" "$LINE" stage:0.3,0.7 "$A/f3-drop-line-at-4s.json" --shot="$A/f3-drag-line.png" >/dev/null; node sumshape.cjs "$A/f3-drop-line-at-4s.json"
node undo.mjs "$P" "$A/f3-undo-line.json" | cut -c1-220; sleep 3
echo "== f4 キャンバスの区間 0:12"; node seek.mjs "$P" 12 >/dev/null; sleep 2
node pvdrag.mjs "$P" "$STAR" stage:0.75,0.25 "$A/f4-drop-star-at-12s-canvas.json" --shot="$A/f4-drag-star-at-12s.png" >/dev/null; node sumshape.cjs "$A/f4-drop-star-at-12s-canvas.json"
node stageshot.mjs "$P" "$A/f4-stage-12s-selected.png" >/dev/null; node shot.mjs "$A/f4-window-12s.png" >/dev/null
node undo.mjs "$P" "$A/f4-undo-canvas.json" | cut -c1-220; sleep 3
echo "== f5 ⌥ で外へ 0:12"; node key.mjs Escape; node seek.mjs "$P" 12 >/dev/null; sleep 2
node pvdrag.mjs "$P" "$STAR" stage:0.75,0.25 "$A/f5-drop-star-at-12s-alt.json" --alt --shot="$A/f5-drag-star-at-12s-alt.png" >/dev/null; node sumshape.cjs "$A/f5-drop-star-at-12s-alt.json"
node undo.mjs "$P" "$A/f5-undo-alt.json" | cut -c1-220; sleep 3
echo "== f6 書き出しとの比較（0:03 外 + 0:12 キャンバスの中）"
node seek.mjs "$P" 3 >/dev/null; sleep 2; node pvdrag.mjs "$P" "$STAR" stage:0.75,0.25 "$A/f6-drop-star-at-3s.json" >/dev/null
node key.mjs Escape; node seek.mjs "$P" 12 >/dev/null; sleep 2; node pvdrag.mjs "$P" "$STAR" stage:0.25,0.6 "$A/f6-drop-star-at-12s-canvas.json" >/dev/null
# 選択の枠を外す（出力の枠の左の空所を 1 回押す = 本編のカットが選ばれ、枠は画面の縁に移る）
node -e 'import("./common.mjs").then(async ({connect,sleep})=>{const {realClick}=await import("./cdp-lib.mjs");const c=await connect();await realClick(c,470,200);await sleep(600);c.close();process.exit(0)})'
node seek.mjs "$P" 3.5 >/dev/null; node stageshot.mjs "$P" "$A/f6-preview-3.5s.png" >/dev/null
node seek.mjs "$P" 12.5 >/dev/null; node stageshot.mjs "$P" "$A/f6-preview-12.5s.png" >/dev/null
mkdir -p "$P/exports"; node ../../../../../../../packages/render-cut/bin/render-cut.mjs "$P" --engine osr --out "$P/exports/export.mp4" --force | grep -v PROGRESS | tail -2
for t in 3.5 12.5; do ffmpeg -hide_banner -loglevel error -y -ss $t -i "$P/exports/export.mp4" -frames:v 1 "$A/f6-osr-frame-${t}s.png"; done
node bbox.mjs "$A/f6-osr-frame-3.5s.png" 1280 720 --region=700,20,1260,340; node bbox.mjs "$A/f6-osr-frame-12.5s.png" 1280 720 --region=40,280,600,580
