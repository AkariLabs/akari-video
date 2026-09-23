#!/usr/bin/env node
// BEFORE（変更前ビルド）: 台本の操作がどこに出るかと、出たときに行の top がずれる量を記録する。
//   a 話した言葉の行: 行のクリック / ヘッダーの「テンプレ」/ 単語のクリック（浮きバー → テンプレ）/ 行の ⚙ / 単語の右クリック
//   b 置いた文字の札: クリックで出る範囲エディタのカードの中身と高さ / 札の右クリック
// 使い方: node l1-before.mjs <fixture dir> [--port=9473]
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, clickSelector, command, evalOn, launch, pressKey, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-dock-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9473);
const RUNS = path.join(os.tmpdir(), 'daihon-dock-surface-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-before.json');
const out = { phase: 'before', status: 'running', observations: {}, screenshots: [] };

const px = 'const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height),width:px(r.width)}};';
const TOPS = `(()=>{${px}return[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,top:px(r.getBoundingClientRect().top),height:px(r.getBoundingClientRect().height)}))})()`;
// 画面に出ている操作面（浮きポップ・範囲エディタ・選択バー・右クリックメニュー）。
const SURFACES = `(()=>{${px}const vis=e=>e&&!e.hidden&&e.getBoundingClientRect().height>0;const rows=document.querySelector('.akari-daihon-rows');
 const pops=[...document.querySelectorAll('.akari-daihon-pop')].filter(vis).map(p=>({className:p.className,box:box(p),insideRows:rows?rows.contains(p):null,parent:p.parentElement?.tagName??null,position:getComputedStyle(p).position,
   title:(p.querySelector('.akari-daihon-pttl')?.textContent||'').trim()||null,buttons:[...p.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).filter(Boolean),cards:[...p.querySelectorAll('.akari-daihon-tplcard')].map(c=>(c.querySelector('.tname')?.textContent||'').trim()),text:(p.textContent||'').trim().slice(0,400)}));
 const ed=document.querySelector('.akari-daihon-placed-editor');const sel=document.querySelector('.akari-daihon-selbar');
 const menus=[...document.querySelectorAll('.akari-daihon-wordmenu, [class*=word-context], [class*=wordmenu], .p-Menu, .lm-Menu')].filter(vis).map(m=>({className:String(m.className),box:box(m),items:[...m.querySelectorAll('button,[role=menuitem],.lm-Menu-item,li')].map(i=>(i.textContent||'').trim()).filter(Boolean)}));
 const inRow=[...document.querySelectorAll('.akari-daihon-row .akari-daihon-tplgrid, .akari-daihon-row .akari-daihon-pop, .akari-daihon-rows > :not(.akari-daihon-row)')].filter(vis).map(e=>String(e.className));
 return{pops,editor:vis(ed)?{box:box(ed),text:(ed.textContent||'').trim(),buttons:[...ed.querySelectorAll('button')].map(b=>(b.textContent||'').trim()),children:[...ed.children].map(c=>c.className)}:null,
  selectionBar:vis(sel)?{box:box(sel),buttons:[...sel.querySelectorAll('button')].map(b=>(b.textContent||'').trim())}:null,menus,inRowsNonRow:inRow,
  widget:box(document.querySelector('.akari-daihon-widget')),rowsBox:box(rows),head:box(document.querySelector('.akari-daihon-head')),
  headButtons:[...document.querySelectorAll('.akari-daihon-head button')].map(b=>(b.textContent||'').trim())}})()`;
const shift = (before, after) => after.map((row, i) => ({ id: row.id, dTop: Math.round((row.top - (before[i]?.top ?? NaN)) * 100) / 100, dHeight: Math.round((row.height - (before[i]?.height ?? NaN)) * 100) / 100 }));
const maxAbs = list => list.reduce((m, r) => Math.max(m, Math.abs(r.dTop), Math.abs(r.dHeight)), 0);
async function shot(cdp, name) { await sleep(400); await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); }
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
async function rightClick(cdp, selector) {
    const p = await evalOn(cdp, center(selector));
    if (!p) throw new Error(`${selector} not found`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
}
const escape = async cdp => { await pressKey(cdp, 'Escape', 'Escape', 27, 0); await sleep(400); await evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(n=>n.remove());return true})()`); await sleep(200); };
async function observe(cdp, name, idle, action, screenshotName) {
    await action();
    await sleep(900);
    const tops = await evalOn(cdp, TOPS);
    const surfaces = await evalOn(cdp, SURFACES);
    const rowShift = shift(idle, tops);
    out.observations[name] = { surfaces, rowShift, maxRowShiftPx: maxAbs(rowShift) };
    if (screenshotName) await shot(cdp, screenshotName);
    await saveJson(RESULTS, out);
}
const ROW = id => `.akari-daihon-row[data-caption-id="${id}"]`;

try {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'dock'), port: PORT, isoDir: path.join(RUNS, 'before-dock') });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=8&&document.querySelectorAll('.akari-daihon-placed-tag').length>=2`, { label: 'daihon rows', timeoutMs: 240_000 });
        await sleep(2500);
        const idle = await evalOn(cdp, TOPS);
        out.observations.idle = { tops: idle, surfaces: await evalOn(cdp, SURFACES) };
        await shot(cdp, 'before-00-idle.png');

        // a-1 行の本文の余白をクリック（語でも時刻でもない所）
        await observe(cdp, 'a1_rowClick', idle, async () => {
            const p = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(ROW('c-0003'))});r.scrollIntoView({block:'nearest'});const b=r.getBoundingClientRect();return{x:b.right-12,y:b.top+b.height-6}})()`);
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
        }, 'before-01-row-click.png');
        // a-1b Shift+クリック（範囲選択 = 選択バー）
        await observe(cdp, 'a1b_rowShiftClick', idle, async () => {
            const p = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(ROW('c-0003'))}).getBoundingClientRect();return{x:b.right-12,y:b.top+b.height-6}})()`);
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
        }, 'before-02-row-selected.png');
        // a-2 ヘッダーの「テンプレ」
        await observe(cdp, 'a2_headerTemplate', idle, () => clickSelector(cdp, '.akari-daihon-tpl'), 'before-03-header-template.png');
        await escape(cdp);
        await evalOn(cdp, `(()=>{document.querySelector('.akari-daihon-selclear')?.click();return true})()`);
        await sleep(500);
        // a-3 単語のクリック → 浮きバー
        await observe(cdp, 'a3_wordClick', idle, () => clickSelector(cdp, `${ROW('c-0003')} .akari-daihon-word[data-word-index="1"]`), 'before-04-word-bar.png');
        // a-3b 浮きバーの「テンプレ」→ 単語のテンプレ
        await observe(cdp, 'a3b_wordTemplate', idle, async () => {
            const clicked = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-wordbar button')].find(x=>(x.textContent||'').includes('テンプレ'));if(!b)return false;b.click();return true})()`);
            out.observations.wordBarTemplateButton = clicked;
        }, 'before-05-word-template.png');
        await escape(cdp);
        // a-4 行の ⚙（字幕設定）
        await observe(cdp, 'a4_rowGear', idle, () => clickSelector(cdp, `${ROW('c-0003')} .akari-daihon-gear`), 'before-06-row-gear.png');
        await escape(cdp);
        // a-5 単語の右クリック
        await observe(cdp, 'a5_wordContextMenu', idle, () => rightClick(cdp, `${ROW('c-0003')} .akari-daihon-word[data-word-index="1"]`), 'before-07-word-context.png');
        await escape(cdp);
        // b-1 置いた文字の札のクリック → 範囲エディタのカード
        await observe(cdp, 'b1_placedTagClick', idle, () => clickSelector(cdp, '.akari-daihon-placed-tag[data-caption-id="c-0102"]'), 'before-08-placed-editor.png');
        // b-2 札の右クリック
        await observe(cdp, 'b2_placedContextMenu', idle, () => rightClick(cdp, '.akari-daihon-placed-tag[data-caption-id="c-0102"]'), 'before-09-placed-context.png');
        await escape(cdp);
    } finally { await stop(session); }
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
const summary = Object.fromEntries(Object.entries(out.observations).filter(([, v]) => v && typeof v === 'object' && 'maxRowShiftPx' in v)
    .map(([k, v]) => [k, { shift: v.maxRowShiftPx, pops: v.surfaces.pops.map(p => p.className), editor: v.surfaces.editor?.box?.height ?? null, menus: v.surfaces.menus.length }]));
process.stdout.write(`${JSON.stringify({ status: out.status, summary, error: out.error })}\n`);
