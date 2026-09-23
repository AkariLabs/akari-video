// テキストスタイルのカードを実マウスで掴み、Input.setInterceptDrags で本物の DragData を横取りして落とす。
// 使い方: node tsdrag.mjs <project> <presetId> <dropSpec> <out.json> [--shot=<png>] [--startshot=<png>] [--cancel]
//   dropSpec = "t=<秒>@<行の見出し>"（タイムラインの秒と行）または "x,y"（画面座標。ライブラリ面など）
import { writeFile } from 'node:fs/promises';
import { CHIPS, NOTICES, PROBE, ROWS, S, TIME_X, captionRows, cardSelector, connect, evalOn, readCaptionsText, readEditText, sleep } from './common.mjs';
import { screenshot } from './cdp-lib.mjs';
const [project, presetId, dropSpec, outFile] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const cancel = process.argv.includes('--cancel');
const startShot = process.argv.find(v => v.startsWith('--startshot='))?.slice(12);
const cdp = await connect();
const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
const rec = { presetId, dropSpec, at: new Date().toISOString() };
const card = await evalOn(cdp, `(()=>{const el=document.querySelector(${S(cardSelector(presetId))});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(24,r.height/2)),draggable:el.getAttribute('draggable')}})()`);
if (!card) { console.log('card not found'); process.exit(1); }
rec.card = card;
let drop;
const m = /^t=([\d.]+)@(.+)$/.exec(dropSpec);
if (m) {
  const tx = await evalOn(cdp, TIME_X); const rows = await evalOn(cdp, ROWS);
  const row = rows.find(r => r.text === m[2]);
  drop = { x: Math.round(tx.x0 + Number(m[1]) * tx.pps), y: row.cy, targetTime: Number(m[1]), row: m[2], pps: tx.pps };
} else { const [x, y] = dropSpec.split(',').map(Number); drop = { x, y }; }
rec.drop = drop;
const capBefore = await readCaptionsText(project), editBefore = await readEditText(project);
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
  rec.atDragStart = await evalOn(cdp, PROBE); // タイムラインへ入る前（掴んだ直後）
  if (startShot) await screenshot(cdp, startShot);
  const send = type => cdp.send('Input.dispatchDragEvent', { type, x: drop.x, y: drop.y, data });
  for (const type of ['dragEnter', 'dragOver', 'dragOver', 'dragOver']) { await send(type); await sleep(150); }
  rec.duringDrag = await evalOn(cdp, PROBE);
  if (shot) await screenshot(cdp, shot);
  await send(cancel ? 'dragCancel' : 'drop');
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
const t0 = Date.now(); let capAfter = capBefore;
for (let i = 0; i < 20; i++) { await sleep(250); capAfter = await readCaptionsText(project); if (capAfter !== capBefore) break; }
rec.waitMs = Date.now() - t0; await sleep(1200);
capAfter = await readCaptionsText(project);
const editAfter = await readEditText(project);
rec.captionsChanged = capAfter !== capBefore; rec.editChanged = editAfter !== editBefore;
const beforeIds = new Set(captionRows(capBefore).map(c => c.id));
rec.newCaptions = captionRows(capAfter).filter(c => !beforeIds.has(c.id));
rec.afterDrop = await evalOn(cdp, PROBE);
rec.chips = (await evalOn(cdp, CHIPS)).filter(c => rec.newCaptions.some(n => n.id === c.id));
rec.notices = await evalOn(cdp, NOTICES);
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec).slice(0, 1500)); cdp.close(); process.exit(0);
