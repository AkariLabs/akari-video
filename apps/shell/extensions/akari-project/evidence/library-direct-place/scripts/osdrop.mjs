// OS file drop onto the timeline via Input.dispatchDragEvent with DragData.files.
// Usage: node osdrop.mjs <absFile> <x> <y> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const [file, x, y, outFile] = process.argv.slice(2);
const EDIT = '/tmp/ldp-l1/ws/edit.json';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9388));
const before = JSON.parse(readFileSync(EDIT, 'utf8'));
const data = { items: [], files: [file], dragOperationsMask: 1 };
for (const type of ['dragEnter', 'dragOver', 'dragOver']) { await cdp.send('Input.dispatchDragEvent', { type, x: +x, y: +y, data }); await sleep(120); }
await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: +x, y: +y, data });
let after = before; const t0 = Date.now();
for (let i = 0; i < 40; i++) { await sleep(500); after = JSON.parse(readFileSync(EDIT, 'utf8')); if (JSON.stringify(after) !== JSON.stringify(before)) break; }
await sleep(800); after = JSON.parse(readFileSync(EDIT, 'utf8'));
const items = j => j.tracks.flatMap(t => t.items.map(i => ({ track: t.id, ...i })));
const rec = { file, drop: { x: +x, y: +y }, waitMs: Date.now() - t0,
  newItems: items(after).filter(i => !items(before).some(b => b.track === i.track && b.id === i.id)),
  newSources: (after.sources || []).filter(s => !(before.sources || []).some(b => b.id === s.id)),
  tracksAfter: after.tracks.map(t => `${t.id}:${t.lane}`),
  footer: await evalMain(cdp, `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/追加しました|取り込/.test(e.textContent)&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim()).slice(-1)[0]||''`) };
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
