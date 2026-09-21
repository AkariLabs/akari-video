// Real drag of a Library transition card (by its screen centre) onto a cut boundary; records edit.json diff.
// Usage: node transdrag.mjs <cardX> <cardY> <dropX> <dropY> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
const [cx, cy, dx, dy, outFile] = process.argv.slice(2).map((v, i) => i < 4 ? Number(v) : v);
const EDIT = process.env.EDIT_JSON || '/tmp/swap-l1/ws/edit.json';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const events = []; cdp.ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method) events.push(m); });
const before = readFileSync(EDIT, 'utf8');
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + k * 6, y: cy + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(300);
const di = events.find(e => e.method === 'Input.dragIntercepted');
const rec = { card: { x: cx, y: cy }, drop: { x: dx, y: dy }, dragIntercepted: !!di };
if (di) {
  const data = di.params.data;
  rec.payload = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data))[0];
  for (const type of ['dragEnter', 'dragOver', 'dragOver']) { await cdp.send('Input.dispatchDragEvent', { type, x: dx, y: dy, data }); await sleep(120); }
  rec.hover = await evalMain(cdp, `[...document.querySelectorAll('[data-akari-transition-boundary], [data-akari-transition-drop-target], [class*=transition-drop]')].map(e => { const r = e.getBoundingClientRect(); return { cls: e.className, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), attrs: [...e.attributes].map(a => a.name + '=' + a.value).join(' ').slice(0, 200) }; })`);
  if (process.env.SHOT) await screenshot(cdp, process.env.SHOT);
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: dx, y: dy, data });
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dx, y: dy, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
let after = before; for (let i = 0; i < 20; i++) { await sleep(500); after = readFileSync(EDIT, 'utf8'); if (after !== before) break; }
await sleep(800); after = JSON.parse(readFileSync(EDIT, 'utf8'));
rec.editChanged = JSON.stringify(after) !== JSON.stringify(JSON.parse(before));
rec.cutsAfter = after.tracks.find(t => t.items.some(i => i.id === 'cut-2'))?.items;
rec.transitionsAfter = after.transitions ?? null;
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
