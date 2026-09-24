// マイスタイルのカードを実マウスで掴み、Input.setInterceptDrags で DragData を横取りしてタイムラインの秒へ落とす（tsdrag.mjs の写し）。
// 使い方: node msdrag.mjs <project> <styleId> <秒> <out.json>
import { writeFile } from 'node:fs/promises';
import { CHIPS, NOTICES, PROBE, ROWS, TIME_X, captionRows, connect, evalOn, readCaptionsText, sleep } from './common.mjs';
const [project, styleId, seconds, outFile] = process.argv.slice(2);
const cdp = await connect();
const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
const rec = { styleId, seconds: Number(seconds), at: new Date().toISOString() };
const card = await evalOn(cdp, `(()=>{const el=document.querySelector('[data-akari-my-style-card="${styleId}"]');if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(24,r.height/2))}})()`);
rec.card = card;
const tx = await evalOn(cdp, TIME_X);
const row = await evalOn(cdp, `(()=>{const c=document.querySelector('.akari-annotations-strip-caption[data-akari-item-id="c-0004"]');const r=c.getBoundingClientRect();return Math.round(r.top+r.height/2)})()`);
const drop = { x: Math.round(tx.x0 + Number(seconds) * tx.pps), y: row };
rec.drop = drop;
const before = await readCaptionsText(project);
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(400);
rec.dragIntercepted = events.length > 0;
if (events.length) {
  const data = events[0].data;
  rec.payloadKind = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data).kind)[0] ?? null;
  rec.atDragStart = await evalOn(cdp, PROBE);
  for (const type of ['dragEnter', 'dragOver', 'dragOver', 'dragOver']) { await cdp.send('Input.dispatchDragEvent', { type, x: drop.x, y: drop.y, data }); await sleep(150); }
  rec.duringDrag = await evalOn(cdp, PROBE);
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: drop.x, y: drop.y, data });
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
let after = before; for (let i = 0; i < 40; i++) { await sleep(250); after = await readCaptionsText(project); if (after !== before) break; }
await sleep(1200); after = await readCaptionsText(project);
const ids = new Set(captionRows(before).map(c => c.id));
rec.newCaptions = captionRows(after).filter(c => !ids.has(c.id));
rec.chips = (await evalOn(cdp, CHIPS)).filter(c => rec.newCaptions.some(n => n.id === c.id));
rec.notices = await evalOn(cdp, NOTICES);
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec).slice(0, 1800)); cdp.close(); process.exit(0);
