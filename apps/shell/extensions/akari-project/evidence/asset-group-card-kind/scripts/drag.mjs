// Real drag from a material card (Input.setInterceptDrags captures the genuine DragData),
// dropped onto a timeline point; then optional Cmd+Z. Records edit.json diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const [cardPath, dx, dy, outFile, mode] = process.argv.slice(2);
const EDIT = '/tmp/agck-l1/ws/edit.json';
const targets = await (await fetch('http://127.0.0.1:9377/json/list')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const events = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) events.push(m); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const items = j => j.tracks.flatMap(t => t.items.map(i => ({ track: t.id, lane: t.lane, ...i })));
const footer = () => ev(`(() => { const e=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/タイムラインに|置けません|追加しました/.test(e.textContent)&&e.getBoundingClientRect().width>0); return e.map(x=>x.textContent.trim()).slice(-1)[0]||''; })()`);
const before = JSON.parse(readFileSync(EDIT, 'utf8'));
const rec = { card: cardPath, drop: { x: +dx, y: +dy }, at: new Date().toISOString() };
if (mode === 'menu') {
  // Right-click → 「タイムラインに追加」 (placed at playhead)
  rec.menu = await ev(`(async () => { document.querySelectorAll('[data-akari-context-menu]').forEach(p=>p.remove()); const el=document.querySelector('[data-akari-material-path=${JSON.stringify(cardPath)}]'); const r=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20,button:2})); await new Promise(r=>setTimeout(r,400)); const b=[...document.querySelectorAll('[data-akari-context-menu] button')]; const labels=b.map(x=>x.textContent.trim()); const add=b.find(x=>x.textContent.trim()==='タイムラインに追加'); if(add) add.click(); return {labels, clicked: !!add}; })()`);
} else {
  const card = await ev(`(() => { const el=document.querySelector('[data-akari-material-path=${JSON.stringify(cardPath)}]'); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,draggable:el.getAttribute('draggable')}; })()`);
  rec.cardDraggable = card.draggable;
  await send('Input.setInterceptDrags', { enabled: true });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
  await sleep(300);
  const di = events.find(e => e.method === 'Input.dragIntercepted');
  rec.dragIntercepted = !!di;
  if (di) {
    const data = di.params.data;
    rec.mimeTypes = data.items.map(i => i.mimeType);
    rec.payload = data.items.filter(i => i.mimeType === 'application/x-akari-material').map(i => JSON.parse(i.data))[0];
    for (const type of ['dragEnter', 'dragOver', 'dragOver']) { await send('Input.dispatchDragEvent', { type, x: +dx, y: +dy, data }); await sleep(80); }
    await send('Input.dispatchDragEvent', { type: 'drop', x: +dx, y: +dy, data });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: +dx, y: +dy, button: 'left', clickCount: 1 });
  await send('Input.setInterceptDrags', { enabled: false });
}
await sleep(1500);
const after = JSON.parse(readFileSync(EDIT, 'utf8'));
const bIds = new Set(items(before).map(i => i.track + '/' + i.id));
rec.itemsBefore = items(before).length; rec.itemsAfter = items(after).length;
rec.tracksBefore = before.tracks.map(t => `${t.id}:${t.lane}`); rec.tracksAfter = after.tracks.map(t => `${t.id}:${t.lane}`);
rec.newItems = items(after).filter(i => !bIds.has(i.track + '/' + i.id));
rec.newSources = (after.sources || []).filter(s => !(before.sources || []).some(b => b.id === s.id));
rec.footer = await footer();
if (mode === 'undo' || mode === 'menu-undo') {}
writeFileSync(outFile, JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec));
process.exit(0);
