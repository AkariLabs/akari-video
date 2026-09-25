// ライブラリのカード（カタログ素材 / テキストスタイル / T タイル）を実マウスで掴み、本物の DragData で「出力プレビュー」の上へ運んで落とす。
// 使い方: node pvdrag.mjs <project> <card> <drop> <out.json> [--shot=<png>] [--cancel] [--alt]
//   --alt = ⌥ を押しながら（dragOver / drop の modifiers = Alt）。P-3 用に item を入れ子まで歩き、親（キャンバス）と絶対時刻も記録する
//   <card> = asset:<catalogKey> | textstyle:<id> | css:<selector>
//   <drop> = stage:<fx>,<fy>（出力の割合 0..1）| host:<x>,<y>（本体ページの CSS px）
import { writeFile } from 'node:fs/promises';
import { NOTICES, S, connect, evalOn, readEditText, readCaptionsText, sleep } from './common.mjs';
import { screenshot } from './cdp-lib.mjs';
import { stageGeometry } from './stage.mjs';
const [project, cardSpec, dropSpec, outFile] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const cancel = process.argv.includes('--cancel');
const alt = process.argv.includes('--alt');
const cdp = await connect();
const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
const rec = { cardSpec, dropSpec, at: new Date().toISOString() };
const [ckind, cval] = [cardSpec.slice(0, cardSpec.indexOf(':')), cardSpec.slice(cardSpec.indexOf(':') + 1)];
const sel = ckind === 'asset' ? `[data-akari-catalog-item=${S(cval)}]`
  : ckind === 'textstyle' ? `[data-akari-catalog-preset-item=${S('textstyle/' + cval)}], [data-akari-catalog-item=${S('textstyle/' + cval)}]`
  : cval;
const card = await evalOn(cdp, `(()=>{const el=document.querySelector(${S(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(30,r.height/2)),draggable:el.getAttribute('draggable')}})()`);
if (!card) { console.log('card not found'); process.exit(1); }
rec.card = card;
const geo = await stageGeometry(cdp, JSON.parse(await readEditText(project)).output);
rec.stage = geo;
let drop;
if (dropSpec.startsWith('stage:')) {
  const [fx, fy] = dropSpec.slice(6).split(',').map(Number);
  drop = { x: Math.round(geo.host.x + fx * geo.host.w), y: Math.round(geo.host.y + fy * geo.host.h) };
} else { const [x, y] = dropSpec.slice(5).split(',').map(Number); drop = { x, y }; }
// 期待値: 落とした点（ホスト CSS px）→ 出力 px
drop.outputPx = { x: (drop.x - geo.host.x) / geo.host.w * geo.output.width, y: (drop.y - geo.host.y) / geo.host.h * geo.output.height };
rec.drop = drop;
const items = t => { const out = []; const walk = (list, tr, trackIndex, parent, base) => { for (const i of list || []) { out.push({ track: tr.id, trackIndex, trackName: tr.name, lane: tr.lane, parent: parent?.id ?? null, parentName: parent?.name ?? null, id: i.id, at: i.at, absAt: base + i.at, duration: i.duration, source: i.source, transform: i.transform }); if (Array.isArray(i.items)) walk(i.items, tr, trackIndex, i, base + i.at); } };
  JSON.parse(t).tracks.forEach((tr, trackIndex) => walk(tr.items, tr, trackIndex, null, 0)); return out; };
const before = await readEditText(project);
const capBefore = await readCaptionsText(project).catch(() => '[]');
const capRows = t => { const p = JSON.parse(t); return Array.isArray(p) ? p : p.captions || []; };
const PROBE = `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'};
 const rect=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left*10)/10,y:Math.round(r.top*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10}};
 const layer=[...document.querySelectorAll('[data-akari-preview-library-drop], [class*="library-drop"], [class*="preview-drop"]')].filter(vis);
 const dashed=[...document.querySelectorAll('div,span,svg')].filter(e=>vis(e)&&/dashed/.test(getComputedStyle(e).borderStyle||'')&&e.closest('.theia-app-main, #theia-main-content-panel, body')).slice(0,10);
 const texts=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&vis(e)&&/→|入ります|キャンバス/.test(e.textContent)&&e.textContent.length<60&&!e.closest('.akari-annotations, #akari-annotations-widget')).map(e=>({text:e.textContent.trim(),rect:rect(e)}));
 const svgs=layer.flatMap(l=>[...l.querySelectorAll('svg')]).filter(vis).map(s=>({rect:rect(s)}));
 return{layer:layer.map(e=>({tag:e.tagName,cls:String(e.className).slice(0,80),data:[...e.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value.slice(0,40)),rect:rect(e),pointerEvents:getComputedStyle(e).pointerEvents})),
  dashed:dashed.map(e=>({tag:e.tagName,cls:String(e.className).slice(0,80),rect:rect(e),border:getComputedStyle(e).borderTopStyle+' '+getComputedStyle(e).borderTopColor+' '+getComputedStyle(e).borderTopWidth,text:(e.textContent||'').trim().slice(0,30)})),
  times:texts,svgs,
  timelineGhost:[...document.querySelectorAll('.akari-annotations [class*="ghost"]')].filter(vis).map(e=>({cls:String(e.className).slice(0,80),rect:rect(e),text:(e.textContent||'').trim().slice(0,30)})).slice(0,4)}})()`;
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(400);
rec.dragIntercepted = events.length > 0;
rec.atDragStart = await evalOn(cdp, PROBE);
if (events.length) {
  const data = events[0].data;
  rec.mimeTypes = data.items.map(i => i.mimeType);
  rec.payload = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data))[0] ?? null;
  const at = (type, x, y) => cdp.send('Input.dispatchDragEvent', { type, x, y, data, modifiers: alt ? 1 : 0 });
  rec.alt = alt;
  // 手前から近づいて、落とす点で何度か dragOver
  const path = [[drop.x - 60, drop.y + 40], [drop.x - 30, drop.y + 20], [drop.x, drop.y], [drop.x, drop.y], [drop.x, drop.y]];
  await at('dragEnter', path[0][0], path[0][1]); await sleep(150);
  for (const [x, y] of path) { await at('dragOver', x, y); await sleep(200); }
  await sleep(600);
  await at('dragOver', drop.x, drop.y); await sleep(300);
  rec.duringDrag = await evalOn(cdp, PROBE);
  if (shot) await screenshot(cdp, shot);
  await at(cancel ? 'dragCancel' : 'drop', drop.x, drop.y);
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
const t0 = Date.now(); let after = before;
for (let i = 0; i < (cancel ? 6 : 40); i++) { await sleep(500); after = await readEditText(project); if (after !== before || (await readCaptionsText(project).catch(() => '[]')) !== capBefore) break; }
rec.waitMs = Date.now() - t0; await sleep(1500); after = await readEditText(project);
rec.afterDrop = await evalOn(cdp, PROBE);
rec.editChanged = after !== before;
const b = new Set(items(before).map(i => i.track + '/' + i.id));
rec.newItems = items(after).filter(i => !b.has(i.track + '/' + i.id));
rec.tracksAfter = JSON.parse(after).tracks.map((t, i) => ({ index: i, id: t.id, name: t.name, lane: t.lane, items: t.items.length }));
const capAfter = await readCaptionsText(project).catch(() => '[]');
rec.captionsChanged = capAfter !== capBefore;
rec.newCaptions = capRows(capAfter).filter(c => !capRows(capBefore).some(b => b.id === c.id));
rec.audioAfter = JSON.parse(after).audio ?? null;
rec.newSources = (JSON.parse(after).sources || []).filter(s => !(JSON.parse(before).sources || []).some(x => x.id === s.id));
rec.notices = await evalOn(cdp, NOTICES);
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec).slice(0, 2400)); cdp.close(); process.exit(0);
