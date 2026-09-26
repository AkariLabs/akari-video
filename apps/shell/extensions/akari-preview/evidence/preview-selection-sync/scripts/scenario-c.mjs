// (c) V7 の図形（上の V8 の B ロールに隠れている）をタイムラインで選び、プレビューで動かす。
// ドラッグ前・中・後の [data-overlay-id] と canvas[data-akari-media-plane] の z、出力の枠のスクリーンショット。
// 使い方: node scenario-c.mjs <project> <outDir> <label> [seekSec] [grabX,grabY]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clickOutput, clickTimelineItem, hostCdp, installProbe, seek, shotStage, sleep, snapshot, stageHost, toHost, viewCdp, Z } from './pss.mjs';

const [project, outDir, label, seekSec = '3', grab = '640,360'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const host = await hostCdp();
const view = await viewCdp();
await installProbe(view);
const record = [];
const rec = async name => {
    const z = await view.eval(Z);
    const s = await snapshot(host, view, name);
    const file = await shotStage(host, view, path.join(outDir, `${label}-${record.length}-${name}.png`));
    record.push({ name, z, closure: s.closure, ix: s.ix, tl: s.timeline.selected, shot: path.basename(file) });
    return z;
};
await seek(host, project, Number(seekSec));
await clickOutput(host, view, 1270, 710);
await sleep(600);
await rec('initial');
await clickTimelineItem(host, 'shape-z');
await sleep(1500);
await rec('timeline-selected');
const geo = await stageHost(host, view);
const [gx, gy] = grab.split(',').map(Number);
const a = toHost(geo, gx, gy), b = toHost(geo, gx + 160, gy + 90);
await host.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, button: 'none' });
await sleep(80);
await host.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
for (let s = 1; s <= 10; s++) {
    await host.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * s / 20, y: a.y + (b.y - a.y) * s / 20, button: 'left', buttons: 1 });
    await sleep(30);
}
await sleep(300);
await rec('mid-drag');
for (let s = 11; s <= 20; s++) {
    await host.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * s / 20, y: a.y + (b.y - a.y) * s / 20, button: 'left', buttons: 1 });
    await sleep(30);
}
await host.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0 });
await sleep(400);
await rec('just-released');
await sleep(2500);
await rec('after-write');
await clickOutput(host, view, 1270, 710);
await sleep(1200);
await rec('after-deselect');
await writeFile(path.join(outDir, `${label}.json`), `${JSON.stringify({ label, seekSec, grab, record }, null, 1)}\n`);
for (const r of record) console.log(r.name.padEnd(18), 'overlays', JSON.stringify(r.z.overlays.map(o => [o.id, o.z, o.vis])), 'planes', JSON.stringify(r.z.planes.map(p => [p.plane, p.z, p.display])), 'layers', JSON.stringify(r.z.layers.map(l => [l.id, l.z])), 'sel', r.ix?.selectedId, JSON.stringify(r.tl));
host.close(); view.cdp.close(); process.exit(0);
