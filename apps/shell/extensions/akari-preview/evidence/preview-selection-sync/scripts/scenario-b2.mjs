// (b) の条件別: 範囲内・Shift/Cmd の追加・再生中・矩形選択・undo ではシークしない / 単一の範囲外はシークする
// 使い方: node scenario-b2.mjs <project> <outDir>
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { realDragMod } from './cdp-lib.mjs';
import { clickOutput, clickTimelineItem, dragOutput, hostCdp, installProbe, seek, shotStage, sleep, snapshot, viewCdp } from './pss.mjs';
import { evalOn, realClick } from './cdp-lib.mjs';

const [project, outDir] = process.argv.slice(2);
const host = await hostCdp();
const view = await viewCdp();
await installProbe(view);
const time = async () => view.eval(`Number(document.getElementById('seek').value)`);
const results = [];
const brief = async name => {
    const s = await snapshot(host, view, name);
    const r = { name, time: await time(), tl: s.timeline.selected, cap: s.closure?.selectedCaptionId, ov: s.closure?.requestedOverlayId, layer: s.closure?.selectedLayerId, frames: s.dom.selectionFrames, captionBox: s.dom.captionSelectBox?.active, layerBox: s.dom.layerSelectBox?.active };
    results.push(r); console.log(JSON.stringify(r)); return r;
};
const blank = async () => { await clickOutput(host, view, 1260, 700); await sleep(500); };
const S = JSON.stringify;
const chip = id => evalOn(host, `(()=>{const e=document.querySelector(${S(`[data-akari-item-id=${S(id)}]`)});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);

// 1) 範囲内: 1 秒で shape-a（0〜3 秒）を選ぶ → 1 秒のまま
await seek(host, project, 1); await blank();
await clickTimelineItem(host, 'shape-a'); await sleep(1200);
await brief('1-in-range-shape-a@1');
// 2) 単一の範囲外: 6 秒で photo-a-item → 0 秒へ
await seek(host, project, 6); await blank();
await clickTimelineItem(host, 'photo-a-item'); await sleep(1500);
await brief('2-out-of-range-photo-a@6');
await shotStage(host, view, path.join(outDir, 'b2-2-out-of-range-photo-a.png'));
// 3) 複数選択: 6 秒で shape-b（範囲内）→ Shift で shape-a（範囲外）を足す → 6 秒のまま / Cmd も同じ
for (const [label, mod] of [['shift', 8], ['cmd', 4]]) {
    await seek(host, project, 6); await blank();
    await clickTimelineItem(host, 'shape-b'); await sleep(1000);
    await clickTimelineItem(host, 'shape-a', mod); await sleep(1500);
    await brief(`3-${label}-add-shape-a@6`);
}
// 4) 再生中: 6 秒から再生 → c-0001（範囲外）を選ぶ → 0 秒へ飛ばない
await seek(host, project, 6); await blank();
await view.eval(`(document.getElementById('play-toggle').click(), true)`); await sleep(800);
const before = await time();
await clickTimelineItem(host, 'c-0001'); await sleep(800);
const during = await brief('4-playing-select-c-0001');
during.timeBeforeSelect = before;
await view.eval(`(() => { const v = document.getElementById('play-toggle'); v.click(); return true; })()`); await sleep(800);
await brief('4-paused-after');
// 5) 矩形選択: 6 秒で、写真の段の 4 秒（空き）から 2 秒まで横に引いて photo-a-item だけを囲む → 6 秒のまま
await seek(host, project, 6); await blank();
const pa = await chip('photo-a-item'); const pps = pa.width / 3;
const y = pa.top + pa.height / 2;
await realDragMod(host, [{ x: pa.left + 4 * pps, y }, { x: pa.left + 2 * pps, y: y + 4 }], { steps: 10 }); await sleep(1500);
await brief('5-marquee-photo-a@6');
// 6) undo: 1 秒で shape-a を動かす → 6 秒へ → 元に戻す → 6 秒のまま
await seek(host, project, 1); await blank();
await dragOutput(host, view, [520, 240], [560, 270]); await sleep(1500);
await seek(host, project, 6); await sleep(800);
await brief('6-before-undo@6');
const undo = await evalOn(host, `(()=>{const b=[...document.querySelectorAll('button, [role=button], .akari-annotations-toolbar *')].find(e=>/元に戻す|Undo/i.test(e.getAttribute('title')||e.getAttribute('aria-label')||''));if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,label:b.getAttribute('title')||b.getAttribute('aria-label')}})()`);
if (undo) { await realClick(host, undo.x, undo.y); await sleep(2500); }
const u = await brief('6-after-undo@6'); u.undoButton = undo?.label ?? null;
await writeFile(path.join(outDir, 'b2-conditions.json'), `${JSON.stringify(results, null, 1)}\n`);
host.close(); view.cdp.close(); process.exit(0);
