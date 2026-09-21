// Right-click → 「タイムラインに追加」, poll edit.json until it changes (≤20s), then Cmd+Z and poll until it reverts.
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const [cardPath, fx, fy, outFile] = process.argv.slice(2);
const EDIT = '/tmp/agck-l1/ws/edit.json';
const read = () => readFileSync(EDIT, 'utf8');
const cdp = await connectMain(9377);
const base = read();
const playhead = await evalMain(cdp, `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/プレビューをシークしました/.test(e.textContent)).map(e=>e.textContent.trim()).slice(-1)[0]||''`);
const menu = await evalMain(cdp, `(async () => { document.querySelectorAll('[data-akari-context-menu]').forEach(p=>p.remove()); const el=document.querySelector('[data-akari-material-path=${JSON.stringify(cardPath)}]'); const r=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20,button:2})); await new Promise(r=>setTimeout(r,400)); const b=[...document.querySelectorAll('[data-akari-context-menu] button')]; const add=b.find(x=>x.textContent.trim()==='タイムラインに追加'); if(add) add.click(); return {labels:b.map(x=>x.textContent.trim()), clicked: !!add}; })()`);
const t0 = Date.now(); let added = base;
while (Date.now() - t0 < 20000) { added = read(); if (added !== base) break; await sleep(200); }
const addMs = Date.now() - t0;
await sleep(500); added = read();
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: +fx, y: +fy, button: 'left', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: +fx, y: +fy, button: 'left', clickCount: 1 });
await sleep(300);
const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
const t1 = Date.now(); let undone = added;
while (Date.now() - t1 < 10000) { undone = read(); if (undone !== added) break; await sleep(200); }
const norm = s => JSON.stringify(JSON.parse(s));
const A = JSON.parse(added), B = JSON.parse(base);
const rec = { card: cardPath, playheadNotice: playhead, menu, editChanged: added !== base, addMs,
  addedDiff: { tracks: A.tracks.map(t => ({ id: t.id, lane: t.lane, items: t.items })), sources: A.sources, audio: A.audio ?? null },
  baseItemCount: B.tracks.flatMap(t => t.items).length,
  undoRestoredSemantically: norm(undone) === norm(base) };
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify({ card: cardPath, clicked: menu.clicked, editChanged: rec.editChanged, addMs, undo: rec.undoRestoredSemantically, audio: A.audio ?? null, items: A.tracks.map(t => t.items.map(i => `${t.id}:${i.id}@${i.at}`)) }));
process.exit(0);
