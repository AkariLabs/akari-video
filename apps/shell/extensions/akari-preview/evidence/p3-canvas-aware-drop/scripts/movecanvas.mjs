// タイムラインでキャンバスの帯（行）を掴んで <秒> へ動かす（C-0b の L1 と同じ操作）。子の相対 at と絶対時刻を記録する。
// 使い方: node movecanvas.mjs <project> <canvasId> <toSec> <out.json>
import { writeFile } from 'node:fs/promises';
import { S, connect, evalOn, readEditText, sleep } from './common.mjs';
const [project, id, toSec, outFile] = process.argv.slice(2);
const cdp = await connect();
const FPS = 30;
const find = (doc, want) => { let hit = null; const walk = (list, parent, base) => { for (const i of list || []) { if (i.id === want) hit = { item: i, parent: parent?.id ?? null, absAt: base + i.at }; if (Array.isArray(i.items)) walk(i.items, i, base + i.at); } }; doc.tracks.forEach(t => walk(t.items, null, 0)); return hit; };
const geo = await evalOn(cdp, `(()=>{const w=document.getElementById('akari-annotations-widget');const el=[...w.querySelectorAll('[data-akari-item-kind]')].find(e=>e.dataset.akariItemId==='cut-base'||(e.getAttribute('data-akari-ui')||'')==='timeline:cut:0');if(!el)return null;const r=el.getBoundingClientRect();return{x0:r.left,pxPerSec:r.width/30}})()`);
const chip = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(`.akari-timeline-tree-item[data-akari-item-id="${id}"]`)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
const before = JSON.parse(await readEditText(project));
const rec = { id, toSec: Number(toSec), geo, chip, before: find(before, id) && { at: find(before, id).item.at, duration: find(before, id).item.duration, children: (find(before, id).item.items || []).map(c => ({ id: c.id, at: c.at, duration: c.duration, absAt: find(before, id).absAt + c.at })) } };
if (geo && chip) {
  const dx = (Number(toSec) - rec.before.at / FPS) * geo.pxPerSec;
  const from = { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, to = { x: from.x + dx, y: from.y };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' }); await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
  for (let k = 1; k <= 14; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + dx * k / 14, y: from.y, button: 'left', buttons: 1 }); await sleep(25); }
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(900);
}
let after = before; for (let i = 0; i < 24; i++) { after = JSON.parse(await readEditText(project)); if (find(after, id)?.item.at !== rec.before?.at) break; await sleep(250); }
const a = find(after, id);
rec.after = a && { at: a.item.at, duration: a.item.duration, children: (a.item.items || []).map(c => ({ id: c.id, at: c.at, duration: c.duration, absAt: a.absAt + c.at })) };
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
