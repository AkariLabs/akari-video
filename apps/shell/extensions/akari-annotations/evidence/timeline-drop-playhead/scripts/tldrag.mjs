// ライブラリ / プロジェクトのカードを実マウスで掴み、本物の DragData でタイムラインの「時刻 t・指定の行」へ運んで落とす。
// 落とす前後で再生位置（タイムラインの playheadT・transport・プレビュー widget の lastKnownTime）を 150ms ごとに記録し、
// tick / リフレッシュのログ（instrument.mjs の差し込み）と合わせて保存する。
// 使い方: node tldrag.mjs <project> <card> <t秒> <row> <out.json> [--shot=<png>] [--cancel] [--settle=<ms>]
//   <card> = asset:<catalogKey> | textstyle:<id> | css:<selector>
//   <row>  = row:<見出しの先頭文字列>[,<dy>] | y:<CSS px>
import { writeFile } from 'node:fs/promises';
import { NOTICES, S, connect, evalOn, readEditText, readCaptionsText, sleep } from './common.mjs';
import { screenshot } from './cdp-lib.mjs';
import { FIND_TIMELINE, INSTALL, STATE } from './tdp-lib.mjs';
import { webviewContexts } from './stage.mjs';
const [project, cardSpec, tSpec, rowSpec, outFile] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const cancel = process.argv.includes('--cancel');
const settle = Number(process.argv.find(v => v.startsWith('--settle='))?.slice(9) ?? 8000);
const cdp = await connect();
await evalOn(cdp, INSTALL);
await evalOn(cdp, `(window.__tdp.log.length=0,true)`);
const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
const rec = { cardSpec, t: Number(tSpec), rowSpec, at: new Date().toISOString() };
const [ckind, cval] = [cardSpec.slice(0, cardSpec.indexOf(':')), cardSpec.slice(cardSpec.indexOf(':') + 1)];
const sel = ckind === 'asset' ? `[data-akari-catalog-item=${S(cval)}]`
  : ckind === 'textstyle' ? `[data-akari-catalog-preset-item=${S('textstyle/' + cval)}], [data-akari-catalog-item=${S('textstyle/' + cval)}]`
  : cval;
const card = await evalOn(cdp, `(()=>{const el=document.querySelector(${S(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(30,r.height/2)),draggable:el.getAttribute('draggable')}})()`);
if (!card) { console.log('card not found'); process.exit(1); }
rec.card = card;
if (rowSpec.startsWith('row:')) {
  const name = rowSpec.slice(4).split(',')[0];
  await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-track-header-name')].find(e=>e.textContent.trim().startsWith(${S(name)}));if(e)e.scrollIntoView({block:'center'});return !!e})()`);
  await sleep(400);
}
const geo = await evalOn(cdp, `(()=>{const w=${FIND_TIMELINE};const r=w.strip.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height,viewStart:w.viewStart,vis:w.visibleDuration(),rows:[...document.querySelectorAll('.akari-track-header-name')].map(e=>{const b=(e.closest('[class*=track-header]:not(.akari-track-header-name)')||e).getBoundingClientRect();return{text:e.textContent.trim(),top:b.top,bottom:b.bottom,cy:b.top+b.height/2}})}})()`);
rec.geo = geo;
const x = Math.round(geo.l + (rec.t - geo.viewStart) / geo.vis * geo.w);
let y;
if (rowSpec.startsWith('track:')) {
  // タイムライン自身の行レイアウト（laneLayout）で行の縦位置を取り、帯のスクロール（stripScroll）でその行を見える所へ出す。
  // 見出し列だけを scrollIntoView すると見出しと帯がずれるため使わない。
  const [id, dy] = rowSpec.slice(6).split(',');
  y = await evalOn(cdp, `(async()=>{const w=${FIND_TIMELINE};const L=w.laneLayout.tracks.find(t=>t.id===${S(id)});if(!L)return null;const sc=w.stripScroll;const want=L.top+L.height/2-sc.clientHeight/2;sc.scrollTop=Math.max(0,want);sc.dispatchEvent(new Event('scroll'));await new Promise(r=>setTimeout(r,400));return w.strip.getBoundingClientRect().top+L.top+L.height/2+${Number(dy || 0)}})()`);
  if (y === null) { console.log(JSON.stringify({ error: 'track not found', id })); process.exit(2); }
  y = Math.round(y);
  rec.rowsAfterScroll = await evalOn(cdp, `[...document.querySelectorAll('.akari-track-header-name')].map(e=>{const b=e.getBoundingClientRect();return{text:e.textContent.trim(),top:Math.round(b.top),bottom:Math.round(b.bottom)}})`);
} else if (rowSpec.startsWith('y:')) y = Number(rowSpec.slice(2));
else { const [name, dy] = rowSpec.slice(4).split(','); const row = geo.rows.find(r => r.text.startsWith(name)); if (!row) { console.log('row not found', name, JSON.stringify(geo.rows)); process.exit(1); } y = Math.round(row.cy + Number(dy || 0)); }
rec.drop = { x, y };
rec.drop.hit = await evalOn(cdp, `(()=>{const e=document.elementFromPoint(${x},${y});return e?{inTimeline:!!e.closest('#akari-annotations-widget'),cls:String(e.className).slice(0,60)}:null})()`);
if (!rec.drop.hit?.inTimeline) { console.log(JSON.stringify({ error: 'drop point not on timeline', drop: rec.drop })); process.exit(2); }
const items = t => JSON.parse(t).tracks.flatMap((tr, trackIndex) => tr.items.map(i => ({ track: tr.id, trackIndex, trackName: tr.name, lane: tr.lane, id: i.id, at: i.at, duration: i.duration, source: i.source })));
const before = await readEditText(project);
const capBefore = await readCaptionsText(project).catch(() => '[]');
const capRows = t => { const p = JSON.parse(t); return Array.isArray(p) ? p : p.captions || []; };
const GHOST = `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'};const rect=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left*10)/10,y:Math.round(r.top*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10}};
 const tl=document.getElementById('akari-annotations-widget')||document;
 return{ghosts:[...tl.querySelectorAll('[class*="ghost"], [data-testid*="ghost"], [data-testid="akari-track-insert-indicator"], [data-akari-textstyle-drop-target], [class*="drop-label"], [class*="drop-badge"], [data-akari-drop-label]')].filter(vis).map(e=>({cls:String(e.className).slice(0,80),testid:e.dataset.testid??null,rect:rect(e),text:(e.textContent||'').trim().slice(0,40),border:getComputedStyle(e).borderTopStyle+' '+getComputedStyle(e).borderTopColor,outline:getComputedStyle(e).outlineStyle+' '+getComputedStyle(e).outlineColor,bg:getComputedStyle(e).backgroundColor})).slice(0,12),
  footer:(document.querySelector('.akari-annotations-footer')||{}).textContent??null}})()`;
rec.stateBefore = await evalOn(cdp, STATE);
await cdp.send('Input.setInterceptDrags', { enabled: true });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
await sleep(400);
rec.dragIntercepted = events.length > 0;
if (events.length) {
  const data = events[0].data;
  rec.mimeTypes = data.items.map(i => i.mimeType);
  const at = (type, px, py) => cdp.send('Input.dispatchDragEvent', { type, x: px, y: py, data });
  const path = [[x - 60, y - 40], [x - 30, y - 20], [x, y], [x, y], [x, y]];
  await at('dragEnter', path[0][0], path[0][1]); await sleep(150);
  for (const [px, py] of path) { await at('dragOver', px, py); await sleep(200); }
  await sleep(500);
  await at('dragOver', x, y); await sleep(300);
  rec.duringDrag = await evalOn(cdp, GHOST);
  if (shot) {
    // タイムラインの枠だけを CSS px 等倍で撮り、ポインタの位置に十字を描き足す（証跡の目印。アプリの DOM ではない）
    const box = await evalOn(cdp, `(()=>{const r=document.getElementById('akari-annotations-widget').getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
    await evalOn(cdp, `(()=>{const m=document.createElement('div');m.id='tdp-pointer-mark';Object.assign(m.style,{position:'fixed',left:(${x}-9)+'px',top:(${y}-9)+'px',width:'18px',height:'18px',border:'2px solid #ff2bd6',borderRadius:'50%',pointerEvents:'none',zIndex:99999});document.body.append(m);return true})()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
    await evalOn(cdp, `(document.getElementById('tdp-pointer-mark')?.remove(),true)`);
    await (await import('node:fs/promises')).writeFile(shot, Buffer.from(data, 'base64'));
  }
  await at(cancel ? 'dragCancel' : 'drop', x, y);
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
await cdp.send('Input.setInterceptDrags', { enabled: false });
const samples = []; const t0 = Date.now();
while (Date.now() - t0 < settle) { const s = await evalOn(cdp, STATE).catch(e => ({ error: String(e) })); samples.push({ ms: Date.now() - t0, ...s }); await sleep(150); }
// プレビュー（webview の内側の文書）自身の表示時刻と、frame-engine の時計の有無
try { const wv = await webviewContexts(); if (wv?.inner !== undefined) { rec.webview = await evalOn(wv.cdp, `({label:(document.getElementById('time-label')||{}).textContent??null,frameEngine:Boolean(window.akari&&window.akari.frameEngineClock),video:(()=>{const v=document.getElementById('preview-video');return v?{readyState:v.readyState,currentTime:v.currentTime,duration:v.duration,src:Boolean(v.currentSrc)}:null})()})`, wv.inner); } wv?.cdp.close(); } catch (e) { rec.webview = { error: String(e) }; }
const after = await readEditText(project);
rec.samples = samples;
rec.stateAfter = samples.at(-1);
rec.log = await evalOn(cdp, `window.__tdp.log`);
rec.editChanged = after !== before;
const b = new Set(items(before).map(i => i.track + '/' + i.id));
rec.newItems = items(after).filter(i => !b.has(i.track + '/' + i.id));
rec.tracksAfter = JSON.parse(after).tracks.map((t, i) => ({ index: i, id: t.id, name: t.name, lane: t.lane, items: t.items.length }));
const capAfter = await readCaptionsText(project).catch(() => '[]');
rec.newCaptions = capRows(capAfter).filter(c => !capRows(capBefore).some(bb => bb.id === c.id));
rec.newSfx = (JSON.parse(after).audio?.sfx ?? []).length - (JSON.parse(before).audio?.sfx ?? []).length;
rec.notices = await evalOn(cdp, NOTICES);
const start = rec.stateBefore.playheadT;
const minPlayhead = Math.min(...samples.map(s => s.playheadT).filter(Number.isFinite));
const minTransport = Math.min(...samples.map(s => s.transport?.t).filter(Number.isFinite));
rec.summary = { start, minPlayhead, minTransport, end: rec.stateAfter.playheadT, endTransport: rec.stateAfter.transport?.t,
  resetToZero: minPlayhead < 0.05 || minTransport < 0.05, endMoved: Math.abs((rec.stateAfter.playheadT ?? NaN) - start) > 0.05,
  staleTicks: rec.log.filter(l => l.k === 'tick' && l.stale).length, zeroTicks: rec.log.filter(l => l.k === 'tick' && l.time < 0.05).map(l => ({ at: l.at, pageId: l.pageId, widgetPageId: l.widgetPageId })),
  refreshes: rec.log.filter(l => l.k === 'refresh').map(l => ({ at: l.at, seek: l.seek, force: l.force })), newItems: rec.newItems.map(i => `${i.trackName}/${i.id}@${i.at}`), newCaptions: rec.newCaptions.map(c => `${c.id}@${c.start}`), newSfx: rec.newSfx, webview: rec.webview };
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n');
console.log(JSON.stringify(rec.summary));
cdp.close(); process.exit(0);
