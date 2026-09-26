// (b) 6 秒で、タイムラインから今の再生位置に無い素材を選ぶ → 枠が出るか・再生位置 → その後プレビューで 6 秒の写真 B をクリック
// 使い方: node scenario-b.mjs <project> <itemId> <outDir> <label> [modifiers] [startSeek]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clearLog, clickOutput, clickTimelineItem, hostCdp, installProbe, seek, shotStage, sleep, snapshot, viewCdp, Z } from './pss.mjs';

const [project, itemId, outDir, label, modifiers = '0', startSeek = '6'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const host = await hostCdp();
const view = await viewCdp();
const probe = await installProbe(view);
const steps = [];
const snap = async name => { const s = await snapshot(host, view, name); s.outputTimeDom = await view.eval(`(() => { const v = document.querySelector('#seek'); return v ? Number(v.value) : null; })()`); steps.push(s); return s; };
await seek(host, project, Number(startSeek));
await clickOutput(host, view, 1260, 700); // 出力の右下の余白（何も無い所）で選択を外す
await sleep(500);
await clearLog(view);
await snap('start');
await clickTimelineItem(host, itemId, Number(modifiers));
await sleep(1500);
const afterSelect = await snap('after-timeline-select');
await shotStage(host, view, path.join(outDir, `${label}-1-timeline-select.png`));
await clearLog(view);
await clickOutput(host, view, 220, 420); // 6 秒の写真 B
await sleep(900);
const afterClick = await snap('after-preview-click-photo-b');
await shotStage(host, view, path.join(outDir, `${label}-2-preview-click.png`));
await writeFile(path.join(outDir, `${label}.json`), `${JSON.stringify({ label, itemId, modifiers, probe, steps, z: await view.eval(Z) }, null, 1)}\n`);
const brief = s => ({ closure: s.closure, time: s.outputTimeDom, ix: s.ix?.selectedId, dom: [s.dom.captionSelectBox?.active, s.dom.layerSelectBox?.active, s.dom.cutSelectBox?.active, s.dom.overlaySelected, s.dom.selectionFrames], tl: s.timeline.selected, out: s.log.filter(l => l.kind.startsWith('out') || /select/i.test(l.kind)).map(l => l.kind + JSON.stringify(l.detail).slice(0, 100)) });
console.log(JSON.stringify({ label, afterSelect: brief(afterSelect), afterClick: brief(afterClick) }));
host.close(); view.cdp.close(); process.exit(0);
