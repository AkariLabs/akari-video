// 回帰: ライブラリのカタログカード（BGM / SFX / B-roll）を実マウスで掴み、本物の DragData でタイムラインへ落とす。
// 使い方: node libdrag.mjs <project> <catalogKey> <t=<秒>@<行>[+dy]> <out.json> [--shot=<png>]
import { writeFile } from 'node:fs/promises';
import { NOTICES, PROBE, ROWS, S, TIME_X, connect, evalOn, readEditText, sleep } from './common.mjs';
import { screenshot } from './cdp-lib.mjs';
const [project, key, dropSpec, outFile] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const cdp = await connect();
const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
const rec = { key, dropSpec, at: new Date().toISOString() };
const card = await evalOn(cdp, `(()=>{const el=document.querySelector('[data-akari-catalog-item=${S(key)}]');if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(30,r.height/2)),draggable:el.getAttribute('draggable')}})()`);
if (!card) { console.log('card not found'); process.exit(1); }
rec.card = card;
const m = /^t=([\d.]+)@([^+]+)(?:\+(\d+))?$/.exec(dropSpec); // 行の見出しの中心から下へ dy px ずらせる（例 t=3@Base+15）
const tx = await evalOn(cdp, TIME_X); const row = (await evalOn(cdp, ROWS)).find(r => r.text === m[2]);
const drop = { x: Math.round(tx.x0 + Number(m[1]) * tx.pps), y: row.cy + Number(m[3] || 0), targetTime: Number(m[1]), row: m[2] };
rec.drop = drop;
const items = t => JSON.parse(t).tracks.flatMap(tr => tr.items.map(i => ({ track: tr.id, id: i.id, at: i.at, duration: i.duration, source: i.source })));
const before = await readEditText(project);
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(400);
rec.dragIntercepted = events.length > 0;
if (events.length) {
  const data = events[0].data;
  rec.mimeTypes = data.items.map(i => i.mimeType);
  rec.payload = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data))[0] ?? null;
  const send = type => cdp.send('Input.dispatchDragEvent', { type, x: drop.x, y: drop.y, data });
  for (const type of ['dragEnter', 'dragOver', 'dragOver', 'dragOver']) { await send(type); await sleep(150); }
  rec.duringDrag = await evalOn(cdp, PROBE);
  if (shot) await screenshot(cdp, shot);
  await send('drop');
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
const t0 = Date.now(); let after = before;
for (let i = 0; i < 120; i++) { await sleep(500); after = await readEditText(project); if (after !== before) break; }
rec.waitMs = Date.now() - t0; await sleep(1000); after = await readEditText(project);
rec.editChanged = after !== before;
const b = new Set(items(before).map(i => i.track + '/' + i.id));
rec.newItems = items(after).filter(i => !b.has(i.track + '/' + i.id));
rec.newSources = (JSON.parse(after).sources || []).filter(s => !(JSON.parse(before).sources || []).some(x => x.id === s.id));
rec.notices = await evalOn(cdp, NOTICES);
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec).slice(0, 1400)); cdp.close(); process.exit(0);
