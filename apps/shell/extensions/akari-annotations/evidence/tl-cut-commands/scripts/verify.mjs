#!/usr/bin/env node
// L1 の受け入れ条件を 1 項目ずつ採る（ラッパー作成の検証スクリプト）。各段は失敗しても次へ進み、結果は JSON に残す。
// 使い方: node verify.mjs <apps/shell の絶対パス> <fixture project> <isoDir> <recordDir>（すべてリポ外・tl-cut-commands を含む名前）
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { keyPress, realClick, realDrag, screenshot } from './cdp-lib.mjs';
import { S, command, evalOn, sleep, start, stop, waitEval } from './l1-common.mjs';

const [shellDir, project, isoDir, recordDir] = process.argv.slice(2);
if (![shellDir, project, isoDir, recordDir].every(v => v && path.isAbsolute(v))) throw new Error('absolute paths required');
const port = 9465;
await mkdir(recordDir, { recursive: true });
const editPath = path.join(project, 'edit.json');
const hash = async () => createHash('sha256').update(await readFile(editPath)).digest('hex');
const view = async () => Object.fromEntries(JSON.parse(await readFile(editPath, 'utf8')).tracks.map(t => [t.id,
    (t.items ?? []).map(i => `${i.id}@${i.at}+${i.duration}${i.link ? `→${i.link}` : ''}`).join(' ')]));
const record = { at: new Date().toISOString(), steps: {} };
const save = () => writeFile(path.join(recordDir, 'verify.json'), `${JSON.stringify(record, null, 2)}\n`);
let session = await start({ shellDir, project, isoDir, port });
const ev = e => evalOn(session.cdp, e);
const W = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');return window.theia.container.get(k).getWidgets('bottom').find(w=>w.id==='akari-annotations-widget')})()`;
const ui = () => ev(`(()=>{const w=${W};const vis=e=>!!e&&e.getClientRects().length>0;
const insp=document.querySelector('.akari-inspector-widget');
return{rangeBands:[...document.querySelectorAll('[data-akari-timeline-range-band]')].map(e=>({left:e.style.left,width:e.style.width})),
edges:[...document.querySelectorAll('[data-akari-timeline-range-edge]')].map(e=>e.textContent),
rangeLabel:document.querySelector('[data-akari-timeline-range-duration]')?.textContent,
gapBand:[...document.querySelectorAll('.akari-annotations-gap-band')].map(e=>({left:e.style.left,width:e.style.width})),
menu:[...document.querySelectorAll('[data-akari-context-item]')].filter(vis).map(e=>e.dataset.akariContextItem+'|'+e.textContent.trim()),
captionChips:[...document.querySelectorAll('.akari-annotations-strip-caption')].map(e=>({text:e.textContent.trim().slice(0,20),left:e.style.left,width:e.style.width})),
autoRipple:document.querySelector('[data-akari-auto-ripple]')?.getAttribute('aria-pressed'),
leftPanel:(()=>{const e=document.getElementById('theia-left-content-panel');return e?{cls:e.className.includes('theia-mod-collapsed')?'collapsed':'open',w:Math.round(e.getBoundingClientRect().width)}:null})(),
rightPanel:(()=>{const e=document.getElementById('theia-right-content-panel');return e?{cls:e.className.includes('theia-mod-collapsed')?'collapsed':'open',w:Math.round(e.getBoundingClientRect().width)}:null})(),
inspectorVisible:vis(insp),inspectorText:vis(insp)?insp.textContent.replace(/\\s+/g,' ').slice(0,160):'',
tool:[...document.querySelectorAll('#akari-annotations-widget [aria-pressed="true"]')].map(e=>e.getAttribute('aria-label')||e.title),
footer:document.getElementById('akari-timeline-message')?.textContent?.trim(),
playhead:Math.round((w?.playheadT??-1)*1000)/1000}})()`);
const press = (key, code, vk, modifiers = 0, text) => keyPress(session.cdp, { key, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}) });
const keys = { i: ['i', 'KeyI', 73], o: ['o', 'KeyO', 79], x: ['x', 'KeyX', 88], q: ['q', 'KeyQ', 81], w: ['w', 'KeyW', 87],
    b: ['b', 'KeyB', 66], v: ['v', 'KeyV', 86], z: ['z', 'KeyZ', 90], del: ['Delete', 'Delete', 46], esc: ['Escape', 'Escape', 27] };
const k = (name, mods = 0) => press(...keys[name], mods);
const settle = () => sleep(900);
const waitChange = async prev => { const end = Date.now() + 15000; while (Date.now() < end) { if (await hash() !== prev) { await settle(); return true; } await sleep(150); } return false; };
const undo = async () => { await k('z', 4); await sleep(900); };
const xyAt = async (seconds, trackId) => ev(`(()=>{const w=${W},r=w.strip.getBoundingClientRect();const x=r.left+(${seconds}-w.viewStart)/w.visibleDuration()*r.width;
if(!${S(trackId)}){const rr=w.rulerBar.getBoundingClientRect();return{x:rr.left+(${seconds}-w.viewStart)/w.visibleDuration()*rr.width,y:rr.top+rr.height/2}}
const lane=w.laneLayout.tracks.find(t=>t.id===${S(trackId)});return{x,y:r.top+lane.top+lane.height/2}})()`);
const seek = async s => { const p = await xyAt(s); await realClick(session.cdp, p.x, p.y); await sleep(350); };
const clickAt = async (s, track, button = 'left') => { const p = await xyAt(s, track);
    if (button === 'left') await realClick(session.cdp, p.x, p.y);
    else { await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 }); }
    await sleep(400); return p; };
const hit = async (s, track) => { const p = await xyAt(s, track); return ev(`(()=>{const e=document.elementFromPoint(${p.x},${p.y});return e?(e.className+'|'+(e.closest('[data-akari-item-id]')?.dataset.akariItemId??'')).slice(0,120):null})()`); };
const shot = name => screenshot(session.cdp, path.join(recordDir, `${name}.png`)).catch(() => undefined);
const reset = async () => { await k('esc'); await sleep(200); await k('esc'); await sleep(200);
    let n = 0; while (await hash() !== baseline && n++ < 6) await undo(); return await hash() === baseline; };
const only = process.env.STEPS ? new Set(process.env.STEPS.split(',')) : undefined;
const statusTexts = async (ms = 2500) => { const seen = new Set(); const end = Date.now() + ms;
    while (Date.now() < end) { const t = await ev(`(()=>{const e=document.getElementById('akari-timeline-message')||document.getElementById('status-bar-akari-timeline-message');return e?e.textContent.trim():''})()`); if (t) seen.add(t); await sleep(100); }
    return [...seen]; };
async function step(name, fn) {
    if (only && !only.has(name)) return;
    const out = {}; record.steps[name] = out;
    try { await fn(out); } catch (error) { out.error = String(error?.stack ?? error).slice(0, 600); }
    out.resetToBaseline = await reset().catch(() => false);
    await save();
}
const baseline = await hash();
record.initial = { tracks: await view(), ui: await ui() };

await step('rangeIO_extract', async o => {
    await seek(8); await k('i'); await seek(12); await k('o'); await sleep(300);
    o.afterIO = await ui(); await shot('01-range');
    await k('del', 8); o.changed = await waitChange(baseline);
    o.tracks = await view(); o.ui = await ui(); await shot('02-extract');
    await undo(); o.undoByteEqual = await hash() === baseline;
});
await step('lift_gap_close', async o => {
    await seek(8); await k('i'); await seek(12); await k('o'); await sleep(300);
    await k('del'); o.changed = await waitChange(baseline); o.tracks = await view(); o.ui = await ui();
    await shot('03-lift');
    const lifted = await hash();
    o.hitBeforeGapClick = await hit(10, 'v-main');
    await clickAt(10, 'v-main'); o.gapClickUi = await ui(); await shot('04-gap-selected');
    await k('del'); o.gapClosed = await waitChange(lifted); o.gapTracks = await view(); o.gapUi = await ui();
    await undo(); o.undoToLifted = await hash() === lifted;
    o.hitBeforeRightClick = await hit(10, 'v-main');
    await clickAt(10, 'v-main', 'right'); o.gapMenuUi = await ui(); await shot('05-gap-menu');
    const gen = await ev(`(()=>{const e=[...document.querySelectorAll('[data-akari-context-item="generate-gap"]')].find(e=>e.getClientRects().length);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (gen) { await realClick(session.cdp, gen.x, gen.y); await sleep(2000); o.afterGenerate = await ui(); o.generateChangedEdit = await hash() !== lifted; await shot('06-gap-generate'); }
});
await step('clip_ripple_delete', async o => {
    await clickAt(10, 'v-broll'); o.selectUi = await ui();
    await k('del', 8); o.changed = await waitChange(baseline); o.tracks = await view(); o.ui = await ui();
    await undo(); o.undoByteEqual = await hash() === baseline;
});
await step('Q', async o => {
    await seek(10); await k('q'); o.changed = await waitChange(baseline); o.tracks = await view(); o.ui = await ui();
    await undo(); o.undoByteEqual = await hash() === baseline;
});
await step('W', async o => {
    await seek(10); await k('w'); o.changed = await waitChange(baseline); o.tracks = await view(); o.ui = await ui();
    await undo(); o.undoByteEqual = await hash() === baseline;
});
await step('cmdB_all', async o => {
    await seek(10); o.before = await ui(); await k('b', 4); o.changed = await waitChange(baseline);
    o.tracks = await view(); o.ui = await ui(); await shot('07-cmd-b');
    await undo(); o.undoByteEqual = await hash() === baseline;
});
await step('cmdB_selected', async o => {
    await seek(10); await clickAt(10.5, 'v-broll'); await seek(10); o.before = await ui();
    await k('b', 4); o.changed = await waitChange(baseline); o.tracks = await view(); o.ui = await ui();
    await undo(); o.undoByteEqual = await hash() === baseline;
});
await step('razor_click', async o => {
    await k('b'); await sleep(300); o.toolUi = await ui();
    await clickAt(5, 'v-main'); o.changed = await waitChange(baseline); o.tracks = await view();
    await undo(); o.undoByteEqual = await hash() === baseline; await k('v'); await sleep(300);
});
await step('clip_menu', async o => {
    await clickAt(10, 'v-broll', 'right'); o.ui = await ui(); await shot('08-clip-menu');
});
await step('auto_ripple', async o => {
    const btn = async () => ev(`(()=>{const e=document.querySelector('[data-akari-auto-ripple]');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    let b = await btn(); await realClick(session.cdp, b.x, b.y); await sleep(400); o.on = (await ui()).autoRipple; await shot('09-auto-on');
    await clickAt(10, 'v-broll'); await k('del'); o.onChanged = await waitChange(baseline); o.onTracks = await view();
    await undo(); o.onUndo = await hash() === baseline;
    b = await btn(); await realClick(session.cdp, b.x, b.y); await sleep(400); o.off = (await ui()).autoRipple;
    await clickAt(10, 'v-broll'); await k('del'); o.offChanged = await waitChange(baseline); o.offTracks = await view();
    await undo(); o.offUndo = await hash() === baseline;
    b = await btn(); await realClick(session.cdp, b.x, b.y); await sleep(1200); o.onBeforeRestart = (await ui()).autoRipple;
    await stop(session); session = await start({ shellDir, project, isoDir, port, keepState: true });
    o.afterRestart = (await ui()).autoRipple;
    b = await btn(); await realClick(session.cdp, b.x, b.y); await sleep(1200); o.offAgain = (await ui()).autoRipple;
    await stop(session); session = await start({ shellDir, project, isoDir, port, keepState: true });
    o.afterSecondRestart = (await ui()).autoRipple;
});
await step('ruler_drag_esc_altx_x', async o => {
    const a = await xyAt(8), b = await xyAt(12);
    await realDrag(session.cdp, [a, b]); await sleep(400); o.drag = await ui(); await shot('10-ruler-drag');
    await k('esc'); await sleep(300); o.afterEsc = await ui();
    await seek(5); o.clickOnly = await ui();
    await seek(8); await k('i'); await seek(12); await k('o'); await k('x', 1); await sleep(300); o.afterAltX = await ui();
    await seek(3); await k('x'); await sleep(300); o.x3s = await ui();
    await k('esc'); await seek(10); await clickAt(10.5, 'v-broll'); await k('x'); await sleep(300); o.xSelectedBroll = await ui();
    o.unchanged = await hash() === baseline;
});
await step('text_input', async o => {
    await seek(10);
    await ev(`(()=>{const i=document.createElement('input');i.id='tl-cut-commands-input';Object.assign(i.style,{position:'fixed',left:'60px',top:'60px',zIndex:'20000'});document.body.appendChild(i);return true})()`);
    const p = await ev(`(()=>{const r=document.getElementById('tl-cut-commands-input').getBoundingClientRect();return{x:r.left+5,y:r.top+5}})()`);
    await realClick(session.cdp, p.x, p.y); await sleep(200); const before = await ui();
    for (const name of ['i', 'o', 'x', 'q', 'w']) await press(...keys[name], 0, name);
    await sleep(600); const after = await ui();
    o.value = await ev(`document.getElementById('tl-cut-commands-input').value`);
    o.byteEqual = await hash() === baseline; o.rangeSame = JSON.stringify(before.rangeBands) === JSON.stringify(after.rangeBands);
    o.playheadSame = before.playhead === after.playhead; o.after = after;
    await ev(`document.getElementById('tl-cut-commands-input').remove()`);
});
await step('regression_tools_snap', async o => {
    await k('b'); await sleep(200); o.afterB = (await ui()).tool; await k('v'); await sleep(200); o.afterV = (await ui()).tool;
    o.snapBefore = await ev(`document.querySelector('#akari-annotations-widget .codicon-magnet')?.closest('button')?.getAttribute('aria-pressed')`);
    await press('m', 'KeyM', 77); await sleep(300);
    o.snapAfter = await ev(`document.querySelector('#akari-annotations-widget .codicon-magnet')?.closest('button')?.getAttribute('aria-pressed')`);
    await press('m', 'KeyM', 77); await sleep(300);
    o.snapRestored = await ev(`document.querySelector('#akari-annotations-widget .codicon-magnet')?.closest('button')?.getAttribute('aria-pressed')`);
    await clickAt(10, 'v-broll'); await k('del'); o.plainDeleteChanged = await waitChange(baseline); o.plainDeleteTracks = await view();
});
await step('settings_shortcuts', async o => {
    await ev(command('akari.settings.open', { section: 'shortcuts' })).catch(e => { o.openError = String(e); });
    await sleep(2500);
    const labels = ['範囲の入口を打つ', '範囲の出口を打つ', 'クリップの長さを範囲にする', '範囲を解除', '詰めて消す', '自動で詰める', '前の切れ目まで詰める', '次の切れ目まで詰める', '再生ヘッドで分割'];
    o.found = await ev(`(()=>{const t=document.body.innerText;return ${S(labels)}.map(l=>[l,t.includes(l)])})()`);
    o.conflictText = await ev(`(()=>[...document.querySelectorAll('[class*="conflict"],[data-conflict]')].map(e=>e.textContent.trim().slice(0,80)).slice(0,10))()`);
    await shot('11-settings-shortcuts');
});
await step('blocked_message', async o => {
    await clickAt(10, 'v-broll'); await k('del', 8);
    o.status = await statusTexts(); o.tracks = await view();
});
await step('seek_after_Q', async o => {
    await seek(10); await k('q'); await waitChange(baseline); o.afterQ = (await ui()).playhead;
    await undo(); o.afterUndo = (await ui()).playhead;
    const seq = []; for (let i = 0; i < 4; i++) { await seek(10); seq.push((await ui()).playhead); await sleep(500); seq.push((await ui()).playhead); }
    o.seekSeq = seq;
});
await step('cmdB_left_panel_open', async o => {
    await ev(`(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);s.expandPanel('left');return true})()`);
    await sleep(800); await seek(10); o.before = (await ui()).leftPanel;
    await k('b', 4); o.changed = await waitChange(baseline); o.after = (await ui()).leftPanel; o.tracks = await view();
    await undo(); o.undoByteEqual = await hash() === baseline;
    await ev(`(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);s.collapsePanel('left');return true})()`);
});
await step('settings_conflicts', async o => {
    await session.cdp.send('Runtime.evaluate', { expression: command('akari.settings.open', { section: 'shortcuts' }), awaitPromise: false });
    await sleep(3000);
    o.rows = await ev(`(()=>{const out=[];for(const b of document.querySelectorAll('*')){if(b.children.length===0&&b.textContent.trim()==='重なり'){let r=b;for(let i=0;i<6&&r;i++){if(r.textContent.length>b.textContent.length+2&&r.querySelectorAll('kbd,[class*="key"]').length)break;r=r.parentElement}out.push((r||b.parentElement).textContent.replace(/\s+/g,' ').trim().slice(0,90))}}return out})()`);
    await shot('12-settings-conflicts');
});
record.finalHash = await hash(); record.finalByteEqual = record.finalHash === baseline;
await save(); await stop(session);
console.log('done');
