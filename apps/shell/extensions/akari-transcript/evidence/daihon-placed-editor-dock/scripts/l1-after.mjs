#!/usr/bin/env node
// AFTER（変更後ビルド）: 範囲エディタの下端固定・札の右クリックメニュー・札のダブルクリック編集・
// 札のドラッグで行を移動、を実機で確かめる。
// 使い方: node l1-after.mjs <fixture dir> [--port=9453]
// fixture は gen-fixture.mjs で作る（placed = 話した言葉 8 行 + 置いた文字 4 本 / none = 置いた文字 0 本）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-placed-editor-dock-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9453);
const RUNS = path.join(os.tmpdir(), 'daihon-placed-editor-dock-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-after.json');
const out = { phase: 'after', status: 'running', checks: [], screenshots: [] };
const META = 4;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try {
        record.detail = await operation();
        record.pass = true;
    } catch (error) {
        record.error = sanitize(error, REPO);
        throw error;
    } finally { await saveJson(RESULTS, out); }
    return record.detail;
}
async function shot(cdp, name) {
    await sleep(400);
    await screenshot(cdp, path.join(ROOT, name));
    out.screenshots.push(name);
}
const rawOf = project => readFile(path.join(project, 'captions.json'), 'utf8');
const captionsOf = async project => JSON.parse(await rawOf(project));
const byId = (captions, id) => captions.find(caption => caption.id === id);
async function waitRaw(project, predicate, label) {
    const deadline = Date.now() + 30_000;
    let last;
    while (Date.now() < deadline) {
        try { last = await rawOf(project); if (predicate(last, JSON.parse(last))) return last; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}
const round = v => Math.round(v * 100) / 100;
const LAYOUT = `(()=>{const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height)}};const ed=document.querySelector('.akari-daihon-placed-editor');const rows=document.querySelector('.akari-daihon-rows');const cs=ed?getComputedStyle(ed):null;return{widget:box(document.querySelector('.akari-daihon-widget')),head:box(document.querySelector('.akari-daihon-head')),rows:box(rows),footer:box(document.querySelector('.akari-daihon-footer')),editor:ed&&!ed.hidden?box(ed):null,editorHidden:ed?ed.hidden:null,editorFor:ed&&!ed.hidden?ed.dataset.captionId:null,editorAfterRows:Boolean(ed&&rows&&(rows.compareDocumentPosition(ed)&Node.DOCUMENT_POSITION_FOLLOWING)),editorInsideRows:Boolean(ed&&rows&&rows.contains(ed)),animation:cs?{name:cs.animationName,duration:cs.animationDuration}:null,rowTops:[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,top:px(r.getBoundingClientRect().top)}))}})()`;
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
const TAG = id => `.akari-daihon-placed-tag[data-caption-id="${id}"]`;
const ROW_TEXT = id => `.akari-daihon-row[data-caption-id="${id}"] .akari-daihon-row-text`;
const shift = (a, b) => b.rowTops.map((row, i) => round(row.top - a.rowTops[i].top));
async function clickAt(cdp, selector, opts) {
    const p = await waitEval(cdp, center(selector), { label: `${selector} center`, timeoutMs: 15_000 });
    await realClick(cdp, p.x, p.y, opts);
}
async function rightClick(cdp, selector) {
    const p = await waitEval(cdp, center(selector), { label: `${selector} center`, timeoutMs: 15_000 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
}
// 札を掴んで行へ落とす。途中で落とし先のハイライトを記録する。
async function drag(cdp, fromSelector, toSelector, { onHover } = {}) {
    const from = await waitEval(cdp, center(fromSelector), { label: 'drag from' });
    const to = toSelector.x !== undefined ? toSelector : await waitEval(cdp, center(toSelector), { label: 'drag to' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 14; step++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 14, y: from.y + (to.y - from.y) * step / 14, button: 'left', buttons: 1 });
        await sleep(40);
    }
    const hover = onHover ? await onHover() : undefined;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    return hover;
}
const DROP_TARGETS = `[...document.querySelectorAll('.akari-daihon-row.placed-drop-target')].map(r=>({id:r.dataset.captionId,outline:getComputedStyle(r).outlineColor,background:getComputedStyle(r).backgroundColor}))`;
const escape = cdp => pressKey(cdp, 'Escape', 'Escape', 27, 0);
const undo = cdp => pressKey(cdp, 'z', 'KeyZ', 90, META);
const barsOf = id => `[...document.querySelectorAll('.akari-daihon-placed-bar[data-caption-id="${id}"]')].map(b=>b.closest('.akari-daihon-row').dataset.captionId)`;

try {
    const project = path.join(FIXTURE, 'placed');
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(RUNS, 'after-placed') });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-placed-tag').length===4`, { label: 'placed tags', timeoutMs: 240_000 });
        await sleep(1500);
        const idle = await evalOn(cdp, LAYOUT);

        await check('札クリック: すべての行の top が変わらず、エディタは台本パネルの下端（行リストの下・footer の上）に出る', async () => {
            await clickAt(cdp, TAG('p-b'));
            await waitEval(cdp, `(()=>{const e=document.querySelector('.akari-daihon-placed-editor');return e&&!e.hidden&&e.dataset.captionId==='p-b'})()`, { label: 'editor p-b' });
            await sleep(500);
            const selected = await evalOn(cdp, LAYOUT);
            await shot(cdp, 'after-01-editor-dock.png');
            const deltas = shift(idle, selected);
            assert(deltas.every(d => d === 0), `row top shift ${deltas}`);
            assert(selected.editorAfterRows && !selected.editorInsideRows, 'editor DOM order');
            assert(selected.editor.top >= selected.rows.bottom - 0.5, `editor overlaps rows ${selected.editor.top} < ${selected.rows.bottom}`);
            assert(Math.abs(selected.editor.bottom - selected.footer.top) <= 0.5, `editor not docked above footer ${selected.editor.bottom} vs ${selected.footer.top}`);
            assert(selected.rows.top === idle.rows.top, 'rows top moved');
            return { rowTopShift: deltas, head: selected.head, rows: selected.rows, editor: selected.editor, footer: selected.footer, widget: selected.widget, rowsBottomBefore: idle.rows.bottom, animation: selected.animation, editorAfterRows: selected.editorAfterRows };
        });

        await check('Esc でエディタが閉じる（行の top は変わらない）', async () => {
            await escape(cdp);
            await waitEval(cdp, `document.querySelector('.akari-daihon-placed-editor').hidden`, { label: 'editor hidden' });
            const closed = await evalOn(cdp, LAYOUT);
            assert(shift(idle, closed).every(d => d === 0), 'row top shift after close');
            assert(closed.rows.bottom === idle.rows.bottom, 'rows height restored');
            return { editorHidden: closed.editorHidden, rowTopShift: shift(idle, closed) };
        });

        await check('札の再クリック・何もない所のクリックでも閉じる', async () => {
            await clickAt(cdp, TAG('p-b'));
            await waitEval(cdp, `!document.querySelector('.akari-daihon-placed-editor').hidden`, { label: 'open' });
            await sleep(600);
            await clickAt(cdp, TAG('p-b'));
            await waitEval(cdp, `document.querySelector('.akari-daihon-placed-editor').hidden`, { label: 'closed by re-click' });
            await sleep(600);
            await clickAt(cdp, TAG('p-b'));
            await waitEval(cdp, `!document.querySelector('.akari-daihon-placed-editor').hidden`, { label: 'open again' });
            await sleep(600);
            const blank = await evalOn(cdp, `(()=>{const r=document.querySelector('.akari-daihon-rows').getBoundingClientRect();const last=[...document.querySelectorAll('.akari-daihon-row')].at(-1).getBoundingClientRect();return{x:r.left+r.width/2,y:Math.min(r.bottom-6,last.bottom+20)}})()`);
            await realClick(cdp, blank.x, blank.y);
            await waitEval(cdp, `document.querySelector('.akari-daihon-placed-editor').hidden`, { label: 'closed by blank click' });
            return { reClick: 'closed', blankClick: { ...blank, closed: true } };
        });

        await check('札の右クリックで 7 項目、「後ろへ 1 行広げる」で end が次の行の終わり → Cmd+Z 1 手で byte 一致', async () => {
            const before = await rawOf(project);
            await rightClick(cdp, TAG('p-b'));
            await waitEval(cdp, `document.querySelectorAll('.akari-daihon-placed-menu button').length>0`, { label: 'placed menu' });
            const items = await evalOn(cdp, `[...document.querySelectorAll('.akari-daihon-placed-menu button')].map(b=>({action:b.dataset.action,label:b.textContent,disabled:b.disabled}))`);
            await shot(cdp, 'after-02-context-menu.png');
            assert(S(items.map(i => i.label)) === S(['前へ 1 行広げる', '前を 1 行縮める', '後ろへ 1 行広げる', '後ろを 1 行縮める', '全体', '文字を編集', '削除']), S(items));
            const layout = await evalOn(cdp, LAYOUT);
            assert(shift(idle, layout).every(d => d === 0), 'row tops moved with menu');
            await clickAt(cdp, '.akari-daihon-placed-menu [data-action="expand-end"]');
            const afterRaw = await waitRaw(project, (_, list) => byId(list, 'p-b').end === 19.2, 'p-b end 19.2');
            await waitEval(cdp, `${barsOf('p-b')}.length===4`, { label: 'p-b 4 bars' });
            const bars = await evalOn(cdp, barsOf('p-b'));
            await shot(cdp, 'after-03-menu-expand-end.png');
            const pb = byId(JSON.parse(afterRaw), 'p-b');
            await undo(cdp);
            const undone = await waitRaw(project, raw => raw === before, 'byte-identical after undo');
            await waitEval(cdp, `${barsOf('p-b')}.length===3`, { label: 'p-b 3 bars' });
            return { items, after: { start: pb.start, end: pb.end }, bars, undoByteIdentical: undone === before };
        });

        await check('札のダブルクリック → 入力欄 → Enter で text が変わる → Cmd+Z 1 手で byte 一致', async () => {
            await escape(cdp);
            await sleep(300);
            const before = await rawOf(project);
            const tagBox = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(TAG('p-c'))}).getBoundingClientRect();return{top:r.top,left:r.left}})()`);
            await clickAt(cdp, TAG('p-c'), { clickCount: 2 });
            await waitEval(cdp, `document.activeElement?.closest?.('.akari-daihon-placed-inline-edit')&&document.activeElement.tagName==='INPUT'`, { label: 'inline input focused' });
            const editing = await evalOn(cdp, `(()=>{const a=document.activeElement;const e=a.closest('.akari-daihon-placed-inline-edit');const r=e.getBoundingClientRect();return{value:a.value,row:a.closest('.akari-daihon-row')?.dataset.captionId,className:e.className,top:r.top,left:r.left,selected:[a.selectionStart,a.selectionEnd]}})()`);
            await shot(cdp, 'after-04-dblclick-input.png');
            assert(editing.value === '蒸らし 30 秒' && editing.row === 's-5', S(editing));
            await cdp.send('Input.insertText', { text: '蒸らしは 40 秒' });
            await pressKey(cdp, 'Enter', 'Enter', 13, 0);
            const afterRaw = await waitRaw(project, (_, list) => byId(list, 'p-c').text === '蒸らしは 40 秒', 'p-c text changed');
            await waitEval(cdp, `document.querySelector(${S(TAG('p-c'))})?.textContent==='T 蒸らしは 40 秒'`, { label: 'tag text updated' });
            await shot(cdp, 'after-05-text-saved.png');
            const pc = byId(JSON.parse(afterRaw), 'p-c');
            await undo(cdp);
            const undone = await waitRaw(project, raw => raw === before, 'byte-identical after undo');
            await waitEval(cdp, `document.querySelector(${S(TAG('p-c'))})?.textContent==='T 蒸らし 30 秒'`, { label: 'tag text restored' });
            return { tagBox, editing, saved: { text: pc.text, start: pc.start, end: pc.end, time_domain: pc.time_domain }, undoByteIdentical: undone === before };
        });

        await check('ダブルクリック編集の Esc は取消・空文字は保存しない', async () => {
            await escape(cdp);
            await sleep(300);
            const before = await rawOf(project);
            await clickAt(cdp, TAG('p-c'), { clickCount: 2 });
            await waitEval(cdp, `document.activeElement?.closest?.('.akari-daihon-placed-inline-edit')`, { label: 'inline input (esc)' });
            await cdp.send('Input.insertText', { text: '取り消す文字' });
            await escape(cdp);
            await waitEval(cdp, `!document.querySelector('.akari-daihon-placed-inline-edit')&&document.querySelector(${S(TAG('p-c'))})?.textContent==='T 蒸らし 30 秒'`, { label: 'cancelled' });
            await sleep(800);
            const afterEsc = await rawOf(project);
            await clickAt(cdp, TAG('p-c'), { clickCount: 2 });
            await waitEval(cdp, `document.activeElement?.closest?.('.akari-daihon-placed-inline-edit')`, { label: 'inline input (empty)' });
            await pressKey(cdp, 'Backspace', 'Backspace', 8, 0);
            const emptied = await evalOn(cdp, `document.activeElement.value`);
            await pressKey(cdp, 'Enter', 'Enter', 13, 0);
            await waitEval(cdp, `!document.querySelector('.akari-daihon-placed-inline-edit')&&document.querySelector(${S(TAG('p-c'))})?.textContent==='T 蒸らし 30 秒'`, { label: 'empty reverted' });
            await sleep(800);
            const afterEmpty = await rawOf(project);
            const footer = await evalOn(cdp, `document.querySelector('.akari-daihon-footer')?.textContent`);
            assert(afterEsc === before && afterEmpty === before, 'captions.json changed');
            return { escUnchanged: afterEsc === before, emptiedValue: emptied, emptyUnchanged: afterEmpty === before, footer };
        });

        await check('札を 2 行下へドラッグ → start/end がその行の区間 → Cmd+Z 1 手で byte 一致', async () => {
            await escape(cdp);
            await sleep(300);
            const before = await rawOf(project);
            const hover = await drag(cdp, TAG('p-c'), ROW_TEXT('s-7'), {
                onHover: async () => { const targets = await evalOn(cdp, DROP_TARGETS); await screenshot(cdp, path.join(ROOT, 'after-06-dragging.png')); out.screenshots.push('after-06-dragging.png'); return targets; }
            });
            const afterRaw = await waitRaw(project, (_, list) => byId(list, 'p-c').start === 24 && byId(list, 'p-c').end === 27.2, 'p-c moved to s-7');
            await waitEval(cdp, `document.querySelector(${S(TAG('p-c'))})?.closest('.akari-daihon-row')?.dataset.captionId==='s-7'`, { label: 'tag on s-7' });
            await shot(cdp, 'after-07-dropped.png');
            const pc = byId(JSON.parse(afterRaw), 'p-c');
            assert(S(hover.map(t => t.id)) === S(['s-7']), `drop highlight ${S(hover)}`);
            const noTimeDomainChange = pc.time_domain === 'output';
            await undo(cdp);
            const undone = await waitRaw(project, raw => raw === before, 'byte-identical after undo');
            await waitEval(cdp, `document.querySelector(${S(TAG('p-c'))})?.closest('.akari-daihon-row')?.dataset.captionId==='s-5'`, { label: 'tag back on s-5' });
            return { from: { row: 's-5', start: 16.2, end: 19 }, dropRow: 's-7', dropHighlight: hover, after: { start: pc.start, end: pc.end, time_domain: pc.time_domain }, timeDomainKept: noTimeDomainChange, undoByteIdentical: undone === before };
        });

        await check('3 行の文字を落とすと落とした行から 3 行ぶん → Cmd+Z 1 手で byte 一致', async () => {
            const before = await rawOf(project);
            await drag(cdp, TAG('p-b'), ROW_TEXT('s-5'));
            const afterRaw = await waitRaw(project, (_, list) => byId(list, 'p-b').start === 16 && byId(list, 'p-b').end === 27.2, 'p-b moved to s-5..s-7');
            await waitEval(cdp, `${barsOf('p-b')}.length===3&&${barsOf('p-b')}[0]==='s-5'`, { label: 'p-b bars on s-5..s-7' });
            const bars = await evalOn(cdp, barsOf('p-b'));
            const tag = await evalOn(cdp, `document.querySelector(${S(TAG('p-b'))})?.textContent`);
            await shot(cdp, 'after-08-dropped-3rows.png');
            const pb = byId(JSON.parse(afterRaw), 'p-b');
            assert(S(bars) === S(['s-5', 's-6', 's-7']), S(bars));
            await undo(cdp);
            const undone = await waitRaw(project, raw => raw === before, 'byte-identical after undo');
            return { from: { rows: ['s-2', 's-3', 's-4'], start: 4, end: 15.2 }, after: { start: pb.start, end: pb.end }, bars, tag, undoByteIdentical: undone === before };
        });

        await check('行の外（ヘッダー）へ落としても何も起きない', async () => {
            const before = await rawOf(project);
            const head = await evalOn(cdp, `(()=>{const r=document.querySelector('.akari-daihon-head').getBoundingClientRect();return{x:r.left+40,y:r.top+14}})()`);
            await drag(cdp, TAG('p-c'), head);
            await sleep(1500);
            const after = await rawOf(project);
            const highlights = await evalOn(cdp, DROP_TARGETS);
            assert(after === before && highlights.length === 0, 'changed or highlight left');
            return { unchanged: after === before, leftoverHighlights: highlights.length };
        });
    } finally { await stop(session); }

    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'none'), port: PORT, isoDir: path.join(RUNS, 'after-none') });
    try {
        await evalOn(session.cdp, command('akari.daihon.open'));
        await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: 'daihon rows', timeoutMs: 240_000 });
        await sleep(1500);
        await check('置いた文字 0 本: 台本の見た目（行の top・行リスト・エディタ非表示）が BEFORE と同じ', async () => {
            const before = JSON.parse(await readFile(path.join(ROOT, 'results-before.json'), 'utf8')).observations.none;
            const now = await evalOn(session.cdp, LAYOUT);
            await shot(session.cdp, 'after-09-none.png');
            assert(S(now.rowTops) === S(before.rowTops), 'row tops differ');
            assert(S(now.rows) === S(before.rows) && S(now.head) === S(before.head), 'rows/head box differ');
            assert(now.editorHidden === true, 'editor visible');
            return { rowTops: now.rowTops.map(r => r.top), rows: now.rows, head: now.head, editorHidden: now.editorHidden };
        });
    } finally { await stop(session); }
    out.status = 'pass';
} catch (error) {
    out.status = 'fail';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, checks: out.checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`), error: out.error })}\n`);
