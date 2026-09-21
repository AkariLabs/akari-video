// (2) 再現: カードをサムネイル <img> の上（grip=img）またはタイトル部分（grip=title）から掴み、
// Input.setInterceptDrags で本物の DragData（types / files）を横取りして記録 → 同じパネルの上へ戻して
// dragOver し、取り込みの枠（renderDropOverlay「ここに落とすと素材に取り込みます」）が出るかを観測する。
// 最後は drop（mode=drop: パネル上で離す → 取り込まれないことを assets/ と edit.json で確認）か dragCancel。
// Usage: node paneldrag.mjs <proj:<materialPath>|lib:<catalogKey>> <img|title> <out.json> [drop|cancel] [shot.png]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
const [src, grip, outFile, mode = 'cancel', shot] = process.argv.slice(2);
const WS = process.env.WS || '/tmp/dfp-l1/ws';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9423));
const events = [];
cdp.ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method) events.push(m); });
const ev = expr => evalMain(cdp, expr, 30000);
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p).map(x => join(n, x)) : [n]; });
const assetsList = () => walk(join(WS, 'assets')).sort();
const [kind, ref] = [src.slice(0, src.indexOf(':')), src.slice(src.indexOf(':') + 1)];
const sel = kind === 'lib' ? `[data-akari-catalog-item=${JSON.stringify(ref)}]` : `[data-akari-material-path=${JSON.stringify(ref)}]`;
const rec = { src, grip, mode, at: new Date().toISOString() };
const editBefore = readFileSync(join(WS, 'edit.json'), 'utf8');
const assetsBefore = assetsList();
rec.card = await ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect(); const img=el.querySelector('img'); const ir=img&&img.getBoundingClientRect();
  let imgPt = null; // <img> 自体がヒットする点（再生ボタン・バッジの被りを避ける）
  if (ir && ir.width>0) { outer: for (let fy=0.15; fy<=0.9; fy+=0.05) for (let fx=0.1; fx<=0.9; fx+=0.1) { const p={x:ir.left+ir.width*fx,y:ir.top+ir.height*fy}; if (document.elementFromPoint(p.x,p.y)===img) { imgPt=p; break outer; } } }
  // タイトル側: カード下端近く（サムネイルの外）
  const titlePt = {x:r.left+Math.min(20,r.width/4), y:r.bottom-6};
  const hit = p => { if(!p) return null; const h=document.elementFromPoint(p.x,p.y); return h ? h.tagName+(h.className&&typeof h.className==='string'?'.'+h.className.split(' ')[0]:'') : null; };
  return { rect:{x:r.left,y:r.top,w:r.width,h:r.height}, draggable:el.getAttribute('draggable'), hasImg:!!img, imgDraggableAttr: img?img.getAttribute('draggable'):null, imgDraggableProp: img?img.draggable:null,
    imgPt, titlePt, hitImg: hit(imgPt), hitTitle: hit(titlePt) }; })()`);
if (!rec.card) { console.log('card not found'); process.exit(1); }
const pt = grip === 'img' ? rec.card.imgPt : rec.card.titlePt;
if (!pt) { console.log('no grip point'); process.exit(1); }
rec.grip_point = pt;
// ページ内で実際に見える dataTransfer.types（dragstart = ドラッグ元 / dragover = パネル上）を記録する
await ev(`(() => { window.__dfpTypes = { dragstart: null, dragover: [] };
  if (!window.__dfpHooked) { window.__dfpHooked = true;
    window.addEventListener('dragstart', e => { window.__dfpTypes.dragstart = { types: [...e.dataTransfer.types], files: e.dataTransfer.files.length, items: [...e.dataTransfer.items].map(i => i.kind + ':' + i.type), target: e.target.tagName }; }, true);
    window.addEventListener('dragover', e => { if (window.__dfpTypes.dragover.length < 3) window.__dfpTypes.dragover.push({ types: [...e.dataTransfer.types], files: e.dataTransfer.files.length, items: [...e.dataTransfer.items].map(i => i.kind + ':' + i.type) }); }, true); }
  return true; })()`);
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x + k * 3, y: pt.y + k * 3, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(300);
const di = events.find(e => e.method === 'Input.dragIntercepted');
rec.dragIntercepted = !!di;
const probe = `(() => { const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';};
  const hits=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/ここに落とすと|取り込みます/.test(e.textContent)&&vis(e)).map(e=>e.textContent.trim());
  return { importOverlayShown: hits.length>0, overlayTexts: hits }; })()`;
if (di) {
  const data = di.params.data;
  // CDP の DragData は <img> ドラッグで Chromium が載せる画像ファイル（dragstart で types に 'Files'）を運ばない。
  // 実ドラッグと同じ中身にするため、dragstart で Files が見えたときは同じサムネイル画像を files として足す。
  const ds = await ev('window.__dfpTypes.dragstart');
  if (process.env.NO_IMG_FILE !== '1' && ds && ds.types.includes('Files')) {
    const src = await ev(`document.elementFromPoint(${pt.x}, ${pt.y}).src`);
    const f = '/tmp/dfp-l1/dragged-thumb' + (src.match(/\.(jpe?g|png|webp)(\?|$)/i)?.[0].replace(/\?$/, '') || '.img');
    if (src.startsWith('file://')) writeFileSync(f, readFileSync(new URL(src)));
    else writeFileSync(f, Buffer.from(await (await fetch(src)).arrayBuffer()));
    data.files = [f];
    rec.injectedImageFile = { src, file: f };
  }
  // FORCE_FILES=<path>: 判定関数だけを見るため、アプリ内 MIME に OS ファイルを強制的に同乗させる（<img> 由来の Files の代わり）
  if (process.env.FORCE_FILES) { data.files = [process.env.FORCE_FILES]; rec.forcedFiles = data.files; }
  rec.dragData = { types: data.items.map(i => i.mimeType), files: data.files || [], itemsPreview: data.items.map(i => ({ mimeType: i.mimeType, title: i.title, baseURL: i.baseURL, data: String(i.data).slice(0, 160) })), dragOperationsMask: data.dragOperationsMask };
  // パネルの上へ戻す: カード自身から少し離れた、同じパネル内の点（カードの上端より少し上）
  const back = await ev(`(() => { const w=document.getElementById('akari-role-buckets-widget'); const r=w.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height*0.6 }; })()`);
  rec.hoverPoint = back;
  const send = type => cdp.send('Input.dispatchDragEvent', { type, x: back.x, y: back.y, data });
  await send('dragEnter');
  for (let k = 0; k < 3; k++) { await send('dragOver'); await sleep(150); }
  rec.duringDrag = await ev(probe);
  rec.pageDataTransfer = await ev('window.__dfpTypes');
  if (shot) await screenshot(cdp, shot);
  if (mode === 'drop') await send('drop');
  else {
    // パネルの外（中央の面）へ出してから取り消す（dragCancel だけでは dragleave が届かず枠が残るため）
    for (let k = 0; k < 2; k++) { await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: 700, y: 300, data }); await sleep(150); }
    rec.outsidePanel = await ev(probe);
    await cdp.send('Input.dispatchDragEvent', { type: 'dragCancel', x: 700, y: 300, data });
  }
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
await sleep(mode === 'drop' ? 4000 : 800);
rec.afterDrag = await ev(probe);
rec.editChanged = readFileSync(join(WS, 'edit.json'), 'utf8') !== editBefore;
const assetsAfter = assetsList();
rec.assetsAdded = assetsAfter.filter(a => !assetsBefore.includes(a));
rec.toasts = await ev(`[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')].map(e=>e.textContent.trim()).filter(Boolean).slice(-4)`);
writeFileSync(outFile, JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec, null, 1));
process.exit(0);
