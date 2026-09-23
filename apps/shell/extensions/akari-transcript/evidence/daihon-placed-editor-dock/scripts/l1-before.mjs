#!/usr/bin/env node
// 手順 0（BEFORE）: 置いた文字の札をクリック → 範囲エディタの位置と行の top のずれ、
// 札のダブルクリック・札のドラッグで何が起きるかを実機で記録する。
// 使い方: node l1-before.mjs <fixture dir> [--port=9453]
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { command, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval, evalOn, realClick, S } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-placed-editor-dock-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9453);
const RUNS = path.join(os.tmpdir(), 'daihon-placed-editor-dock-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-before.json');
const out = { phase: 'before', status: 'running', observations: {} };

const LAYOUT = `(()=>{const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height)}};const w=document.querySelector('.akari-daihon-widget');const ed=document.querySelector('.akari-daihon-placed-editor');return{widget:box(w),head:box(document.querySelector('.akari-daihon-head')),rows:box(document.querySelector('.akari-daihon-rows')),editor:ed&&!ed.hidden?box(ed):null,editorHidden:ed?ed.hidden:null,editorText:ed&&!ed.hidden?ed.textContent:null,rowTops:[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,top:px(r.getBoundingClientRect().top)}))}})()`;
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
const TAG = id => `.akari-daihon-placed-tag[data-caption-id="${id}"]`;
const captionsOf = async name => JSON.parse(await readFile(path.join(FIXTURE, name, 'captions.json'), 'utf8'));

try {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'placed'), port: PORT, isoDir: path.join(RUNS, 'before-placed') });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-placed-tag').length>=4`, { label: 'placed tags', timeoutMs: 240_000 });
        await sleep(1500);
        const idle = await evalOn(cdp, LAYOUT);
        const p = await evalOn(cdp, center(TAG('p-b')));
        await realClick(cdp, p.x, p.y);
        await sleep(600);
        const selected = await evalOn(cdp, LAYOUT);
        await screenshot(cdp, path.join(ROOT, 'before-01-editor-top.png'));
        const shift = selected.rowTops.map((row, i) => ({ id: row.id, delta: Math.round((row.top - idle.rowTops[i].top) * 100) / 100 }));
        out.observations.click = {
            idle, selected, rowTopShift: shift,
            editorBelowHead: selected.editor && selected.head ? Math.round((selected.editor.top - selected.head.bottom) * 100) / 100 : null,
            editorAboveRows: selected.editor && selected.rows ? selected.editor.bottom <= selected.rows.top + 0.5 : null
        };
        await saveJson(RESULTS, out);

        // ダブルクリック: 札の場所に入力欄が出るか / captions.json は変わるか。
        const beforeDbl = await captionsOf('placed');
        const q = await evalOn(cdp, center(TAG('p-c')));
        await realClick(cdp, q.x, q.y, { clickCount: 2 });
        await sleep(800);
        out.observations.doubleClick = await evalOn(cdp, `(()=>{const a=document.activeElement;const tag=document.querySelector(${S(TAG('p-c'))});return{activeTag:a?.tagName??null,activeClass:a?.className??null,inputInsideTag:Boolean(tag&&tag.querySelector('input,textarea,[contenteditable="true"]')),inputsInRows:document.querySelectorAll('.akari-daihon-rows input, .akari-daihon-rows textarea, .akari-daihon-rows [contenteditable="true"]').length,tagStillButton:tag?.tagName??null,editorFor:document.querySelector('.akari-daihon-placed-editor')?.dataset.captionId??null}})()`);
        out.observations.doubleClick.captionsChanged = JSON.stringify(await captionsOf('placed')) !== JSON.stringify(beforeDbl);
        await screenshot(cdp, path.join(ROOT, 'before-02-dblclick.png'));
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(400);

        // ドラッグ: 札を掴んで 2 行下の行へ落とす。
        const beforeDrag = await captionsOf('placed');
        const from = await evalOn(cdp, center(TAG('p-c')));
        const to = await evalOn(cdp, center('.akari-daihon-row[data-caption-id="s-7"] .akari-daihon-row-text'));
        const draggable = await evalOn(cdp, `document.querySelector(${S(TAG('p-c'))})?.draggable??null`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let step = 1; step <= 12; step++) {
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12, button: 'left', buttons: 1 });
            await sleep(40);
        }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(1200);
        const afterDrag = await captionsOf('placed');
        const pc = list => list.find(c => c.id === 'p-c');
        out.observations.drag = { draggable, before: { start: pc(beforeDrag).start, end: pc(beforeDrag).end }, after: { start: pc(afterDrag).start, end: pc(afterDrag).end }, captionsChanged: JSON.stringify(afterDrag) !== JSON.stringify(beforeDrag) };
        await screenshot(cdp, path.join(ROOT, 'before-03-drag.png'));
    } finally { await stop(session); }

    const none = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'none'), port: PORT, isoDir: path.join(RUNS, 'before-none') });
    try {
        await evalOn(none.cdp, command('akari.daihon.open'));
        await waitEval(none.cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: 'daihon rows', timeoutMs: 240_000 });
        await sleep(1500);
        out.observations.none = await evalOn(none.cdp, LAYOUT);
        await screenshot(none.cdp, path.join(ROOT, 'before-04-none.png'));
    } finally { await stop(none); }
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, shift: out.observations.click?.rowTopShift, editorBelowHead: out.observations.click?.editorBelowHead, dbl: out.observations.doubleClick, drag: out.observations.drag, error: out.error })}\n`);
