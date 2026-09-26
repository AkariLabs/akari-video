// 左のカード（プロジェクトの素材・ライブラリの素材・T タイル・テキストスタイル・図形…）を実マウスで掴み、出力プレビューの上（または枠の外）へ運んで落とす。
// pvdrag.mjs（P-1）の拡張。2 つの運び方を比べられる:
//   --mode=intercept（既定）: Input.setInterceptDrags で本物の DragData を横取りし、Input.dispatchDragEvent で運ぶ（P-1 / FX-2 と同じ）
//   --mode=mouse: Input.dispatchMouseEvent の押下 → 移動 → 離す だけ（OS のドラッグに任せる）
// ページ内に記録器を仕掛け、ドラッグ中の層（[data-akari-preview-library-drop]）の有無・drop が層へ届いたか・
// 配置コマンドの呼び出しと戻り値・通知・edit.json / captions.json の差分を 1 つの JSON にまとめる。
// 使い方: node drag.mjs <project> <card> <drop> <out.json> [--shot=<png>] [--mode=mouse] [--hold=<png>]
//   <card> = material:<relativePath> | asset:<catalogKey> | textstyle:<id> | shape:<preset> | css:<selector>
//   <drop> = stage:<fx>,<fy>（出力の枠の割合。0..1 の外なら枠の外）| host:<x>,<y>（本体ページの CSS px）
//   --hold=<png>: 落とす前に、枠の外（カードの右隣・左パネルの上）でのドラッグ中の画面を撮る
import { writeFile } from 'node:fs/promises';
import { NOTICES, S, connect, evalOn, readEditText, readCaptionsText, sleep } from './common.mjs';
import { screenshot } from './cdp-lib.mjs';
import { stageGeometry } from './stage.mjs';

const [project, cardSpec, dropSpec, outFile] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const hold = process.argv.find(v => v.startsWith('--hold='))?.slice(7);
const mode = process.argv.find(v => v.startsWith('--mode='))?.slice(7) ?? 'intercept';
const cdp = await connect();
const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
const rec = { cardSpec, dropSpec, mode, at: new Date().toISOString() };
const ckind = cardSpec.slice(0, cardSpec.indexOf(':')), cval = cardSpec.slice(cardSpec.indexOf(':') + 1);
const sel = ckind === 'material' ? `[data-akari-material-path=${S(cval)}]`
  : ckind === 'asset' ? `[data-akari-catalog-item=${S(cval)}]`
  : ckind === 'textstyle' ? `[data-akari-catalog-preset-item=${S('textstyle/' + cval)}], [data-akari-catalog-item=${S('textstyle/' + cval)}]`
  : ckind === 'shape' ? `[data-akari-shape-tile=${S(cval)}]`
  : cval;
const card = await evalOn(cdp, `(()=>{const el=document.querySelector(${S(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(30,r.height/2)),w:Math.round(r.width),h:Math.round(r.height),draggable:el.getAttribute('draggable')}})()`);
if (!card) { console.log('card not found'); process.exit(1); }
rec.card = card;
const geo = await stageGeometry(cdp, JSON.parse(await readEditText(project)).output);
rec.stage = geo && { host: geo.host, output: geo.output };
let drop;
if (dropSpec.startsWith('stage:')) {
  const [fx, fy] = dropSpec.slice(6).split(',').map(Number);
  drop = { x: Math.round(geo.host.x + fx * geo.host.w), y: Math.round(geo.host.y + fy * geo.host.h) };
} else { const [x, y] = dropSpec.slice(5).split(',').map(Number); drop = { x, y }; }
drop.outputPx = { x: (drop.x - geo.host.x) / geo.host.w * geo.output.width, y: (drop.y - geo.host.y) / geo.host.h * geo.output.height };
drop.clampedOutputPx = { x: Math.min(geo.output.width, Math.max(0, drop.outputPx.x)), y: Math.min(geo.output.height, Math.max(0, drop.outputPx.y)) };
rec.drop = drop;

// ページ内の記録器（検証専用。ソースは不変）
await evalOn(cdp, `(()=>{
 const log=window.__pdm={events:[],commands:[],dragImages:[]};
 const where=t=>{const e=t instanceof Element?t:null;return e?{tag:e.tagName,inLayer:Boolean(e.closest('[data-akari-preview-library-drop]')),isLayer:e.hasAttribute('data-akari-preview-library-drop'),cls:String(e.className).slice(0,50)}:String(t)};
 if(!window.__pdmInstalled){window.__pdmInstalled=true;
  for(const type of ['dragstart','dragenter','dragover','dragleave','drop','dragend']) window.addEventListener(type,ev=>{const l=window.__pdm;if(!l)return;const last=l.events[l.events.length-1];if(type==='dragover'&&last&&last.type==='dragover'&&last.target.inLayer===where(ev.target).inLayer){last.count++;return}l.events.push({type,count:1,x:ev.clientX,y:ev.clientY,target:where(ev.target),types:ev.dataTransfer?[...ev.dataTransfer.types]:[],layer:Boolean(document.querySelector('[data-akari-preview-library-drop]'))})},true);
  const setImg=DataTransfer.prototype.setDragImage;DataTransfer.prototype.setDragImage=function(el,x,y){const l=window.__pdm;if(l){const r=el.getBoundingClientRect?el.getBoundingClientRect():{width:0,height:0};l.dragImages.push({tag:el.tagName,width:el.width??Math.round(r.width),height:el.height??Math.round(r.height),rect:{w:Math.round(r.width),h:Math.round(r.height)},text:(el.textContent||'').trim().slice(0,60),imgs:el.querySelectorAll?el.querySelectorAll('img,svg,canvas').length:0,offset:[x,y]})}return setImg.call(this,el,x,y)};
  const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');const svc=window.theia.container.get(C);const orig=svc.executeCommand.bind(svc);
  svc.executeCommand=async(id,...args)=>{const l=window.__pdm;const entry={id,args:JSON.parse(JSON.stringify(args,(k,v)=>typeof v==='string'&&v.length>200?v.slice(0,200)+'…':v)??null)};if(l&&/^akari\\.(timeline|caption|preview\\.seekOutput|catalog|library)/.test(id))l.commands.push(entry);try{const r=await orig(id,...args);entry.result=r===undefined?'undefined':JSON.parse(JSON.stringify(r,(k,v)=>typeof v==='string'&&v.length>200?v.slice(0,200)+'…':v)??null);return r}catch(e){entry.error=String(e&&e.message||e);throw e}};
 }
 return true})()`);

const PROBE = `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'};
 const rect=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left*10)/10,y:Math.round(r.top*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10}};
 const layer=[...document.querySelectorAll('[data-akari-preview-library-drop]')];
 const ghost=layer.flatMap(l=>[...l.children]).filter(vis).map(g=>({rect:rect(g),text:(g.textContent||'').trim().slice(0,60),border:getComputedStyle(g).borderTopStyle}));
 const sample=[...document.querySelectorAll('[data-akari-drag-sample]')].map(e=>({rect:rect(e),display:getComputedStyle(e).display,text:(e.textContent||'').trim().slice(0,60),img:e.querySelector('img')?.getAttribute('src')?.slice(0,80)??null}));
 return{layer:layer.map(e=>({rect:rect(e),visible:vis(e),cursor:e.style.cursor})),ghost,sample}})()`;
const items = t => JSON.parse(t).tracks.flatMap((tr, trackIndex) => tr.items.map(i => ({ track: tr.id, trackIndex, lane: tr.lane, id: i.id, at: i.at, duration: i.duration, source: i.source, transform: i.transform, params: i.params })));
const before = await readEditText(project);
const capBefore = await readCaptionsText(project).catch(() => '[]');
const capRows = t => { const p = JSON.parse(t); return Array.isArray(p) ? p : p.captions || []; };
const path = [[drop.x - 60, drop.y + 40], [drop.x - 30, drop.y + 20], [drop.x, drop.y], [drop.x, drop.y], [drop.x, drop.y]];
const holdPoint = { x: Math.max(20, card.x - 30), y: card.y + 60 };

if (mode === 'intercept') {
  await cdp.send('Input.setInterceptDrags', { enabled: true });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
  await sleep(400);
  rec.dragIntercepted = events.length > 0;
  if (events.length) {
    const data = events[0].data;
    rec.mimeTypes = data.items.map(i => i.mimeType);
    rec.dragImage = { hasImage: Boolean(data.dragImage), width: data.dragImage?.width ?? null, height: data.dragImage?.height ?? null };
    rec.payload = data.items.filter(i => /x-akari-(library-item|material)/.test(i.mimeType)).map(i => { try { return JSON.parse(i.data); } catch { return i.data; } })[0] ?? null;
    const at = (type, x, y) => cdp.send('Input.dispatchDragEvent', { type, x, y, data });
    if (hold) { await at('dragEnter', holdPoint.x, holdPoint.y); await at('dragOver', holdPoint.x, holdPoint.y); await sleep(300); rec.atHold = await evalOn(cdp, PROBE); await screenshot(cdp, hold); }
    await at('dragEnter', path[0][0], path[0][1]); await sleep(150);
    for (const [x, y] of path) { await at('dragOver', x, y); await sleep(200); }
    await sleep(600);
    await at('dragOver', drop.x, drop.y); await sleep(300);
    rec.duringDrag = await evalOn(cdp, PROBE);
    if (shot) await screenshot(cdp, shot);
    await at('drop', drop.x, drop.y);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.setInterceptDrags', { enabled: false });
} else {
  const move = async (x, y) => { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(40); };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 8; k++) await move(card.x + k * 6, card.y + k * 6);
  if (hold) { await move(holdPoint.x, holdPoint.y); await sleep(300); rec.atHold = await evalOn(cdp, PROBE); await screenshot(cdp, hold); }
  const from = { x: card.x + 48, y: card.y + 48 };
  for (let s = 1; s <= 12; s++) await move(from.x + (path[0][0] - from.x) * s / 12, from.y + (path[0][1] - from.y) * s / 12);
  for (const [x, y] of path) { await move(x, y); await sleep(160); }
  await sleep(600); await move(drop.x, drop.y); await sleep(300);
  rec.duringDrag = await evalOn(cdp, PROBE);
  if (shot) await screenshot(cdp, shot);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', buttons: 0, clickCount: 1 });
}
const t0 = Date.now(); let after = before;
for (let i = 0; i < 40; i++) { await sleep(500); after = await readEditText(project); if (after !== before || (await readCaptionsText(project).catch(() => '[]')) !== capBefore) break; }
rec.waitMs = Date.now() - t0; await sleep(2500); after = await readEditText(project);
rec.afterDrop = await evalOn(cdp, PROBE);
const log = await evalOn(cdp, `window.__pdm`);
rec.pageEvents = log.events; rec.commands = log.commands; rec.dragImages = log.dragImages;
rec.dropReachedLayer = log.events.some(e => e.type === 'drop' && e.target.inLayer);
rec.layerSeenDuringDrag = log.events.some(e => e.type === 'dragover' && e.layer);
rec.editChanged = after !== before;
const b = new Set(items(before).map(i => i.track + '/' + i.id));
rec.newItems = items(after).filter(i => !b.has(i.track + '/' + i.id));
const capAfter = await readCaptionsText(project).catch(() => '[]');
rec.captionsChanged = capAfter !== capBefore;
rec.newCaptions = capRows(capAfter).filter(c => !capRows(capBefore).some(x => x.id === c.id));
rec.audioBefore = JSON.parse(before).audio ?? null;
rec.audioAfter = JSON.parse(after).audio ?? null;
rec.newSources = (JSON.parse(after).sources || []).filter(s => !(JSON.parse(before).sources || []).some(x => x.id === s.id));
rec.notices = await evalOn(cdp, NOTICES);
rec.playhead = await evalOn(cdp, `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+:\\d\\d(\\.\\d)?\\s*\\/\\s*\\d+:\\d\\d$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())`);
const summary = { dragImages: rec.dragImages, card: cardSpec, drop: dropSpec, mode, dragIntercepted: rec.dragIntercepted, layerSeenDuringDrag: rec.layerSeenDuringDrag, dropReachedLayer: rec.dropReachedLayer,
  ghost: rec.duringDrag?.ghost, commands: rec.commands.map(c => ({ id: c.id, result: JSON.stringify(c.result ?? null).slice(0, 160), error: c.error })), editChanged: rec.editChanged, captionsChanged: rec.captionsChanged,
  newItems: rec.newItems.map(i => ({ id: i.id, track: i.track, at: i.at, duration: i.duration, transform: i.transform })), notices: rec.notices, playhead: rec.playhead };
rec.summary = summary;
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(summary)); cdp.close(); process.exit(0);
