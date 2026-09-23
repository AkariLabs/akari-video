#!/usr/bin/env node
// AFTER（変更後ビルド）: 台本の添付（HTML オーバーレイ・画像）を実機で確かめる。
//   1 並び: ロゴ（全体）= 棒 + 先頭行に札 / 下帯（3 行）= 棒 + 札 / 画像（1 行）= 札だけ（サムネイル付き）。置いた文字と同じ列の規則
//   2 札のクリックで選択（タイムラインの item 選択へ同期）
//   3 下帯の棒の下のつまみを 1 行下へ → edit.json の duration が伸びる → Cmd+Z 1 手で byte 一致
//   4 下帯の札を 2 行下へドラッグ → at が移る（duration は保つ）→ Cmd+Z 1 手で byte 一致
//   5 表示モード: 文字だけ = 添付の札と棒が消える / 隠す = すべて消える
//   6 再起動後も表示モードが保たれる
//   7 画像の札のダブルクリック = 素材を開く
//   8 添付 6 本（列 6 本）→ 棒は 4 本まで・残りは札に ▮N
// 使い方: node l1-after.mjs <fixture dir> [--port=9471]（fixture は gen-fixture.mjs で作る）
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-attachments-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9471);
const PREFIX = process.argv.find(v => v.startsWith('--prefix='))?.slice(9) ?? 'after';
const RUNS = path.join(os.tmpdir(), 'daihon-attachments-l1', 'runs');
const RESULTS = path.join(ROOT, `results-${PREFIX}.json`);
const out = { phase: PREFIX, status: 'running', checks: [], screenshots: [] };
const META = 4;
const FPS = 30;

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
    await sleep(500);
    const file = `${PREFIX}-${name}`;
    await screenshot(cdp, path.join(ROOT, file));
    out.screenshots.push(file);
}
const rawOf = project => readFile(path.join(project, 'edit.json'), 'utf8');
const itemOf = (raw, id) => JSON.parse(raw).tracks.flatMap(track => track.items ?? []).find(item => item.id === id);
async function waitRaw(project, predicate, label) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        try { const raw = await rawOf(project); if (predicate(raw)) return raw; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}
const ROW = id => `.akari-daihon-row[data-caption-id="${id}"]`;
const ATAG = id => `.akari-daihon-attachment-tag[data-attachment-id="${id}"]`;
const box = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,width:r.width,height:r.height}})()`;
// 行ごとの棒（列番号付き）と札。置いた文字（data-caption-id）と添付（data-attachment-id）を同じ形で並べる。
const LAYOUT = `(()=>[...document.querySelectorAll('.akari-daihon-row')].map(row=>({row:row.dataset.captionId,
  bars:[...row.querySelectorAll('.akari-daihon-placed-columns > .akari-daihon-placed-bar')].map(b=>({id:b.dataset.attachmentId??b.dataset.captionId,kind:b.dataset.attachmentKind??'text',lane:Number(b.dataset.lane),left:b.style.left})),
  tags:[...row.querySelectorAll('.akari-daihon-placed-tags .akari-daihon-placed-tag')].map(t=>{const img=t.querySelector('img');const r=img?.getBoundingClientRect();return{id:t.dataset.attachmentId??t.dataset.captionId,kind:t.dataset.attachmentKind??'text',
    text:(t.textContent||'').trim(),icon:t.querySelector('.akari-daihon-attachment-icon')?.textContent??null,
    thumb:img?{loaded:img.complete&&img.naturalWidth>0,naturalWidth:img.naturalWidth,width:r.width,height:r.height,rowHeight:row.getBoundingClientRect().height}:null,
    folded:t.querySelector('.akari-daihon-attachment-folded')?.textContent??null,selected:t.classList.contains('selected')}})})))()`;
const MODE = `(()=>{const b=[...document.querySelectorAll('[data-attachment-mode]')];return{buttons:b.map(x=>({mode:x.dataset.attachmentMode,label:x.textContent,active:x.classList.contains('active')||x.getAttribute('aria-pressed')==='true'})),
  attachmentNodes:document.querySelectorAll('.akari-daihon-rows [data-attachment-id]').length,
  textBars:document.querySelectorAll('.akari-daihon-placed-bar[data-caption-id]').length,textTags:document.querySelectorAll('.akari-daihon-placed-tag[data-caption-id]').length}})()`;
const HANDLES = id => `[...document.querySelectorAll('.akari-daihon-placed-handle[data-attachment-id="${id}"]')].map(h=>{const r=h.getBoundingClientRect();return{edge:h.dataset.edge,row:h.closest('.akari-daihon-row')?.dataset.captionId??null,x:r.left+r.width/2,y:r.top+r.height/2,hitSelf:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===h}})`;
const TIMELINE_SELECTED = `(()=>[...document.querySelectorAll('.akari-annotations-selected[data-akari-item-id]')].map(e=>e.dataset.akariItemId))()`;
const TABS = `[...document.querySelectorAll('.lm-TabBar-tab')].map(e=>(e.querySelector('.lm-TabBar-tabLabel')?.textContent||e.title||'').trim())`;
const CURRENT_TABS = `[...document.querySelectorAll('.lm-TabBar-tab.lm-mod-current')].map(e=>(e.querySelector('.lm-TabBar-tabLabel')?.textContent||e.title||'').trim())`;
const NOTICES = `[...document.querySelectorAll('.theia-notification-message')].map(e=>(e.textContent||'').trim()).filter(Boolean)`;
const undo = cdp => pressKey(cdp, 'z', 'KeyZ', 90, META);
const escape = async cdp => { await pressKey(cdp, 'Escape', 'Escape', 27, 0); await sleep(400); };
const tagRow = (layout, id) => layout.find(row => row.tags.some(tag => tag.id === id))?.row ?? null;
const barRows = (layout, id) => layout.filter(row => row.bars.some(bar => bar.id === id)).map(row => row.row);
const lanesOf = (layout, id) => [...new Set(layout.flatMap(row => row.bars.filter(bar => bar.id === id).map(bar => bar.lane)))];

async function drag(cdp, from, toY, { steps = 14, onHover } = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= steps; step++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + (toY - from.y) * step / steps, button: 'left', buttons: 1 });
        await sleep(40);
    }
    await sleep(300);
    const hover = onHover ? await onHover() : undefined;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: toY, button: 'left', buttons: 0, clickCount: 1 });
    return hover;
}
async function openDaihon(cdp, minTags) {
    await evalOn(cdp, command('akari.daihon.open'));
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===8&&document.querySelectorAll('[data-attachment-mode]').length===3`,
        { label: 'daihon rows + mode switch', timeoutMs: 600_000 });
    if (minTags) await waitEval(cdp, `document.querySelectorAll('.akari-daihon-placed-tag').length>=${minTags}`, { label: 'tags', timeoutMs: 120_000 });
    await sleep(2000);
    await evalOn(cdp, `(()=>{document.querySelector(${S(ROW('s-1'))})?.scrollIntoView({block:'start'});return true})()`);
    await sleep(500);
}
async function clickMode(cdp, mode) {
    const p = await waitEval(cdp, box(`[data-attachment-mode="${mode}"]`), { label: `mode ${mode}` });
    await realClick(cdp, p.x, p.y);
    await sleep(900);
}

try {
    const project = path.join(FIXTURE, 'attach');
    const isoDir = path.join(RUNS, `${PREFIX}-attach`);
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir });
    try {
        const { cdp } = session;
        // タイムラインも開いておく（選択の同期を観測するため）。開けなくても台本の検査は続ける。
        await evalOn(cdp, command('akari.annotations.open')).catch(() => null);
        await openDaihon(cdp, 5);

        await check('1 並び: ロゴ=棒(全行)+先頭行に札 / 下帯=棒(3 行)+札 / 画像=札だけ（サムネイル）/ 置いた文字と同じ列の規則', async () => {
            const layout = await evalOn(cdp, LAYOUT);
            const mode = await evalOn(cdp, MODE);
            await shot(cdp, '01-attach.png');
            const all = ['s-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-7', 's-8'];
            assert(JSON.stringify(barRows(layout, 'ov-logo')) === JSON.stringify(all) && tagRow(layout, 'ov-logo') === 's-1', `logo ${barRows(layout, 'ov-logo')} / ${tagRow(layout, 'ov-logo')}`);
            assert(JSON.stringify(barRows(layout, 'ov-lower')) === JSON.stringify(['s-2', 's-3', 's-4']) && tagRow(layout, 'ov-lower') === 's-2', `lower ${barRows(layout, 'ov-lower')} / ${tagRow(layout, 'ov-lower')}`);
            assert(barRows(layout, 'img-beans').length === 0 && tagRow(layout, 'img-beans') === 's-3', `image ${barRows(layout, 'img-beans')} / ${tagRow(layout, 'img-beans')}`);
            const tags = layout.flatMap(row => row.tags);
            const beans = tags.find(tag => tag.id === 'img-beans');
            assert(beans.thumb?.loaded && beans.thumb.height <= beans.thumb.rowHeight, `thumb ${JSON.stringify(beans.thumb)}`);
            const logo = tags.find(tag => tag.id === 'ov-logo'), lower = tags.find(tag => tag.id === 'ov-lower');
            assert(logo.icon === '<>' && logo.text.endsWith('YouTube ロゴ · 全体') && lower.icon === '<>' && lower.text.endsWith('下帯: チャプター 1 · 3 行'), `html tags ${JSON.stringify([logo, lower])}`);
            assert(beans.text === 'coffee-beans.png', `image tag text ${beans.text}`);
            // 同じ列の規則: 置いた文字（p-a 全体・p-d 2 行）と添付は 1 回の割り当てで列を分け合う。同じ行で列番号が重ならない。
            for (const row of layout) {
                const lanes = row.bars.map(bar => bar.lane);
                assert(new Set(lanes).size === lanes.length, `row ${row.row} lane collision ${JSON.stringify(row.bars)}`);
            }
            const lanes = Object.fromEntries(['p-a', 'ov-logo', 'ov-lower', 'p-d'].map(id => [id, lanesOf(layout, id)]));
            assert(lanes['p-a'].length === 1 && lanes['ov-logo'].length === 1 && lanes['ov-lower'].length === 1 && lanes['p-d'].length === 1, `lanes ${JSON.stringify(lanes)}`);
            assert(lanes['p-d'][0] === lanes['ov-lower'][0], `p-d should reuse the lane freed by ov-lower (greedy shared): ${JSON.stringify(lanes)}`);
            return { lanes, rows: layout, mode };
        });

        await check('2 札のクリック = 選択（タイムラインの選択へ同期）', async () => {
            const p = await waitEval(cdp, box(ATAG('ov-lower')), { label: 'lower tag' });
            await realClick(cdp, p.x, p.y);
            await waitEval(cdp, `document.querySelector(${S(ATAG('ov-lower'))})?.classList.contains('selected')`, { label: 'lower selected', timeoutMs: 15_000 });
            await sleep(800);
            const handles = await evalOn(cdp, HANDLES('ov-lower'));
            const timeline = await evalOn(cdp, TIMELINE_SELECTED);
            await shot(cdp, '02-selected.png');
            assert(handles.length === 2 && handles.find(h => h.edge === 'start')?.row === 's-2' && handles.find(h => h.edge === 'end')?.row === 's-4', `handles ${JSON.stringify(handles)}`);
            assert(JSON.stringify(timeline) === JSON.stringify(['ov-lower']), `timeline selection ${JSON.stringify(timeline)}`);
            return { handles, timelineSelected: timeline };
        });

        await check('3 下帯の下のつまみを 1 行下へ → duration が伸びる → Cmd+Z 1 手で byte 一致', async () => {
            const before = await rawOf(project);
            const handle = (await evalOn(cdp, HANDLES('ov-lower'))).find(h => h.edge === 'end');
            assert(handle, 'end handle');
            const to = await evalOn(cdp, box(ROW('s-5')));
            const hover = await drag(cdp, handle, to.y, { onHover: async () => ({ bars: barRows(await evalOn(cdp, LAYOUT), 'ov-lower'), fileUnchanged: (await rawOf(project)) === before }) });
            const saved = await waitRaw(project, raw => raw !== before, 'edit.json changed');
            const item = itemOf(saved, 'ov-lower');
            await waitEval(cdp, `document.querySelectorAll(${S(ROW('s-5') + ' [data-attachment-id="ov-lower"]')}).length>0`, { label: 'bar re-rendered on s-5', timeoutMs: 30_000 }).catch(() => null);
            await sleep(500);
            const bars = barRows(await evalOn(cdp, LAYOUT), 'ov-lower');
            await shot(cdp, '03-expand-end.png');
            assert(item.at === 4 * FPS && item.duration === Math.round(19.2 * FPS) - 4 * FPS, `item ${JSON.stringify({ at: item.at, duration: item.duration })}`);
            assert(JSON.stringify(bars) === JSON.stringify(['s-2', 's-3', 's-4', 's-5']), `bars ${bars}`);
            await undo(cdp);
            const undone = await waitRaw(project, raw => raw === before, 'byte-identical after undo');
            await sleep(800);
            return { notices: await evalOn(cdp, NOTICES), hover, before: { at: itemOf(before, 'ov-lower').at, duration: itemOf(before, 'ov-lower').duration },
                saved: { at: item.at, duration: item.duration }, barsAfter: bars, undoByteIdentical: undone === before,
                barsAfterUndo: barRows(await evalOn(cdp, LAYOUT), 'ov-lower') };
        });

        await check('4 下帯の札を 2 行下へドラッグ → at が移る（duration 保つ）→ Cmd+Z 1 手で byte 一致', async () => {
            await escape(cdp);
            const before = await rawOf(project);
            const tag = await waitEval(cdp, box(ATAG('ov-lower')), { label: 'lower tag' });
            const to = await evalOn(cdp, box(ROW('s-4')));
            const hover = await drag(cdp, tag, to.y, { onHover: async () => evalOn(cdp, `[...document.querySelectorAll('.placed-drop-target')].map(e=>e.dataset.captionId)`) });
            const saved = await waitRaw(project, raw => raw !== before, 'edit.json changed').catch(async error => { await shot(cdp, '04-drag-tag-failed.png'); throw new Error(`${error.message}; drop target while dragging ${JSON.stringify(hover)}; tag ${JSON.stringify(tag)} → y ${to.y}`); });
            const item = itemOf(saved, 'ov-lower');
            await waitEval(cdp, `document.querySelector(${S(ATAG('ov-lower'))})?.closest('.akari-daihon-row')?.dataset.captionId==='s-4'`, { label: 'tag re-rendered on s-4', timeoutMs: 30_000 }).catch(() => null);
            await sleep(500);
            const layout = await evalOn(cdp, LAYOUT);
            await shot(cdp, '04-drag-tag.png');
            assert(item.at === 12 * FPS && item.duration === itemOf(before, 'ov-lower').duration, `item ${JSON.stringify({ at: item.at, duration: item.duration })}`);
            assert(tagRow(layout, 'ov-lower') === 's-4', `tag row ${tagRow(layout, 'ov-lower')}`);
            await undo(cdp);
            const undone = await waitRaw(project, raw => raw === before, 'byte-identical after undo');
            await waitEval(cdp, `document.querySelector(${S(ATAG('ov-lower'))})?.closest('.akari-daihon-row')?.dataset.captionId==='s-2'`, { label: 'tag back on s-2 after undo', timeoutMs: 30_000 });
            await sleep(500);
            return { notices: await evalOn(cdp, NOTICES), hover, saved: { at: item.at, duration: item.duration }, tagRowAfter: tagRow(layout, 'ov-lower'), barsAfter: barRows(layout, 'ov-lower'),
                undoByteIdentical: undone === before, tagRowAfterUndo: tagRow(await evalOn(cdp, LAYOUT), 'ov-lower') };
        });

        await check('5 表示モード: 文字だけ = 添付が消えて置いた文字は残る / 隠す = すべて消える', async () => {
            await escape(cdp);
            const initial = await evalOn(cdp, MODE);
            await clickMode(cdp, 'text');
            const text = await evalOn(cdp, MODE);
            await shot(cdp, '05-mode-text.png');
            await clickMode(cdp, 'none');
            const none = await evalOn(cdp, MODE);
            await shot(cdp, '06-mode-none.png');
            assert(initial.buttons.find(b => b.mode === 'all')?.active && initial.attachmentNodes > 0, `initial ${JSON.stringify(initial)}`);
            assert(text.attachmentNodes === 0 && text.textTags === 2 && text.textBars > 0, `text ${JSON.stringify(text)}`);
            assert(none.attachmentNodes === 0 && none.textTags === 0 && none.textBars === 0, `none ${JSON.stringify(none)}`);
            return { initial, text, none };
        });

        await check('7 札のダブルクリック = 素材を開く（画像・HTML）', async () => {
            await clickMode(cdp, 'all');
            const opened = {};
            // 画像は既存の画像ハンドラが「素材プレビュー」タブで開く。HTML はファイル名のタブで開く。
            for (const [id, name, tab] of [['img-beans', 'coffee-beans.png', '素材プレビュー'], ['ov-lower', 'lower-third.html', 'lower-third.html']]) {
                const p = await waitEval(cdp, box(ATAG(id)), { label: `${id} tag` });
                await realClick(cdp, p.x, p.y, { clickCount: 2 });
                await sleep(1500);
                const current = await waitEval(cdp, `(()=>{const t=${CURRENT_TABS};return t.includes(${S(tab)})&&t})()`, { label: `${tab} in front`, timeoutMs: 30_000 }).catch(() => null);
                // 前面のタブの中身がその素材を指しているか（img / video / iframe の src・タイトル・本文のファイル名）
                const content = await waitEval(cdp, `(()=>{const panels=[...document.querySelectorAll('.lm-Widget.lm-DockPanel-widget:not(.lm-mod-hidden), .theia-editor:not(.lm-mod-hidden)')].filter(e=>!e.closest('.akari-daihon-widget')&&e.getBoundingClientRect().width>0);
                    const hits=panels.flatMap(p=>[...p.querySelectorAll('img,video,iframe')].map(m=>({tag:m.tagName,src:decodeURIComponent(m.currentSrc||m.src||'').split('/').pop(),w:m.naturalWidth??m.videoWidth??null})).concat([{tag:'text',src:(p.textContent||'').includes(${S(name)})?${S(name)}:''}]));
                    const found=hits.filter(h=>String(h.src).includes(${S(name)}));return found.length?found:null})()`, { label: `${name} shown`, timeoutMs: 30_000 }).catch(() => null);
                opened[id] = { tabs: await evalOn(cdp, TABS), current: current || await evalOn(cdp, CURRENT_TABS), content };
                await shot(cdp, `07-open-${id}.png`);
                await evalOn(cdp, command('akari.daihon.open')).catch(() => null);
                await sleep(800);
            }
            assert(opened['img-beans'].current.includes('素材プレビュー') && opened['img-beans'].content, `image not in front ${JSON.stringify(opened['img-beans'])}`);
            assert(opened['ov-lower'].current.includes('lower-third.html'), `html not in front ${JSON.stringify(opened['ov-lower'])}`);
            return opened;
        });

        await check('6a 再起動前に「隠す」を選ぶ', async () => {
            await evalOn(cdp, command('akari.daihon.open')).catch(() => null);
            await sleep(800);
            await clickMode(cdp, 'none');
            const mode = await evalOn(cdp, MODE);
            assert(mode.buttons.find(b => b.mode === 'none')?.active, `mode ${JSON.stringify(mode)}`);
            return mode;
        });
    } finally { await stop(session); }

    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir, keepProfile: true });
    try {
        const { cdp } = session;
        await check('6b 再起動後も表示モード（隠す）が保たれ、全部に戻せる', async () => {
            await openDaihon(cdp, 0);
            await sleep(1500);
            const restarted = await evalOn(cdp, MODE);
            await shot(cdp, '08-restart-none.png');
            await clickMode(cdp, 'all');
            const back = await evalOn(cdp, MODE);
            assert(restarted.buttons.find(b => b.mode === 'none')?.active && restarted.attachmentNodes === 0 && restarted.textTags === 0, `restarted ${JSON.stringify(restarted)}`);
            assert(back.attachmentNodes > 0 && back.textTags === 2, `back ${JSON.stringify(back)}`);
            return { restarted, back };
        });
    } finally { await stop(session); }

    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'many'), port: PORT, isoDir: path.join(RUNS, `${PREFIX}-many`) });
    try {
        const { cdp } = session;
        await check('8 添付 6 本（列 6 本）→ 棒は 4 本まで・残りは札に ▮N', async () => {
            await openDaihon(cdp, 6);
            const layout = await evalOn(cdp, LAYOUT);
            await shot(cdp, '09-many-folded.png');
            const lanes = [...new Set(layout.flatMap(row => row.bars.map(bar => bar.lane)))].sort();
            const perRow = layout.map(row => row.bars.length);
            const tags = layout.flatMap(row => row.tags);
            const folded = tags.filter(tag => tag.folded).map(tag => ({ id: tag.id, folded: tag.folded }));
            const barred = [...new Set(layout.flatMap(row => row.bars.map(bar => bar.id)))];
            assert(tags.length === 6 && Math.max(...perRow) === 4 && JSON.stringify(lanes) === JSON.stringify([0, 1, 2, 3]), `bars ${JSON.stringify({ perRow, lanes })}`);
            assert(folded.length === 2 && folded.every(item => /^▮[56]$/.test(item.folded)) && folded.every(item => !barred.includes(item.id)), `folded ${JSON.stringify(folded)}`);
            return { perRow, lanes, barred, folded, tags: tags.map(tag => tag.text) };
        });
    } finally { await stop(session); }
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, checks: out.checks.map(item => ({ name: item.name.slice(0, 40), pass: item.pass, error: item.error?.slice(0, 400) })), error: out.error })}\n`);
