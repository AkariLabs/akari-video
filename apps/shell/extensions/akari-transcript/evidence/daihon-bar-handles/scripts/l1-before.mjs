#!/usr/bin/env node
// 手順 0（BEFORE）: 置いた文字の札をクリック → 下端のカードの項目、右クリックメニューの項目、
// 棒（4px）の中心と中心から左右 4px 外をクリックしたときに選択されるかを実機で記録する。
// 使い方: node l1-before.mjs <fixture dir> [--port=9461]
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { command, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval, evalOn, realClick, pressKey, S } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-bar-handles-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9461);
const RUNS = path.join(os.tmpdir(), 'daihon-bar-handles-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-before.json');
const out = { phase: 'before', status: 'running', observations: {} };

const TAG = id => `.akari-daihon-placed-tag[data-caption-id="${id}"]`;
const BAR = (row, id) => `.akari-daihon-row[data-caption-id="${row}"] .akari-daihon-placed-bar[data-caption-id="${id}"]`;
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,left:r.left}})()`;
const STATE = `(()=>{const ed=document.querySelector('.akari-daihon-placed-editor');const sel=[...document.querySelectorAll('.akari-daihon-placed-tag.selected')].map(e=>e.dataset.captionId);return{selected:sel,editorOpen:Boolean(ed&&!ed.hidden),editorFor:ed&&!ed.hidden?ed.dataset.captionId:null,editorButtons:ed&&!ed.hidden?[...ed.querySelectorAll('button')].map(b=>({action:b.dataset.action??null,label:b.textContent,disabled:b.disabled})):[],editorText:ed&&!ed.hidden?ed.textContent:null,handles:document.querySelectorAll('[class*="placed-handle"]').length}})()`;
const HIT = (x, y) => `(()=>{const e=document.elementFromPoint(${x},${y});return e?{tag:e.tagName,cls:String(e.className),captionId:e.dataset?.captionId??null}:null})()`;
const BAR_CSS = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;const cs=getComputedStyle(e);const b=getComputedStyle(e,'::before');return{width:cs.width,background:cs.backgroundColor,borderRadius:cs.borderRadius,beforeContent:b.content,beforeInset:[b.top,b.right,b.bottom,b.left].join(' ')}})()`;

async function escape(cdp) { await pressKey(cdp, 'Escape', 'Escape', 27, 0); await sleep(400); }

async function clickBarAt(cdp, label, sel, dx) {
    const p = await evalOn(cdp, center(sel));
    await sleep(200);
    const q = await evalOn(cdp, center(sel));
    const x = q.x + dx, y = q.y;
    const hit = await evalOn(cdp, HIT(x, y));
    await realClick(cdp, x, y);
    await sleep(600);
    const state = await evalOn(cdp, STATE);
    return { label, dx, bar: { width: p.width, height: p.height, left: q.left }, point: { x, y }, elementAtPoint: hit, ...state };
}

try {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'placed'), port: PORT, isoDir: path.join(RUNS, 'before-placed') });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-placed-tag').length>=4`, { label: 'placed tags', timeoutMs: 240_000 });
        await sleep(1500);

        // 札クリック → 下端のカード
        const t = await evalOn(cdp, center(TAG('p-b')));
        await realClick(cdp, t.x, t.y);
        await sleep(700);
        out.observations.tagClick = await evalOn(cdp, STATE);
        await screenshot(cdp, path.join(ROOT, 'before-01-card.png'));
        await escape(cdp);

        // 右クリックメニュー
        const r = await evalOn(cdp, center(TAG('p-b')));
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'right', buttons: 2, clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'right', buttons: 0, clickCount: 1 });
        await sleep(600);
        out.observations.contextMenu = await evalOn(cdp, `[...document.querySelectorAll('.akari-daihon-placed-menu button')].map(b=>b.textContent)`);
        await screenshot(cdp, path.join(ROOT, 'before-02-menu.png'));
        await escape(cdp); await escape(cdp);

        // 棒（p-b の 2 行目 s-3）の見た目と当たり判定
        out.observations.barCss = await evalOn(cdp, BAR_CSS(BAR('s-3', 'p-b')));
        out.observations.barClicks = [];
        for (const dx of [0, -4, 4]) {
            out.observations.barClicks.push(await clickBarAt(cdp, `p-b bar center${dx ? ` ${dx > 0 ? '+' : ''}${dx}px` : ''}`, BAR('s-3', 'p-b'), dx));
            if (dx === 0) await screenshot(cdp, path.join(ROOT, 'before-03-bar-click.png'));
            await escape(cdp);
            await evalOn(cdp, `(()=>{const w=document.querySelector('.akari-daihon-placed-tag.selected');return true})()`);
        }
        await saveJson(RESULTS, out);
    } finally { await stop(session); }

    const none = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'none'), port: PORT, isoDir: path.join(RUNS, 'before-none') });
    try {
        await evalOn(none.cdp, command('akari.daihon.open'));
        await waitEval(none.cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: 'daihon rows', timeoutMs: 240_000 });
        await sleep(1500);
        out.observations.none = await evalOn(none.cdp, `(()=>{const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height)}};const ed=document.querySelector('.akari-daihon-placed-editor');return{head:box(document.querySelector('.akari-daihon-head')),rows:box(document.querySelector('.akari-daihon-rows')),editorHidden:ed?ed.hidden:null,bars:document.querySelectorAll('.akari-daihon-placed-bar').length,rowBoxes:[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,...box(r),paddingLeft:getComputedStyle(r).paddingLeft}))}})()`);
        await screenshot(none.cdp, path.join(ROOT, 'before-04-none.png'));
    } finally { await stop(none); }
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, card: out.observations.tagClick?.editorButtons?.map(b => b.label), menu: out.observations.contextMenu, barCss: out.observations.barCss, bars: out.observations.barClicks?.map(c => ({ dx: c.dx, hit: c.elementAtPoint?.cls, selected: c.selected, editorFor: c.editorFor })), error: out.error })}\n`);
