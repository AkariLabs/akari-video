#!/usr/bin/env node
// 素材を掴んでタイムラインの行に重ね、置けない行の赤い枠（素材ゴースト）を採寸する（ラッパー作成の検証スクリプト）。
// プロジェクト面の素材カードの dragstart と同じもの（window CustomEvent 'akari.material.dragStart' + MIME application/x-akari-material の
// JSON ペイロード）を送り、CDP Input.dispatchDragEvent で dragEnter → dragOver ×3（各点）→ 最後の点で drop（または dragCancel）。
// 各点で: ゴーストの矩形・rejected クラス・border・文言・文言の行数（Range.getClientRects の行 top の数）・scrollHeight、ポインタ下の行ヘッダの矩形、フッター。
// 使い方: node dnd.mjs '<payload JSON>' "<x,y>[;<x,y>...]" <project> <out.json> [--lock=<trackId>] [--nodrop] [--undo] [--shot=<prefix>]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';

const [payloadJson, pts, project, outFile] = process.argv.slice(2);
const flag = name => process.argv.find(v => v.startsWith(`--${name}`));
const lock = flag('lock=')?.slice(7);
const shot = flag('shot=')?.slice(7);
const port = Number(process.env.CDP_PORT || 9459);
const EDIT = path.join(project, 'edit.json');
const sha = () => createHash('sha256').update(readFileSync(EDIT)).digest('hex');
const points = pts.split(';').filter(Boolean).map(p => p.split(',').map(Number));
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
const ev = expr => evalOn(cdp, expr);
const S = JSON.stringify;

const lockButton = id => `document.querySelector('.akari-track-header-row[data-akari-timeline-track-id=${S(id)}] button[data-akari-toggle="lock"]')`;
async function clickLock(id) {
    const p = await ev(`(()=>{const b=${lockButton(id)};const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,title:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed')}})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(500);
    return { before: p.title, after: await ev(`${lockButton(id)}.getAttribute('aria-label')`), pressedAfter: await ev(`${lockButton(id)}.getAttribute('aria-pressed')`) };
}

const tag = await ev(`(() => { const ind = document.querySelector('[data-testid="akari-track-insert-indicator"]'); const ov = ind.parentElement;
  let g = ov.querySelector('[data-tdp-material-ghost]');
  if (!g) { const c = [...ov.children].filter(e => e.tagName === 'DIV' && e.style.zIndex === '10' && /dashed/.test(e.style.border) && e.style.display === 'none'); if (c.length === 1) { g = c[0]; g.dataset.tdpMaterialGhost = '1'; } else return { tagged: false, candidates: c.length }; }
  return { tagged: true }; })()`);
if (!tag.tagged) { console.log('ghost not tagged', S(tag)); process.exit(1); }

const probe = `(() => {
  const px = v => Math.round(v * 10) / 10;
  const g = document.querySelector('[data-tdp-material-ghost]');
  const rect = e => { const r = e.getBoundingClientRect(); return { x: px(r.left), y: px(r.top), w: px(r.width), h: px(r.height) }; };
  let root = g; while (root && !root.classList.contains('akari-annotations-widget')) root = root.parentElement;
  const visible = g && g.style.display !== 'none';
  let lines = 0, textRect = null;
  if (visible && g.firstChild) {
    const range = document.createRange(); range.selectNodeContents(g);
    const tops = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)));
    lines = tops.size; const br = range.getBoundingClientRect(); textRect = { y: px(br.top), h: px(br.height), w: px(br.width) };
  }
  const cs = g && getComputedStyle(g);
  const gr = visible ? g.getBoundingClientRect() : null;
  const row = gr && [...document.querySelectorAll('.akari-track-header-row')].map(e => ({ e, r: e.getBoundingClientRect() }))
    .find(({ r }) => gr.top + gr.height / 2 >= r.top && gr.top + gr.height / 2 < r.bottom);
  return {
    ghost: visible ? { ...rect(g), rejected: g.classList.contains('akari-annotations-ghost-rejected'), border: g.style.border, outline: g.style.outline,
      background: g.style.background, color: cs.color, fontSize: cs.fontSize, lineHeight: cs.lineHeight, whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow,
      text: g.textContent, textLines: lines, textRect, scrollHeight: g.scrollHeight, clientHeight: g.clientHeight, textClipped: g.scrollHeight > g.clientHeight || g.scrollWidth > g.clientWidth } : null,
    row: row ? { trackId: row.e.dataset.akariTimelineTrackId, y: px(row.r.top), h: px(row.r.height) } : null,
    ghostMinusRowHeight: visible && row ? px(gr.height - row.r.height) : null,
    insertLine: document.querySelector('[data-testid="akari-track-insert-indicator"]').style.display === 'block',
    footer: root ? [...root.children].filter(c => c.tagName === 'DIV').pop().textContent.trim() : null
  };
})()`;

const rec = { payload: JSON.parse(payloadJson), points, at: new Date().toISOString(), shaBefore: sha(), hovers: [] };
if (lock) rec.lock = await clickLock(lock);
await ev(`(()=>{window.dispatchEvent(new CustomEvent('akari.material.dragStart',{detail:${payloadJson}}));return true})()`);
await sleep(800);
const data = { items: [{ mimeType: 'application/x-akari-material', data: payloadJson }], dragOperationsMask: 1 };
const send = (type, x, y) => cdp.send('Input.dispatchDragEvent', { type, x, y, data });
await send('dragEnter', ...points[0]);
for (const [x, y] of points) {
    for (let k = 0; k < 3; k++) { await send('dragOver', x, y); await sleep(150); }
    rec.hovers.push({ x, y, ...(await ev(probe)) });
    if (shot) await screenshot(cdp, `${shot}-${rec.hovers.length}.png`);
}
const [lx, ly] = points.at(-1);
await send(flag('nodrop') ? 'dragCancel' : 'drop', lx, ly);
await ev(`(()=>{window.dispatchEvent(new CustomEvent('akari.material.dragEnd'));return true})()`);
for (let i = 0; i < (flag('nodrop') ? 6 : Number(process.env.WAIT_TICKS || 60)) && sha() === rec.shaBefore; i++) await sleep(500);
await sleep(1500);
rec.editChanged = sha() !== rec.shaBefore;
rec.tracksAfter = JSON.parse(readFileSync(EDIT, 'utf8')).tracks.map(t => ({ id: t.id, lane: t.lane, items: t.items.map(i => `${i.id}@${i.at}+${i.duration}`) }));
rec.audioAfter = JSON.parse(readFileSync(EDIT, 'utf8')).audio ?? null;
rec.afterDrop = await ev(probe);
if (shot) await screenshot(cdp, `${shot}-after.png`);
if (flag('undo') && rec.editChanged) {
    await ev(`(()=>{document.activeElement?.blur?.();return true})()`);
    const r = await ev(`(()=>{const e=document.querySelector('.akari-annotations-widget');const r=e.getBoundingClientRect();return{x:r.left+r.width-40,y:r.top+r.height-60}})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await sleep(300);
    const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    for (let i = 0; i < 60 && sha() !== rec.shaBefore; i++) await sleep(500);
    rec.undo = { presses: 1, byteIdentical: sha() === rec.shaBefore };
}
if (lock) rec.unlock = await clickLock(lock);
writeFileSync(outFile, `${JSON.stringify(rec, null, 1)}\n`);
console.log(S({ hovers: rec.hovers.map(h => ({ g: h.ghost && { h: h.ghost.h, rej: h.ghost.rejected, lines: h.ghost.textLines, text: h.ghost.text }, row: h.row, d: h.ghostMinusRowHeight, footer: h.footer })), editChanged: rec.editChanged, undo: rec.undo, lock: rec.lock }));
cdp.close(); process.exit(0);
