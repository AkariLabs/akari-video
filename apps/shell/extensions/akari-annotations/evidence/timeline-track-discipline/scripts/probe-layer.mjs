// 修正前ビルドで layer 経路のクリップを最上段より上へ運び、オーナー報告の文言が出るかを実測する。
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, keyPress, resizeViewport } from '/Users/ryoma/_edit/30_products/akari-video-wt/timeline-track-discipline/apps/shell/extensions/akari-annotations/evidence/timeline-track-discipline/scripts/cdp-lib.mjs';
const [, , port, ws, ev, label] = process.argv;
const out = { label, steps: [] };
const rec = (s, d) => { out.steps.push({ step: s, ...d }); console.log(`[${s}]`, JSON.stringify(d)); };
const t = (await listTargets(Number(port))).find(x => x.type === 'page');
const cdp = new CDP(t.webSocketDebuggerUrl); await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
rec('viewport', await resizeViewport(cdp, 1440, 1250)); await sleep(1200);
let found = await evalOn(cdp, `!!document.getElementById('akari-annotations-widget')`);
for (let a = 0; a < 6 && !found; a++) {
  await keyPress(cdp, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 }); await sleep(900);
  await cdp.send('Input.insertText', { text: 'タイムラインを開く' }); await sleep(900);
  await keyPress(cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  for (let w = 0; w < 12 && !found; w++) { await sleep(600); found = await evalOn(cdp, `!!document.getElementById('akari-annotations-widget')`); }
}
rec('opened', { found });
await sleep(800);
const bands = await evalOn(cdp, `(() => { const strip = document.getElementById('akari-annotations-widget').children[1].children[1].children[1].children[0];
  return Array.from(strip.querySelectorAll('.akari-track-band')).map(b => { const r = b.getBoundingClientRect();
    return { id: b.dataset.akariLane, kind: b.dataset.akariKind, top: r.top, bottom: r.bottom }; }); })()`);
const layers = await evalOn(cdp, `Array.from(document.querySelectorAll('.akari-annotations-strip-layer')).map(el => { const r = el.getBoundingClientRect();
  return { id: el.dataset.akariItemId, lane: el.dataset.akariLane, left: r.left, top: r.top, width: r.width, height: r.height }; })`);
rec('baseline', { bands, layers });
const L1 = layers.find(e => e.id === 'L1') || layers[0];
const top = [...bands].sort((a, b) => a.top - b.top)[0];
const v2 = bands.find(b => b.id === 'v2');
const gx = L1.left + L1.width / 2, gy = L1.top + L1.height / 2;
const probe = async () => ({
  indicator: await evalOn(cdp, `(() => { const w = document.getElementById('akari-annotations-widget');
    const el = document.querySelector('[data-testid="akari-track-insert-indicator"]') || w.children[1].children[1].children[2].children[3];
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { visible: cs.display !== 'none', top: r.top }; })()`),
  feedback: await evalOn(cdp, `document.getElementById('akari-annotations-widget').children[1].children[1].children[2].children[2].textContent`),
  ghost: await evalOn(cdp, `(() => { const g = document.querySelector('.akari-annotations-strip-clip[style*="dashed"], .akari-annotations-strip-layer[style*="dashed"]');
    return g ? { found: true, rejected: g.classList.contains('akari-annotations-ghost-rejected') } : { found: false }; })()`)
});
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx, y: gy, button: 'none' }); await sleep(40);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gx, y: gy, button: 'left', buttons: 1, clickCount: 1 }); await sleep(40);
const mv = async (y) => { for (let s = 0; s < 6; s++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx, y, button: 'left', buttons: 1 }); await sleep(12); } await sleep(80); };
await mv(v2.top + 3); rec('layer-over-v2-top-edge', { y: v2.top + 3, ...(await probe()) });
const far = Math.max(8, top.top - 120);
await mv(far); rec('layer-far-above', { y: far, topBand: top.id, distancePx: top.top - far, ...(await probe()) });
await screenshot(cdp, path.join(ev, `${label}-layer-far-above.png`));
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gx, y: far, button: 'left' }); await sleep(800);
const edit = JSON.parse(await readFile(path.join(ws, 'edit.json'), 'utf8'));
rec('result', { tracks: edit.tracks.map(t2 => ({ id: t2.id, items: Array.isArray(t2.items) ? t2.items.map(i => i.id) : null })) });
await writeFile(path.join(ev, `probe-${label}.json`), JSON.stringify(out, null, 2));
cdp.close(); console.log('LAYER PROBE DONE');
