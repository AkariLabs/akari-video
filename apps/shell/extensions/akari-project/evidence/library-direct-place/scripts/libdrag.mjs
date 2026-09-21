// Real drag from a Library catalog card (Input.setInterceptDrags captures the genuine DragData)
// onto a timeline point. Records the ghost/footer during dragOver, then drops and waits for
// edit.json to change (the drop resolves/imports the asset first). Usage:
//   node libdrag.mjs <catalogKey> <dropX> <dropY> <out.json> [noDrop]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, screenshot } from '../../materials-tab-hardening/cdp-lib.mjs';
const [key, dx, dy, outFile, mode] = process.argv.slice(2);
const WS = '/tmp/ldp-l1/ws';
const EDIT = `${WS}/edit.json`;
const cdp = await connectMain(Number(process.env.CDP_PORT || 9388));
const events = [];
cdp.ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method) events.push(m); });
const ev = expr => evalMain(cdp, expr, 30000);
const items = j => j.tracks.flatMap(t => t.items.map(i => ({ track: t.id, lane: t.lane, ...i })));
const probe = `(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const ghosts = [...document.querySelectorAll('div')].filter(e => /249, 115, 22|241, 76, 76/.test(e.style.outline || '') && vis(e))
    .map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), rejected: e.classList.contains('akari-annotations-ghost-rejected'), insertion: e.dataset.akariInsertionPreview ?? null }; });
  const footer = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /置けません|追加しました|ロック|直接置け|取得|入れました|トラック/.test(e.textContent) && vis(e)).map(e => e.textContent.trim()).slice(-3);
  return { ghosts, footer };
})()`;
const toasts = () => ev(`[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')].map(e=>e.textContent.trim()).filter(Boolean).slice(-4)`);
const before = JSON.parse(readFileSync(EDIT, 'utf8'));
const rec = { key, drop: { x: +dx, y: +dy }, at: new Date().toISOString() };
const card = await ev(`(() => { const el=document.querySelector('[data-akari-catalog-item=${JSON.stringify(key)}]'); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+30,draggable:el.getAttribute('draggable'),state:el.getAttribute('data-akari-catalog-item-state')}; })()`);
if (!card) { console.log('card not found'); process.exit(1); }
rec.card = card;
const catId = key.split('/').slice(1).join('/');
rec.assetDirBefore = existsSync(`${WS}/assets/${key.split('/')[0]}/${catId}`);
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(300);
const di = events.find(e => e.method === 'Input.dragIntercepted');
rec.dragIntercepted = !!di;
if (di) {
  const data = di.params.data;
  rec.mimeTypes = data.items.map(i => i.mimeType);
  rec.payload = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data))[0];
  for (const type of ['dragEnter', 'dragOver', 'dragOver', 'dragOver']) { await send(type); await sleep(120); }
  rec.duringDrag = await ev(probe);
  if (process.env.SHOT) await screenshot(cdp, process.env.SHOT);
  if (mode !== 'noDrop') await send('drop');
  else await send('dragCancel');
  async function send(type) { await cdp.send('Input.dispatchDragEvent', { type, x: +dx, y: +dy, data }); }
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: +dx, y: +dy, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
const t0 = Date.now();
let after = before;
for (let i = 0; i < (mode === 'noDrop' ? 2 : Number(process.env.WAIT_TICKS || 60)); i++) { await sleep(500); after = JSON.parse(readFileSync(EDIT, 'utf8')); if (JSON.stringify(after) !== JSON.stringify(before)) break; }
rec.waitMs = Date.now() - t0;
await sleep(800);
after = JSON.parse(readFileSync(EDIT, 'utf8'));
const bIds = new Set(items(before).map(i => i.track + '/' + i.id));
rec.editChanged = JSON.stringify(after) !== JSON.stringify(before);
rec.itemsBefore = items(before).length; rec.itemsAfter = items(after).length;
rec.tracksBefore = before.tracks.map(t => `${t.id}:${t.lane}`); rec.tracksAfter = after.tracks.map(t => `${t.id}:${t.lane}`);
rec.newItems = items(after).filter(i => !bIds.has(i.track + '/' + i.id));
rec.newSources = (after.sources || []).filter(s => !(before.sources || []).some(b => b.id === s.id));
rec.sfxBefore = (before.audio?.sfx || []).length; rec.sfxAfter = (after.audio?.sfx || []).length;
const dir = `${WS}/assets/${key.split('/')[0]}/${catId}`;
rec.assetDirAfter = existsSync(dir) ? readdirSync(dir) : null;
rec.afterDrop = await ev(probe);
rec.toasts = await toasts();
writeFileSync(outFile, JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec));
process.exit(0);
