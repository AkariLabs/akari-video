#!/usr/bin/env node
// 「文字」行の置いた文字のチップ（または任意の字幕チップ）を縦 + 横にドラッグして離し、captions.json / edit.json / チップの位置を記録する（ラッパー作成の検証スクリプト）。
// 離す直前にドラッグ中のゴースト・チップ・フッターも採る。--undo で Cmd+Z 1 手のあと captions.json / edit.json の byte 一致を確かめる。
// 使い方: node vdrag.mjs <project> <captionId|placed> <dx> <dy> <out.json> [--undo] [--shot=<prefix>]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';
import { CHIPS, ROW_LABELS } from './l1-common.mjs';

const [project, idArg, dxArg, dyArg, outFile] = process.argv.slice(2);
const flag = name => process.argv.find(v => v.startsWith(`--${name}`));
const shot = flag('shot=')?.slice(7);
const port = Number(process.env.CDP_PORT || 9459);
const read = f => readFileSync(path.join(project, f), 'utf8');
const sha = f => createHash('sha256').update(readFileSync(path.join(project, f))).digest('hex');
const captions = () => { const p = JSON.parse(read('captions.json')); return Array.isArray(p) ? p : p.captions; };
const id = idArg === 'placed' ? captions().find(c => c.time_domain === 'output').id : idArg;
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
const ev = expr => evalOn(cdp, expr);
const chip = async () => (await ev(CHIPS)).find(c => c.id === id);
const HEADERS = `[...document.querySelectorAll('.akari-track-header-row')].map(e=>{const r=e.getBoundingClientRect();return{trackId:e.dataset.akariTimelineTrackId,top:Math.round(r.top*10)/10,h:Math.round(r.height*10)/10}})`;
const DURING = `(()=>{const px=v=>Math.round(v*10)/10;const w=document.querySelector('.akari-annotations-widget');const gs=[...w.querySelectorAll('div')].filter(e=>e.style.opacity&&e.style.display!=='none'&&/dashed|solid/.test(e.style.border||e.style.borderStyle||'')&&e.getBoundingClientRect().width>0&&!e.dataset.akariItemId).map(e=>{const r=e.getBoundingClientRect();return{left:px(r.left),top:px(r.top),w:px(r.width),h:px(r.height),opacity:e.style.opacity,border:e.style.border}});const fb=[...w.querySelectorAll('div')].find(e=>e.style.display==='block'&&/–/.test(e.textContent)&&e.children.length===0);return{ghostCandidates:gs.slice(0,4),dragFeedback:fb?fb.textContent:null,footer:[...w.children].filter(c=>c.tagName==='DIV').pop().textContent.trim()}})()`;

const rec = { id, dx: Number(dxArg), dy: Number(dyArg), at: new Date().toISOString() };
const capBefore = read('captions.json'), editShaBefore = sha('edit.json');
rec.rowsBefore = await ev(HEADERS);
rec.labels = await ev(ROW_LABELS);
rec.chipBefore = await chip();
rec.captionBefore = captions().find(c => c.id === id);
const c = rec.chipBefore;
const x0 = c.left + Math.min(c.width / 2, 40), y0 = c.top + c.height / 2;
const x1 = x0 + rec.dx, y1 = y0 + rec.dy;
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' }); await sleep(60);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
const steps = 16;
for (let s = 1; s <= steps; s++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * s / steps, y: y0 + (y1 - y0) * s / steps, button: 'left', buttons: 1 });
    await sleep(30);
}
await sleep(300);
rec.during = { pointer: { x: x1, y: y1 }, ...(await ev(DURING)) };
if (shot) await screenshot(cdp, `${shot}-during.png`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
for (let i = 0; i < 20 && read('captions.json') === capBefore; i++) await sleep(250);
await sleep(1500);
rec.captionsChanged = read('captions.json') !== capBefore;
rec.editJsonByteEqual = sha('edit.json') === editShaBefore;
rec.captionAfter = captions().find(c => c.id === id) ?? null;
rec.otherCaptionsUnchanged = JSON.stringify(captions().filter(c => c.id !== id)) === JSON.stringify((JSON.parse(capBefore).captions ?? JSON.parse(capBefore)).filter(c => c.id !== id));
rec.chipAfter = await chip();
rec.footerAfter = (await ev(DURING)).footer;
if (shot) await screenshot(cdp, `${shot}-after.png`);
if (flag('undo') && (rec.captionsChanged || !rec.editJsonByteEqual)) {
    await ev(`(()=>{document.activeElement?.blur?.();return true})()`);
    const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    for (let i = 0; i < 40 && read('captions.json') !== capBefore; i++) await sleep(250);
    await sleep(1000);
    rec.undo = { presses: 1, captionsByteEqual: read('captions.json') === capBefore, editJsonByteEqual: sha('edit.json') === editShaBefore, chip: await chip() };
}
writeFileSync(outFile, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify({ id, before: rec.captionBefore && [rec.captionBefore.start, rec.captionBefore.end, rec.captionBefore.time_domain], after: rec.captionAfter && [rec.captionAfter.start, rec.captionAfter.end, rec.captionAfter.time_domain],
    chipBefore: c && [c.lane, c.top, c.left], chipAfter: rec.chipAfter && [rec.chipAfter.lane, rec.chipAfter.top, rec.chipAfter.left], during: rec.during, editJsonByteEqual: rec.editJsonByteEqual, others: rec.otherCaptionsUnchanged, undo: rec.undo && { c: rec.undo.captionsByteEqual, e: rec.undo.editJsonByteEqual } }));
cdp.close(); process.exit(0);
