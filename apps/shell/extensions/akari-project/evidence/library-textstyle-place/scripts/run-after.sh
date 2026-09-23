#!/bin/bash
# 本票の AFTER（L1）一式。使い方: bash run-after.sh <repo> <作業用ディレクトリ（実体パス。macOS の /tmp はシンボリックリンクなので realpath を渡す）>
# fixture = gen-fixture.mjs の spoken（話した言葉 4 行・12 秒）+ 空の A1。CDP ポートは CDP_PORT（既定 9465）。
set -euo pipefail
REPO=$1; WORK=$2; HERE=$(cd "$(dirname "$0")" && pwd); OUT=$(dirname "$HERE"); PJ=$WORK/ws
cd "$HERE"
rm -rf "$WORK/ws" "$WORK/fixture"; mkdir -p "$WORK"
node gen-fixture.mjs "$WORK/fixture" > /dev/null && cp -R "$WORK/fixture/spoken" "$PJ"
(cd "$PJ" && node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("edit.json","utf8"));j.tracks.push({id:"a1",lane:"audio",name:"A1",items:[]});fs.writeFileSync("edit.json",JSON.stringify(j,null,2)+"\n")' && git commit -qam "fixture: A1")
shrink() { sips -Z 1120 "$1" --out "$OUT/$2" > /dev/null; rm -f "$1"; }
T=$WORK/shots; mkdir -p "$T"
(cd "$REPO" && node "$HERE/launch.mjs" "$REPO" "$PJ" "$WORK/iso" > "$WORK/launch.json")   # cwd = リポ直下（プリセットの索引の探索が cwd 基準）
node open.mjs "$PJ" 1
node ev.mjs "(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()" > /dev/null
sleep 2; node click.mjs --text ライブラリ > /dev/null; sleep 3
SPLIT=$(node ev.mjs "(()=>{const h=[...document.querySelectorAll('.lm-SplitPanel-handle')].find(h=>h.parentElement.dataset.orientation==='vertical'&&h.getBoundingClientRect().width>300);const r=h.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]})()" | tr -d '[] \n')
node mdrag.mjs ${SPLIT%,*} ${SPLIT#*,} ${SPLIT%,*} 250; sleep 2      # タイムラインを縦に広げる（行が縦スクロールで隠れないように）
node opencat.mjs textstyle > /dev/null
# 1. カードの状態（grid / list）
node cards.mjs "$OUT/after-cards-grid.json" > /dev/null; node shot.mjs "$T/cards.png"; shrink "$T/cards.png" after-cards-grid.png
TOG=$(node ev.mjs "(()=>{const b=[...document.querySelectorAll('[data-akari-catalog-view-toggle]')].find(b=>b.getBoundingClientRect().width>0);const r=b.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]})()" | tr -d '[] \n')
node click.mjs ${TOG%,*} ${TOG#*,} > /dev/null; sleep 1.5
node cards.mjs "$OUT/after-cards-list.json" > /dev/null
node tlscroll.mjs 0 > /dev/null; node tsdrag.mjs "$PJ" narration-caption 't=2@Base' "$OUT/after-list-drag-2s.json" > /dev/null
node undo.mjs "$PJ" "$OUT/after-list-drag-2s-undo.json" > /dev/null
node click.mjs ${TOG%,*} ${TOG#*,} > /dev/null; sleep 1.5
# 2. タイムラインの 10 秒へドラッグ → Cmd+Z
node tlscroll.mjs 0 > /dev/null; sleep 1
node tsdrag.mjs "$PJ" subtitle-news 't=10@Base' "$OUT/after-drag-10s.json" --startshot="$T/s.png" --shot="$T/h.png" > /dev/null
shrink "$T/s.png" after-drag-start-band.png; shrink "$T/h.png" after-drag-hover-10s.png
sleep 2; node shot.mjs "$T/a.png"; shrink "$T/a.png" after-drop-10s.png
node plates.mjs "$OUT/after-drop-10s-preview.json" > /dev/null
node undo.mjs "$PJ" "$OUT/after-drop-10s-undo.json" > /dev/null
# 3. ＋（プレイヘッド 5 秒）→ Cmd+Z
node tsplus.mjs "$PJ" emphasis-red "$OUT/after-plus-5s.json" --seek=5 > /dev/null
sleep 1.5; node shot.mjs "$T/p.png"; shrink "$T/p.png" after-plus-5s.png
node plates.mjs "$OUT/after-plus-5s-preview.json" > /dev/null
node undo.mjs "$PJ" "$OUT/after-plus-5s-undo.json" > /dev/null
# 4. 一覧の最後のカードの ＋（右下の丸い「ライブラリに追加」ボタンに隠れない）→ Cmd+Z
node tsplus.mjs "$PJ" title-impact "$OUT/after-plus-last-card.json" --seek=7 > /dev/null
node shot.mjs "$T/l.png"; shrink "$T/l.png" after-plus-last-card.png
node undo.mjs "$PJ" "$OUT/after-plus-last-card-undo.json" > /dev/null
# 5. 置けない場所（ライブラリ面・プレビュー）
node tlscroll.mjs 0 > /dev/null
node tsdrag.mjs "$PJ" subtitle-news '150,420' "$OUT/after-drop-on-library.json" > /dev/null
PREV=$(node ev.mjs "(()=>{const f=[...document.querySelectorAll('iframe.webview')].find(f=>f.getBoundingClientRect().width>200);const r=f.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/3)]})()" | tr -d '[] \n')
node tsdrag.mjs "$PJ" subtitle-news "$PREV" "$OUT/after-drop-on-preview.json" > /dev/null
# 6. 回帰（BGM / SFX → A1、B-roll → 映像行）
node opencat.mjs bgm > /dev/null; node tlscroll.mjs 0 > /dev/null
node libdrag.mjs "$PJ" audio/bgm-jazzhop-piano-086 't=3@A1' "$OUT/regression-bgm-a1.json" --shot="$T/b.png" > /dev/null; shrink "$T/b.png" regression-bgm-a1.png
node undo.mjs "$PJ" "$OUT/regression-bgm-a1-undo.json" > /dev/null
node opencat.mjs sfx > /dev/null; node tlscroll.mjs 0 > /dev/null
node libdrag.mjs "$PJ" audio/sfx-bell-tree 't=3@A1' "$OUT/regression-sfx-a1.json" > /dev/null
node undo.mjs "$PJ" "$OUT/regression-sfx-a1-undo.json" > /dev/null
node opencat.mjs broll > /dev/null; node tlscroll.mjs 0 > /dev/null
node libdrag.mjs "$PJ" broll/talkinghead-desk-ja-01 't=3@Base+14' "$OUT/regression-broll-video.json" --shot="$T/r.png" > /dev/null; shrink "$T/r.png" regression-broll-video.png
node undo.mjs "$PJ" "$OUT/regression-broll-video-undo.json" > /dev/null
# 7. 「文字」行があるときの受け皿（1 本置いてから別のカードを掴み、取り消す）→ Cmd+Z
node opencat.mjs textstyle > /dev/null; node tlscroll.mjs 0 > /dev/null
node tsplus.mjs "$PJ" subtitle-standard "$OUT/after-row-band-setup.json" --seek=9 > /dev/null
node tlscroll.mjs 0 > /dev/null; sleep 1
node tsdrag.mjs "$PJ" glitch 't=2@Base' "$OUT/after-row-band-cancel.json" --startshot="$T/rb.png" --cancel > /dev/null; shrink "$T/rb.png" after-row-band-start.png
node undo.mjs "$PJ" "$OUT/after-row-band-undo.json" > /dev/null
echo done
