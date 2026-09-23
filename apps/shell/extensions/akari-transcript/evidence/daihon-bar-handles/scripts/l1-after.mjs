#!/usr/bin/env node
// AFTER（変更後ビルド）: 棒の当たり判定（中心から左右 4px 外のクリックで選択）・選択中の棒の両端のつまみ
// （下を 1 行下へ / 上を 1 行上へ / 逆転しない / Cmd+Z 1 手で byte 一致）・1 行の文字のつまみ・
// 下端のカードと右クリックメニューの項目（数字のボタンなし・「全部の行に」）・置いた文字 0 本の見た目不変を実機で確かめる。
// つまみは選択中の棒と同じ列（.akari-daihon-placed-columns）に置かれる兄弟要素。中心の elementFromPoint がつまみ自身であることも見る。
// 使い方: node l1-after.mjs <fixture dir> [--port=9461]
// fixture は gen-fixture.mjs で作る（placed = 話した言葉 8 行（i*4 〜 i*4+3.2 秒）+ 置いた文字 4 本 / none = 置いた文字 0 本）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-bar-handles-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9461);
const RUNS = path.join(os.tmpdir(), 'daihon-bar-handles-l1', 'runs');
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
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        try { const raw = await rawOf(project); if (predicate(raw, JSON.parse(raw))) return raw; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}
const TAG = id => `.akari-daihon-placed-tag[data-caption-id="${id}"]`;
const BAR = (row, id) => `.akari-daihon-row[data-caption-id="${row}"] .akari-daihon-placed-bar[data-caption-id="${id}"]`;
const ROW = id => `.akari-daihon-row[data-caption-id="${id}"]`;
const box = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`;
const STATE = `(()=>{const ed=document.querySelector('.akari-daihon-placed-editor');return{selected:[...document.querySelectorAll('.akari-daihon-placed-tag.selected')].map(e=>e.dataset.captionId),editorFor:ed&&!ed.hidden?ed.dataset.captionId:null,editorButtons:ed&&!ed.hidden?[...ed.querySelectorAll('button')].map(b=>({action:b.dataset.action??null,label:b.textContent,disabled:b.disabled})):[],editorHelp:ed&&!ed.hidden?ed.querySelector('.akari-daihon-placed-help')?.textContent??null:null,editorText:ed&&!ed.hidden?ed.textContent:null}})()`;
const HANDLES = `[...document.querySelectorAll('.akari-daihon-placed-handle')].map(h=>{const r=h.getBoundingClientRect();const cs=getComputedStyle(h);const row=h.closest('.akari-daihon-row');const cols=h.closest('.akari-daihon-placed-columns');const ed=document.querySelector('.akari-daihon-placed-editor:not([hidden])');const bar=cols?cols.querySelector('.akari-daihon-placed-bar.selected'):null;const rr=row?.getBoundingClientRect();const br=bar?.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{edge:h.dataset.edge,row:row?.dataset.captionId??null,inColumns:Boolean(cols),hitSelf:hit===h,captionId:cols?ed?.dataset.captionId??null:h.closest('.akari-daihon-placed-single')?.querySelector('.akari-daihon-placed-tag')?.dataset.captionId??null,width:r.width,height:r.height,top:r.top,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2,rowTop:rr?.top??null,rowBottom:rr?.bottom??null,barTop:br?.top??null,barBottom:br?.bottom??null,cursor:cs.cursor,background:cs.backgroundColor,borderRadius:cs.borderRadius}})`;
const BARS_OF = id => `[...document.querySelectorAll('.akari-daihon-placed-bar[data-caption-id="${id}"]')].map(b=>b.closest('.akari-daihon-row')?.dataset.captionId)`;
const TAG_ROW = id => `document.querySelector(${S(TAG(id))})?.closest('.akari-daihon-row')?.dataset.captionId??null`;
const undo = cdp => pressKey(cdp, 'z', 'KeyZ', 90, META);
const escape = async cdp => { await pressKey(cdp, 'Escape', 'Escape', 27, 0); await sleep(400); };
async function rightClick(cdp, selector) {
    const p = await waitEval(cdp, box(selector), { label: `${selector} box`, timeoutMs: 15_000 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
}
async function select(cdp, id) {
    const state = await evalOn(cdp, STATE);
    if (state.editorFor === id) return;
    if (state.editorFor) await escape(cdp);
    const p = await waitEval(cdp, box(TAG(id)), { label: `tag ${id}` });
    await realClick(cdp, p.x, p.y);
    await waitEval(cdp, `(${STATE}).editorFor===${S(id)}`, { label: `${id} selected`, timeoutMs: 15_000 });
    await sleep(300);
}
// つまみを掴んで行の中心まで上下に引く。離す前に仮描画を記録する。
async function dragHandle(cdp, id, edge, toRow, { onHover } = {}) {
    const handle = (await evalOn(cdp, HANDLES)).find(h => h.captionId === id && h.edge === edge);
    assert(handle, `${id} ${edge} handle not found`);
    const to = await evalOn(cdp, box(ROW(toRow)));
    const toY = to.y;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 14; step++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y + (toY - handle.y) * step / 14, button: 'left', buttons: 1 });
        await sleep(40);
    }
    await sleep(300);
    const hover = onHover ? await onHover() : undefined;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x, y: toY, button: 'left', buttons: 0, clickCount: 1 });
    return { handle: { row: handle.row, y: handle.y }, toRow, toY, hover };
}

try {
    const project = path.join(FIXTURE, 'placed');
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(RUNS, 'after-placed') });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-placed-tag').length>=4`, { label: 'placed tags', timeoutMs: 600_000 });
        await sleep(1500);
        await evalOn(cdp, `(()=>{document.querySelector(${S(ROW('s-1'))})?.scrollIntoView({block:'start'});return true})()`);
        await sleep(500);

        await check('1 下端のカード: 数字のボタンなし・全部の行に / 文字を編集 / 削除 / 閉じる + 説明 1 行', async () => {
            await select(cdp, 'p-b');
            const state = await evalOn(cdp, STATE);
            await shot(cdp, 'after-01-card-handles.png');
            const labels = state.editorButtons.map(b => b.label);
            assert(JSON.stringify(labels) === JSON.stringify(['全部の行に', '文字を編集', '削除', '閉じる']), `card labels ${labels}`);
            assert(state.editorHelp === '範囲は左の棒の両端を引いて変えます', `help ${state.editorHelp}`);
            assert(!/1 行|全体/.test(state.editorText.replace(/\d+ 行目/g, '')), `numeric/全体 text remains: ${state.editorText}`);
            return state;
        });

        await check('2 右クリックメニュー: 全部の行に / 文字を編集 / 削除', async () => {
            await escape(cdp);
            await rightClick(cdp, TAG('p-b'));
            await sleep(600);
            const items = await evalOn(cdp, `[...document.querySelectorAll('.akari-daihon-placed-menu button')].map(b=>b.textContent)`);
            await shot(cdp, 'after-02-menu.png');
            await escape(cdp); await escape(cdp);
            assert(JSON.stringify(items) === JSON.stringify(['全部の行に', '文字を編集', '削除']), `menu ${items}`);
            return { items };
        });

        await check('3 棒の当たり判定: 中心・左 4px 外・右 4px 外のクリックで選択（見た目 4px のまま）', async () => {
            const css = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(BAR('s-3', 'p-b'))});const cs=getComputedStyle(e);const b=getComputedStyle(e,'::before');const a=document.querySelector(${S(BAR('s-3', 'p-a'))}).getBoundingClientRect();const r=e.getBoundingClientRect();return{width:cs.width,background:cs.backgroundColor,borderRadius:cs.borderRadius,beforeContent:b.content,beforeInset:[b.top,b.right,b.bottom,b.left].join(' '),gapToPrevLane:Math.round((r.left-a.right)*100)/100}})()`);
            assert(css.width === '4px' && css.beforeInset === '0px -5px 0px -5px' && css.gapToPrevLane === 2, `css ${JSON.stringify(css)}`);
            const clicks = [];
            for (const dx of [0, -4, 4]) {
                if ((await evalOn(cdp, STATE)).editorFor) await escape(cdp);
                const b = await evalOn(cdp, box(BAR('s-3', 'p-b')));
                const x = b.x + dx, y = b.y;
                const hit = await evalOn(cdp, `(()=>{const e=document.elementFromPoint(${x},${y});return e?{cls:String(e.className),captionId:e.dataset?.captionId??null}:null})()`);
                await realClick(cdp, x, y);
                await sleep(700);
                const state = await evalOn(cdp, STATE);
                clicks.push({ dx, x, y, barLeft: b.left, barWidth: b.width, hit, selected: state.selected, editorFor: state.editorFor });
                if (dx === 4) await shot(cdp, 'after-03-bar-click-plus4.png');
            }
            for (const c of clicks) assert(c.editorFor === 'p-b', `dx=${c.dx} not selected: ${JSON.stringify(c)}`);
            return { css, clicks };
        });

        await check('3b 隣の棒の広げた当たりが見えている棒を奪わない: p-a（左の列）の中心クリックで p-a が選ばれる', async () => {
            if ((await evalOn(cdp, STATE)).editorFor) await escape(cdp);
            const b = await evalOn(cdp, box(BAR('s-3', 'p-a')));
            const hit = await evalOn(cdp, `(()=>{const e=document.elementFromPoint(${b.x},${b.y});return e?{cls:String(e.className),captionId:e.dataset?.captionId??null}:null})()`);
            await realClick(cdp, b.x, b.y);
            await sleep(700);
            const state = await evalOn(cdp, STATE);
            await escape(cdp);
            assert(state.editorFor === 'p-a', `p-a center selected ${state.editorFor} (hit ${JSON.stringify(hit)})`);
            return { point: { x: b.x, y: b.y }, hit, editorFor: state.editorFor };
        });

        await check('4 つまみ:選択中の棒の先頭行の上端・最終行の下端に白い 12×6 のつまみ', async () => {
            await select(cdp, 'p-b');
            const handles = await evalOn(cdp, HANDLES);
            const top = handles.find(h => h.edge === 'start'), bot = handles.find(h => h.edge === 'end');
            assert(handles.length === 2 && top?.row === 's-2' && bot?.row === 's-4' && top.inColumns && bot.inColumns && top.hitSelf && bot.hitSelf, `handles ${JSON.stringify(handles)}`);
            assert(handles.every(h => h.width === 12 && h.height === 6 && h.cursor === 'ns-resize' && h.borderRadius === '2px'), 'handle size/cursor');
            assert(Math.abs(top.y - top.barTop) < 0.6 && Math.abs(bot.y - bot.barBottom) < 0.6, 'handles centered on bar ends');
            return { handles };
        });

        await check('5 下のつまみを 1 行下へ → end が次の行（s-5）の終わり 19.2 → Cmd+Z 1 手で byte 一致', async () => {
            await select(cdp, 'p-b');
            const before = await rawOf(project);
            const drag = await dragHandle(cdp, 'p-b', 'end', 's-5', { onHover: async () => {
                const hover = { bars: await evalOn(cdp, BARS_OF('p-b')), fileUnchanged: (await rawOf(project)) === before };
                await shot(cdp, 'after-04-drag-end-preview.png');
                return hover;
            } });
            const raw = await waitRaw(project, r => r !== before, 'captions.json written');
            const pb = byId(JSON.parse(raw), 'p-b');
            await sleep(800);
            const bars = await evalOn(cdp, BARS_OF('p-b'));
            const state = await evalOn(cdp, STATE);
            await shot(cdp, 'after-05-drag-end-saved.png');
            assert(drag.hover.fileUnchanged && JSON.stringify(drag.hover.bars) === JSON.stringify(['s-2', 's-3', 's-4', 's-5']), `preview ${JSON.stringify(drag.hover)}`);
            assert(pb.start === 4 && pb.end === 19.2 && pb.time_domain === 'output', `saved ${JSON.stringify(pb)}`);
            await undo(cdp);
            const undone = await waitRaw(project, r => r === before, 'byte-identical after undo');
            await sleep(800);
            return { drag, saved: { start: pb.start, end: pb.end, time_domain: pb.time_domain }, barsAfter: bars, editorFor: state.editorFor, undoByteIdentical: undone === before, barsAfterUndo: await evalOn(cdp, BARS_OF('p-b')) };
        });

        await check('6 上のつまみを 1 行上へ → start が前の行（s-1）の始まり 0 → Cmd+Z 1 手で byte 一致', async () => {
            await select(cdp, 'p-b');
            const before = await rawOf(project);
            const drag = await dragHandle(cdp, 'p-b', 'start', 's-1', { onHover: async () => ({
                bars: await evalOn(cdp, BARS_OF('p-b')), tagRow: await evalOn(cdp, TAG_ROW('p-b')), fileUnchanged: (await rawOf(project)) === before }) });
            const raw = await waitRaw(project, r => r !== before, 'captions.json written');
            const pb = byId(JSON.parse(raw), 'p-b');
            await sleep(800);
            await shot(cdp, 'after-06-drag-start-saved.png');
            assert(drag.hover.fileUnchanged && drag.hover.tagRow === 's-1', `preview ${JSON.stringify(drag.hover)}`);
            assert(pb.start === 0 && pb.end === 15.2, `saved ${JSON.stringify(pb)}`);
            await undo(cdp);
            const undone = await waitRaw(project, r => r === before, 'byte-identical after undo');
            await sleep(800);
            return { drag, saved: { start: pb.start, end: pb.end }, undoByteIdentical: undone === before };
        });

        await check('7 逆転しない: 上のつまみを最終行より下（s-8）へ → start は最終行 s-4 の始まり 12 で止まる / 下のつまみを先頭行より上（s-1）へ → end は s-2 の終わり 7.2', async () => {
            await select(cdp, 'p-b');
            const before = await rawOf(project);
            await dragHandle(cdp, 'p-b', 'start', 's-8');
            const raw = await waitRaw(project, r => r !== before, 'captions.json written');
            const a = byId(JSON.parse(raw), 'p-b');
            await undo(cdp);
            await waitRaw(project, r => r === before, 'undo 1');
            await sleep(800);
            await select(cdp, 'p-b');
            await dragHandle(cdp, 'p-b', 'end', 's-1');
            const raw2 = await waitRaw(project, r => r !== before, 'captions.json written 2');
            const b = byId(JSON.parse(raw2), 'p-b');
            await undo(cdp);
            const undone = await waitRaw(project, r => r === before, 'undo 2');
            await sleep(800);
            assert(a.start === 12 && a.end === 15.2 && a.start < a.end, `top clamp ${JSON.stringify(a)}`);
            assert(b.start === 4 && b.end === 7.2 && b.start < b.end, `bottom clamp ${JSON.stringify(b)}`);
            return { topToS8: { start: a.start, end: a.end }, bottomToS1: { start: b.start, end: b.end }, undoByteIdentical: undone === before };
        });

        await check('8 「全部の行に」で最初から最後まで（0 〜 31.2）→ Cmd+Z 1 手で byte 一致', async () => {
            await select(cdp, 'p-b');
            const before = await rawOf(project);
            await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-placed-editor button')].find(b=>b.textContent==='全部の行に');b.scrollIntoView({block:'nearest'});return true})()`);
            const p = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-placed-editor button')].find(b=>b.textContent==='全部の行に');const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
            await realClick(cdp, p.x, p.y);
            const raw = await waitRaw(project, r => r !== before, 'captions.json written');
            const pb = byId(JSON.parse(raw), 'p-b');
            await sleep(800);
            const bars = await evalOn(cdp, BARS_OF('p-b'));
            await shot(cdp, 'after-07-all-rows.png');
            assert(pb.start === 0 && pb.end === 31.2, `saved ${JSON.stringify(pb)}`);
            await undo(cdp);
            const undone = await waitRaw(project, r => r === before, 'byte-identical after undo');
            await sleep(800);
            return { saved: { start: pb.start, end: pb.end }, bars, undoByteIdentical: undone === before };
        });

        await check('9 1 行の文字（p-c・棒なし）: 選ぶと札の横に上下のつまみ → 下を 1 行下へで end 23.2 → Cmd+Z 1 手で byte 一致', async () => {
            await select(cdp, 'p-c');
            const handles = (await evalOn(cdp, HANDLES)).filter(h => h.captionId === 'p-c');
            const tag = await evalOn(cdp, box(TAG('p-c')));
            await shot(cdp, 'after-08-single-handles.png');
            assert(handles.length === 2 && handles.every(h => !h.inColumns && h.hitSelf && h.row === 's-5' && h.width === 12 && h.height === 6), `single handles ${JSON.stringify(handles)}`);
            const before = await rawOf(project);
            const drag = await dragHandle(cdp, 'p-c', 'end', 's-6', { onHover: async () => ({ bars: await evalOn(cdp, BARS_OF('p-c')), fileUnchanged: (await rawOf(project)) === before }) });
            const raw = await waitRaw(project, r => r !== before, 'captions.json written');
            const pc = byId(JSON.parse(raw), 'p-c');
            await sleep(800);
            await shot(cdp, 'after-09-single-extended.png');
            assert(pc.start === 16.2 && pc.end === 23.2, `saved ${JSON.stringify(pc)}`);
            await undo(cdp);
            const undone = await waitRaw(project, r => r === before, 'byte-identical after undo');
            await sleep(800);
            return { handles, tagLeft: tag.left, drag, saved: { start: pc.start, end: pc.end }, undoByteIdentical: undone === before };
        });
    } finally { await stop(session); }

    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'none'), port: PORT, isoDir: path.join(RUNS, 'after-none') });
    try {
        await evalOn(session.cdp, command('akari.daihon.open'));
        await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: 'daihon rows', timeoutMs: 600_000 });
        await sleep(1500);
        await check('10 置いた文字 0 本: 行の箱・padding・head / rows の箱・エディタ非表示が BEFORE と一致', async () => {
            const now = await evalOn(session.cdp, `(()=>{const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height)}};const ed=document.querySelector('.akari-daihon-placed-editor');return{head:box(document.querySelector('.akari-daihon-head')),rows:box(document.querySelector('.akari-daihon-rows')),editorHidden:ed?ed.hidden:null,bars:document.querySelectorAll('.akari-daihon-placed-bar').length,rowBoxes:[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,...box(r),paddingLeft:getComputedStyle(r).paddingLeft}))}})()`);
            const handles = await evalOn(session.cdp, `document.querySelectorAll('.akari-daihon-placed-handle, .akari-daihon-placed-help').length`);
            await shot(session.cdp, 'after-10-none.png');
            const before = JSON.parse(await readFile(path.join(ROOT, 'results-before.json'), 'utf8')).observations.none;
            assert(JSON.stringify(now) === JSON.stringify(before), `layout differs: ${JSON.stringify({ now, before })}`);
            assert(handles === 0, 'handles/help present');
            return { identicalToBefore: true, rowCount: now.rowBoxes.length, handles, head: now.head, rows: now.rows };
        });
    } finally { await stop(session); }
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, checks: out.checks.map(c => ({ name: c.name.slice(0, 40), pass: c.pass, error: c.error?.split('\n')[0] })), error: out.error })}\n`);
