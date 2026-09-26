// 差し戻し 1: 0.5 秒で 写真 A / 図形 A / 字幕 A を選んだ状態から、見えていない写真 B / 図形 B / HTML B の矩形上をクリック → 見えている下の素材（本編）が選ばれるか
// ミニバー（ホストの選択 UI）に重なる点は「UI に当たった」として区別して記録する
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { clearLog, clickOutput, hostCdp, installProbe, seek, sleep, snapshot, stageHost, viewCdp, shotStage } from './pss.mjs';
const [project, outDir] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
const hostUiAt = async (x, y) => { const geo = await stageHost(host, view); const px = geo.x + x / 1280 * geo.w, py = geo.y + y / 720 * geo.h; return evalOn(host, `(()=>{const e=document.elementFromPoint(${px},${py});const bar=e&&e.closest('[data-akari-ui="preview-context-layer"]');return bar?(e.closest('button')?.getAttribute('aria-label')||e.className||'bar'):null})()`); };
const hidden = await view.eval(`(()=>{const s=document.getElementById('preview-stage').getBoundingClientRect();const o=r=>[(r.left-s.left)/s.width*1280,(r.top-s.top)/s.height*720,(r.right-s.left)/s.width*1280,(r.bottom-s.top)/s.height*720].map(Math.round);
  const out={}; for(const e of document.querySelectorAll('[data-overlay-id]')){const r=(e.firstElementChild||e).getBoundingClientRect(); out[e.getAttribute('data-overlay-id')]={rect:o(e.getBoundingClientRect()), vis:getComputedStyle(e).visibility}} return out})()`);
console.log('overlay rects', JSON.stringify(hidden));
const results = [];
const PRE = { photo: [220, 160], shape: [520, 240] };
const preCaption = async () => view.eval(`(()=>{const s=document.getElementById('preview-stage').getBoundingClientRect();const p=[...document.querySelectorAll('.caption-row-plate')].find(p=>/字幕/.test(p.textContent)&&!/置いた/.test(p.textContent)&&getComputedStyle(p).visibility!=='hidden');const r=(p.querySelector('.akari-caption__line')||p).getBoundingClientRect();return [(r.left+r.width/2-s.left)/s.width*1280,(r.top+r.height/2-s.top)/s.height*720]})()`);
await seek(host, project, 0.5); await sleep(1500);
const points = [[450, 420], [220, 420], [120, 480], [120, 360], [330, 360], [1000, 420], [1100, 300]];
for (const pre of ['photo', 'shape', 'caption']) {
  for (const [x, y] of points) {
    const at = pre === 'caption' ? await preCaption() : PRE[pre];
    await clickOutput(host, view, at[0], at[1]); await sleep(1000);
    const b = await snapshot(host, view, 'pre');
    const ui = await hostUiAt(x, y);
    await clearLog(view); await clickOutput(host, view, x, y); await sleep(1200);
    const s = await snapshot(host, view, 'after');
    const r = { pre, preSel: b.timeline.selected, point: [x, y], hostUiAtPoint: ui, selected: s.timeline.selected, closure: { cap: s.closure?.selectedCaptionId, layer: s.closure?.selectedLayerId, cut: s.closure?.cutSelected, ov: s.closure?.requestedOverlayId }, reports: s.log.filter(l => l.kind.startsWith('out:')).map(l => l.kind.slice(4) + JSON.stringify(l.detail)) };
    results.push(r); console.log(JSON.stringify(r));
  }
}
if (outDir) { await mkdir(outDir, { recursive: true }); await writeFile(path.join(outDir, 'hit-hidden.json'), JSON.stringify({ overlayRects: hidden, results }, null, 1) + '\n'); }
process.exit(0);
