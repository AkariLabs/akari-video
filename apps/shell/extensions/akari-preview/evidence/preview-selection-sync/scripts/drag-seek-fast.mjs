// 差し戻し 2: 1 秒で素材をドラッグ → 6 秒へシーク。プレビュー / IX / タイムラインの選択を記録（expirePreviewSelections の入力もログポイントで）
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { clearLog, dragOutput, hostCdp, installProbe, seek, sleep, snapshot, viewCdp } from './pss.mjs';
const [project, kind, outDir] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
const FIXED = { shape: [520, 240], photo: [220, 160], html: [1030, 120] };
const centerOf = kind => view.eval(`(() => {
    const stage = document.getElementById('preview-stage').getBoundingClientRect();
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const plates = [...document.querySelectorAll('.caption-row-plate')].filter(vis);
    const hit = plates.find(p => ${JSON.stringify(kind)} === 'placed' ? /置いた文字/.test(p.textContent) : /字幕/.test(p.textContent) && !/置いた/.test(p.textContent));
    if (!hit) return null; const r = (hit.querySelector('.akari-caption__line') || hit).getBoundingClientRect();
    return [(r.left + r.width / 2 - stage.left) / stage.width * 1280, (r.top + r.height / 2 - stage.top) / stage.height * 720];
})()`);
const steps = [];
const snap = async n => { const s = await snapshot(host, view, n); steps.push(s); const o = { t: await view.eval(`Number(document.getElementById('seek').value)`), cap: s.closure?.selectedCaptionId, layer: s.closure?.selectedLayerId, cut: s.closure?.cutSelected, ov: s.closure?.requestedOverlayId, ix: s.ix?.selectedId, tl: s.timeline.selected, reports: s.log.filter(l => l.kind.startsWith('out:')).map(l => l.kind.slice(4) + JSON.stringify(l.detail)) }; console.log(n, JSON.stringify(o)); return o; };
await seek(host, project, 1); await sleep(1200);
const from = FIXED[kind] || await centerOf(kind);
await clearLog(view);
await dragOutput(host, view, from, [from[0] + 40, from[1] + 30]); await sleep(Number(process.env.DRAG_WAIT || 3500));
const moved = await snap('t1-after-drag');
await clearLog(view);
await seek(host, project, 6); await sleep(1500); await snap('t6-a'); await sleep(4000);
const after = await snap('t6-after-seek');
if (outDir) { await mkdir(outDir, { recursive: true }); await writeFile(path.join(outDir, `drag-seek-${kind}.json`), JSON.stringify({ kind, from, summary: { moved, after }, steps }, null, 1) + '\n'); }
host.close(); view.cdp.close(); process.exit(0);
