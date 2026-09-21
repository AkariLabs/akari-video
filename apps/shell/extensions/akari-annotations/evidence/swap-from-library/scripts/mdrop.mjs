// L1 (material-drop-no-overlap): drag a material (project card / library card) with the genuine
// DragData (Input.setInterceptDrags), hover one or more points and record the ghost / insert line /
// footer at each, drop at the last point, record tracks before/after, run edit-lint on the saved
// edit.json, then (UNDO=1) press Cmd+Z once and check edit.json is byte-identical to before.
// Usage: node mdrop.mjs <proj:<materialPath>|lib:<catalogKey>|menu:<materialPath>> "<x,y>[;<x,y>...]" <out.json> [noDrop]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain } from './cdp-lib.mjs';
const [src, pts, outFile, mode] = process.argv.slice(2);
const WS = process.env.WS || '/tmp/swap-l1/ws';
const EDIT = `${WS}/edit.json`;
const LINT = new URL('../../../../../../../packages/edit-lint/bin/edit-lint.mjs', import.meta.url).pathname;
const points = pts.split(';').filter(Boolean).map(p => p.split(',').map(Number));
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const events = [];
cdp.ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method) events.push(m); });
const ev = expr => evalMain(cdp, expr, 30000);
const sha = () => createHash('sha256').update(readFileSync(EDIT)).digest('hex');
const tracks = j => j.tracks.map(t => ({ id: t.id, lane: t.lane, items: t.items.map(i => `${i.id}@${i.at}+${i.duration}`) }));
const probe = `(() => {
  const ind = document.querySelector('[data-testid="akari-track-insert-indicator"]');
  const ov = ind.parentElement;
  const g = [...ov.children].find(e => (e.style.background || '').includes('77, 208, 200'));
  const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  let root = ind; while (root && !root.classList.contains('akari-annotations-widget')) root = root.parentElement;
  return {
    ghost: g && g.style.display !== 'none' ? { ...rect(g), insertionPreview: g.dataset.akariInsertionPreview === 'true', border: g.style.border } : null,
    insertLine: ind.style.display === 'block' ? rect(ind) : null,
    footer: root ? [...root.children].filter(c => c.tagName === 'DIV').pop().textContent.trim() : null
  };
})()`;
const toasts = () => ev(`[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')].map(e=>e.textContent.trim()).filter(Boolean).slice(-4)`);
const beforeText = readFileSync(EDIT, 'utf8');
const before = JSON.parse(beforeText);
const rec = { src, points, at: new Date().toISOString(), shaBefore: sha(), tracksBefore: tracks(before), hovers: [] };
const [kind, ref] = [src.slice(0, src.indexOf(':')), src.slice(src.indexOf(':') + 1)];
const sel = kind === 'lib' ? `[data-akari-catalog-item=${JSON.stringify(ref)}]` : `[data-akari-material-path=${JSON.stringify(ref)}]`;
if (kind === 'menu') {
  rec.menu = await ev(`(async () => { document.querySelectorAll('[data-akari-context-menu]').forEach(p=>p.remove()); const el=document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20,button:2})); await new Promise(r=>setTimeout(r,400)); const b=[...document.querySelectorAll('[data-akari-context-menu] button')]; const add=b.find(x=>x.textContent.trim()==='タイムラインに追加'); if(add) add.click(); return {labels:b.map(x=>x.textContent.trim()), clicked: !!add}; })()`);
} else {
  const card = await ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+Math.min(30,r.height/2),draggable:el.getAttribute('draggable')}; })()`);
  if (!card) { console.log('card not found'); process.exit(1); }
  rec.card = card;
  await cdp.send('Input.setInterceptDrags', { enabled: true });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
  await sleep(300);
  const di = events.find(e => e.method === 'Input.dragIntercepted');
  rec.dragIntercepted = !!di;
  if (!di) { writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log('no drag'); process.exit(1); }
  const data = di.params.data;
  rec.mimeTypes = data.items.map(i => i.mimeType);
  const send = (type, x, y) => cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  await send('dragEnter', ...points[0]);
  for (const [x, y] of points) {
    for (let k = 0; k < 3; k++) { await send('dragOver', x, y); await sleep(120); }
    rec.hovers.push({ x, y, ...(await ev(probe)) });
    if (process.env.SHOT) await (await import('./cdp-lib.mjs')).screenshot(cdp, `${process.env.SHOT}-${rec.hovers.length}.png`);
  }
  const [lx, ly] = points[points.length - 1];
  await send(mode === 'noDrop' ? 'dragCancel' : 'drop', lx, ly);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lx, y: ly, button: 'left', clickCount: 1 });
  await cdp.send('Input.setInterceptDrags', { enabled: false });
}
const t0 = Date.now();
for (let i = 0; i < (mode === 'noDrop' ? 3 : Number(process.env.WAIT_TICKS || 60)); i++) { await sleep(500); if (readFileSync(EDIT, 'utf8') !== beforeText) break; }
rec.waitMs = Date.now() - t0;
await sleep(1500);
const after = JSON.parse(readFileSync(EDIT, 'utf8'));
rec.editChanged = readFileSync(EDIT, 'utf8') !== beforeText;
rec.tracksAfter = tracks(after);
rec.afterDrop = await ev(probe);
rec.toasts = await toasts();
if (process.env.SHOT) await (await import('./cdp-lib.mjs')).screenshot(cdp, `${process.env.SHOT}-after.png`);
let lintOut;
try { lintOut = execFileSync('node', [LINT, WS, '--json'], { encoding: 'utf8' }); } catch (e) { lintOut = e.stdout; }
try { const j = JSON.parse(lintOut); rec.lint = { verdict: j.verdict, overlap: (j.findings || []).filter(f => /overlap/.test(f.check)).map(f => `${f.severity} ${f.check} ${f.message}`) }; } catch { rec.lint = { raw: String(lintOut).slice(0, 400) }; }
if (process.env.UNDO === '1' && rec.editChanged) {
  const [fx, fy] = (process.env.FOCUS || '520,560').split(',').map(Number);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fx, y: fy, button: 'left', clickCount: 1 });
  await sleep(300);
  const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  await sleep(2000);
  rec.undo = { presses: 1, shaAfterUndo: sha(), byteIdentical: sha() === rec.shaBefore, tracksAfterUndo: tracks(JSON.parse(readFileSync(EDIT, 'utf8'))) };
}
writeFileSync(outFile, JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec));
process.exit(0);
