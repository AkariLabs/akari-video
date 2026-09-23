#!/usr/bin/env node
// AFTER（変更後ビルド）: 台本の操作面（右クリック = 操作・下端のドック = 編集面）を実機で確かめる。
//   1 行をクリック → ドックが下端に出る・全行の top が変わらない・選択バーを覆わない
//   2 テンプレ / 見た目 / アニメ / 強調 / 時刻 を切り替えてもドックの高さが同じ（±1px）
//   3 テンプレを選ぶ → style_preset が変わる → Cmd+Z 1 手で captions.json が byte 一致
//   4 見た目の文字色 → 書き込まれる → Cmd+Z 1 手で byte 一致
//   5 複数行選択 → テンプレが一括で入る → Cmd+Z 1 手で byte 一致
//   6 単語のクリック → 強調タブがその単語で開く → 強調を当てる → Cmd+Z 1 手
//   7 「もっと細かく」→ インスペクターがその字幕を開く
//   8 右クリック: 行 = 操作だけ（ドックは開かない）/ 単語 = 語の操作（見た目なし）/ 札 = 全部の行に・削除。行の下にピッカーが出ない
//   9 置いた文字の札 → 文字 / テンプレ / 見た目 / アニメ・高さは行のときと同じ
//  10 閉じる: Esc / ✕ / 何もない所のクリック
//  11 つまみで高さを変える → 再起動後も同じ高さ
// 使い方: node l1-after.mjs <fixture dir> [--port=9473] [--prefix=after]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-dock-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9473);
const PREFIX = process.argv.find(v => v.startsWith('--prefix='))?.slice(9) ?? 'after';
const RUNS = path.join(os.tmpdir(), 'daihon-dock-surface-l1', 'runs');
const RESULTS = path.join(ROOT, `results-${PREFIX}.json`);
const PROJECT = path.join(FIXTURE, 'dock');
const ISO = path.join(RUNS, `${PREFIX}-dock`);
const out = { phase: PREFIX, status: 'running', checks: [], screenshots: [] };
const META = 4;
const SHIFT = 8;

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
const captionsRaw = () => readFile(path.join(PROJECT, 'captions.json'), 'utf8');
const captionList = raw => { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : parsed.captions; };
const captionOf = (raw, id) => captionList(raw).find(caption => caption.id === id);
async function waitRaw(predicate, label, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const raw = await captionsRaw(); if (predicate(raw)) return raw; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}
const ROW = id => `.akari-daihon-row[data-caption-id="${id}"]`;
const WORD = (id, index) => `${ROW(id)} .akari-daihon-word[data-word-index="${index}"]`;
const DOCK = '.akari-daihon-dock';
const px = 'const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height),width:px(r.width)}};';
const TOPS = `(()=>{${px}return[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,top:px(r.getBoundingClientRect().top),height:px(r.getBoundingClientRect().height)}))})()`;
const DOCK_STATE = `(()=>{${px}const d=document.querySelector(${S(DOCK)});const w=document.querySelector('.akari-daihon-widget');const sel=document.querySelector('.akari-daihon-selbar');const body=d?.querySelector('.akari-daihon-dock-body');
 const open=Boolean(d&&d.classList.contains('open')&&getComputedStyle(d).visibility!=='hidden'&&!d.hidden);
 return{open,box:box(d),widget:box(w),rows:box(document.querySelector('.akari-daihon-rows')),selbar:sel&&!sel.hidden&&sel.getBoundingClientRect().height>0?box(sel):null,footer:box(document.querySelector('.akari-daihon-footer')),
  inline:d?{height:d.style.height,maxHeight:d.style.maxHeight,minHeight:d.style.minHeight}:null,dockh:w?.style.getPropertyValue('--dockh')||null,
  title:(d?.querySelector('.akari-daihon-dock-title')?.textContent||'').trim(),
  tabs:[...(d?.querySelectorAll('[data-dock-tab]')||[])].map(t=>({tab:t.dataset.dockTab,label:(t.textContent||'').trim(),active:t.classList.contains('active')})),
  body:body?{clientHeight:body.clientHeight,scrollHeight:body.scrollHeight,overflowY:getComputedStyle(body).overflowY,text:(body.textContent||'').trim().slice(0,300)}:null,
  rowsDocked:document.querySelector('.akari-daihon-rows')?.classList.contains('docked')??null,
  pickersInRows:document.querySelectorAll('.akari-daihon-rows .akari-daihon-tplgrid, .akari-daihon-rows .akari-daihon-pop, .akari-daihon-rows .akari-daihon-dock-grid').length,
  rowsChildren:[...(document.querySelector('.akari-daihon-rows')?.children||[])].filter(c=>!c.classList.contains('akari-daihon-row')&&!c.classList.contains('akari-daihon-gapzone')&&c.getBoundingClientRect().height>0).map(c=>String(c.className)),
  floatingPops:[...document.querySelectorAll('.akari-daihon-pop')].map(p=>String(p.className))}})()`;
const MENU = `(()=>{const m=[...document.querySelectorAll('.akari-daihon-pop')].filter(p=>p.getBoundingClientRect().height>0);return m.map(p=>({className:String(p.className),items:[...p.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).filter(Boolean),actions:[...p.querySelectorAll('button')].map(b=>b.dataset.rowAction??b.dataset.action??null)}))})()`;
const shiftOf = (idle, now) => now.map((row, i) => Math.abs(row.top - (idle[i]?.top ?? NaN))).reduce((m, v) => Math.max(m, v), 0);
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
async function clickAt(cdp, selector, modifiers = 0) {
    const p = await waitEval(cdp, center(selector), { label: `${selector} visible`, timeoutMs: 30_000 });
    await realClick(cdp, p.x, p.y, { modifiers });
}
// 行の本文の右下の余白（語でも時刻でもない所）
async function clickRowBlank(cdp, id, modifiers = 0, button = 'left') {
    // ドックは行リストの下半分に重なるので、行の上端寄り（見えている所）を押す。当たりが行でなければ止める。
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(ROW(id))});const b=r.getBoundingClientRect();const x=b.right-10,y=b.top+6;return{x,y,inRow:r.contains(document.elementFromPoint(x,y))}})()`);
    if (!p.inRow) throw new Error(`${id} blank point is covered`);
    if (button === 'left') { await realClick(cdp, p.x, p.y, { modifiers }); return; }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
}
async function rightClick(cdp, selector) {
    const p = await waitEval(cdp, center(selector), { label: `${selector} visible`, timeoutMs: 30_000 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
}
const focusRows = cdp => evalOn(cdp, `(()=>{document.querySelector('.akari-daihon-rows')?.focus({preventScroll:true});return document.activeElement?.className??null})()`);
const undo = async cdp => { await focusRows(cdp); await sleep(150); await pressKey(cdp, 'z', 'KeyZ', 90, META); };
const escape = async cdp => { await pressKey(cdp, 'Escape', 'Escape', 27, 0); await sleep(500); };
const dismissPops = cdp => evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(n=>n.remove());return true})()`);
async function openDaihon(cdp) {
    await evalOn(cdp, command('akari.daihon.open'));
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=8&&document.querySelectorAll('.akari-daihon-placed-tag').length>=2`, { label: 'daihon rows', timeoutMs: 240_000 });
    await sleep(2500);
}
async function closeDockIfOpen(cdp) {
    const state = await evalOn(cdp, DOCK_STATE);
    if (!state.open) return;
    await clickAt(cdp, `${DOCK} .akari-daihon-dock-close`);
    await waitEval(cdp, `!document.querySelector(${S(DOCK)}).classList.contains('open')`, { label: 'dock closed', timeoutMs: 10_000 });
    await sleep(400);
}
async function openRowDock(cdp, id) {
    await clickRowBlank(cdp, id);
    await waitEval(cdp, `(()=>{const d=document.querySelector(${S(DOCK)});return d&&d.classList.contains('open')})()`, { label: 'dock open', timeoutMs: 15_000 });
    await sleep(450);
}
const selectTab = async (cdp, tab) => { await clickAt(cdp, `${DOCK} [data-dock-tab="${tab}"]`); await sleep(350); };

try {
    await import('node:fs/promises').then(fs => fs.rm(ISO, { recursive: true, force: true }));
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: ISO, keepProfile: true });
    try {
        let { cdp } = session;
        await openDaihon(cdp);
        const idle = await evalOn(cdp, TOPS);
        out.idle = { tops: idle, dock: await evalOn(cdp, DOCK_STATE) };
        await shot(cdp, '00-idle.png');

        await check('1 行のクリックでドックが下端に出る・行の top は不変・選択バーを覆わない', async () => {
            await openRowDock(cdp, 'c-0003');
            const tops = await evalOn(cdp, TOPS);
            const state = await evalOn(cdp, DOCK_STATE);
            const shift = shiftOf(idle, tops);
            assert(state.open, 'dock not open');
            assert(shift <= 0.5, `row top shifted ${shift}px`);
            assert(state.tabs.map(t => t.tab).join() === 'template,look,anim,emphasis,time', `tabs ${state.tabs.map(t => t.tab)}`);
            assert(state.pickersInRows === 0, 'picker inside rows');
            if (state.selbar) assert(state.box.bottom <= state.selbar.top + 1, `dock covers selection bar (${state.box.bottom} > ${state.selbar.top})`);
            assert(state.box.bottom <= state.footer.top + 1, 'dock covers footer');
            await shot(cdp, '01-row-dock.png');
            return { maxRowTopShiftPx: shift, dock: state.box, widget: state.widget, heightRatioOfPanel: Math.round(state.box.height / state.widget.height * 1000) / 1000,
                selbar: state.selbar, footer: state.footer, title: state.title, tabs: state.tabs, rowsDocked: state.rowsDocked, inline: state.inline };
        });

        await check('2 タブを切り替えてもドックの高さが同じ（±1px）・行の top も不変', async () => {
            const heights = {};
            let maxShift = 0;
            for (const tab of ['template', 'look', 'anim', 'emphasis', 'time', 'template']) {
                await selectTab(cdp, tab);
                const state = await evalOn(cdp, DOCK_STATE);
                assert(state.tabs.find(t => t.tab === tab)?.active, `${tab} not active`);
                heights[tab] = { height: state.box.height, bodyClient: state.body?.clientHeight, bodyScroll: state.body?.scrollHeight, overflowY: state.body?.overflowY };
                maxShift = Math.max(maxShift, shiftOf(idle, await evalOn(cdp, TOPS)));
                if (tab === 'look') await shot(cdp, '02-look-tab.png');
                if (tab === 'time') await shot(cdp, '02-time-tab.png');
            }
            const values = Object.values(heights).map(v => v.height);
            const spread = Math.max(...values) - Math.min(...values);
            assert(spread <= 1, `dock height spread ${spread}px`);
            assert(maxShift <= 0.5, `row top shifted ${maxShift}px`);
            const look = await evalOn(cdp, `(()=>{document.querySelector('${DOCK} [data-dock-tab="look"]').click();return true})()`);
            await sleep(300);
            const lookFields = await evalOn(cdp, `[...document.querySelectorAll('${DOCK} [data-look-field]')].map(f=>({field:f.dataset.lookField,label:(f.querySelector('label')?.textContent||'').trim(),values:[...f.querySelectorAll('[data-look-value]')].map(b=>b.dataset.lookValue)}))`);
            return { heights, spreadPx: spread, maxRowTopShiftPx: maxShift, lookFields, lookClicked: look };
        });

        await check('3 テンプレを選ぶ → style_preset が変わる → Cmd+Z 1 手で byte 一致', async () => {
            await selectTab(cdp, 'template');
            const categories = await evalOn(cdp, `[...document.querySelectorAll('${DOCK} [data-dock-category]')].map(b=>(b.textContent||'').trim())`);
            const cards = await evalOn(cdp, `[...document.querySelectorAll('${DOCK} .akari-daihon-tplcard')].map(c=>c.dataset.presetId)`);
            const original = await captionsRaw();
            assert(captionOf(original, 'c-0003').style_preset === undefined, 'fixture already has style_preset');
            await clickAt(cdp, `${DOCK} .akari-daihon-tplcard[data-preset-id="subtitle-news"]`);
            const changed = await waitRaw(raw => captionOf(raw, 'c-0003')?.style_preset === 'subtitle-news', 'style_preset subtitle-news');
            const others = captionList(changed).filter(c => c.id !== 'c-0003' && c.style_preset !== undefined).map(c => c.id);
            await shot(cdp, '03-template-applied.png');
            await undo(cdp);
            await waitRaw(raw => raw === original, 'captions.json byte-identical after 1 undo');
            await sleep(800);
            assert(await captionsRaw() === original, 'captions.json changed again after undo');
            return { categories, cards, afterPreset: captionOf(changed, 'c-0003').style_preset, othersWithPreset: others, undo: 'byte-identical after 1 Cmd+Z' };
        });

        await check('4 見た目の文字色 → 書き込まれる → Cmd+Z 1 手で byte 一致', async () => {
            await selectTab(cdp, 'look');
            const original = await captionsRaw();
            await clickAt(cdp, `${DOCK} [data-look-field="color"] [data-look-value="#facc15"]`);
            const changed = await waitRaw(raw => JSON.stringify(captionOf(raw, 'c-0003')).includes('#facc15'), 'color #facc15');
            const written = captionOf(changed, 'c-0003');
            await shot(cdp, '04-look-color.png');
            await undo(cdp);
            await waitRaw(raw => raw === original, 'captions.json byte-identical after 1 undo');
            await sleep(800);
            assert(await captionsRaw() === original, 'captions.json changed again after undo');
            return { written: written.text_style ?? written.textStyle ?? written, undo: 'byte-identical after 1 Cmd+Z' };
        });

        await check('5 複数行選択 → テンプレを一括適用 → Cmd+Z 1 手で byte 一致', async () => {
            await closeDockIfOpen(cdp);
            await openRowDock(cdp, 'c-0002');
            await clickRowBlank(cdp, 'c-0003', SHIFT);
            await sleep(600);
            const state = await evalOn(cdp, DOCK_STATE);
            assert(state.open, 'dock not open for multi-selection');
            assert(state.title.includes('2 行'), `dock title ${state.title}`);
            await selectTab(cdp, 'template');
            const original = await captionsRaw();
            await clickAt(cdp, `${DOCK} .akari-daihon-tplcard[data-preset-id="subtitle-variety"]`);
            const changed = await waitRaw(raw => ['c-0002', 'c-0003'].every(id => captionOf(raw, id)?.style_preset === 'subtitle-variety'), 'both rows subtitle-variety');
            await shot(cdp, '05-multi-template.png');
            await undo(cdp);
            await waitRaw(raw => raw === original, 'captions.json byte-identical after 1 undo');
            await sleep(800);
            assert(await captionsRaw() === original, 'captions.json changed again after undo');
            return { title: state.title, presets: ['c-0002', 'c-0003'].map(id => captionOf(changed, id).style_preset), undo: 'byte-identical after 1 Cmd+Z' };
        });

        await check('6 単語のクリック → 強調タブがその単語で開く → 強調 → Cmd+Z 1 手', async () => {
            await closeDockIfOpen(cdp);
            await clickAt(cdp, WORD('c-0003', 1));
            await waitEval(cdp, `(()=>{const t=document.querySelector('${DOCK} [data-dock-tab="emphasis"]');return t&&t.classList.contains('active')})()`, { label: 'emphasis tab active', timeoutMs: 15_000 });
            await sleep(400);
            const state = await evalOn(cdp, DOCK_STATE);
            assert(state.body.text.includes('挽きたてが'), `emphasis body does not show the word: ${state.body.text}`);
            const shift = shiftOf(idle, await evalOn(cdp, TOPS));
            assert(shift <= 0.5, `row top shifted ${shift}px`);
            assert(state.floatingPops.length === 0, `floating pop appeared: ${state.floatingPops}`);
            await shot(cdp, '06-word-emphasis.png');
            const presets = await evalOn(cdp, `[...document.querySelectorAll('${DOCK} [data-emphasis-preset]')].map(b=>b.dataset.emphasisPreset)`);
            const original = await captionsRaw();
            await clickAt(cdp, `${DOCK} [data-emphasis-preset="neon"]`);
            const changed = await waitRaw(raw => (JSON.parse(raw).emphasis_words ?? []).some(w => w.style_preset === 'neon'), 'emphasis_words neon');
            await sleep(1500);
            const settled = await captionsRaw();
            await undo(cdp);
            try { await waitRaw(raw => raw === original, 'captions.json byte-identical after 1 undo', 30_000); }
            catch (error) {
                const now = await captionsRaw();
                throw new Error(`${error.message}; changedAgainAfterWrite=${settled !== changed}; nowEqualsSettled=${now === settled}; nowIsArray=${Array.isArray(JSON.parse(now))}; lenOriginal=${original.length}; lenNow=${now.length}`);
            }
            return { bodyText: state.body.text.slice(0, 80), maxRowTopShiftPx: shift, presets, emphasis: JSON.parse(changed).emphasis_words, undo: 'byte-identical after 1 Cmd+Z' };
        });

        await check('8 右クリックは操作だけ・行の右クリックでドックは開かない・行の下にピッカーが出ない', async () => {
            await dismissPops(cdp);
            await closeDockIfOpen(cdp);
            await clickRowBlank(cdp, 'c-0005', 0, 'right');
            await sleep(700);
            const rowMenu = await evalOn(cdp, MENU);
            const afterRow = await evalOn(cdp, DOCK_STATE);
            const rowShift = shiftOf(idle, await evalOn(cdp, TOPS));
            await shot(cdp, '08-row-context.png');
            await dismissPops(cdp); await escape(cdp);
            await rightClick(cdp, WORD('c-0003', 1));
            await sleep(700);
            const wordMenu = await evalOn(cdp, MENU);
            await shot(cdp, '08-word-context.png');
            await dismissPops(cdp); await escape(cdp);
            await rightClick(cdp, '.akari-daihon-placed-tag[data-caption-id="c-0102"]');
            await sleep(700);
            const placedMenu = await evalOn(cdp, MENU);
            await shot(cdp, '08-placed-context.png');
            await dismissPops(cdp); await escape(cdp);
            const rowItems = rowMenu.flatMap(m => m.items);
            const allowedRow = ['ここで切る', '分割', '次の行と結合', '下に行を足す', '削除'];
            assert(rowItems.length > 0 && rowItems.every(item => allowedRow.includes(item)), `row menu items ${rowItems}`);
            assert(!afterRow.open, 'row right-click opened the dock');
            assert(rowShift <= 0.5, `row top shifted ${rowShift}px`);
            const look = /テンプレ|強調|ネオン|グリッチ|インパクト|判定バッジ|色|見た目/;
            const wordItems = wordMenu.flatMap(m => m.items);
            assert(wordItems.length > 0 && !wordItems.some(item => look.test(item)), `word menu has look items: ${wordItems.filter(item => look.test(item))}`);
            const placedItems = placedMenu.flatMap(m => m.items);
            assert(placedItems.length > 0 && placedItems.every(item => ['全部の行に', '複製', '削除'].includes(item)), `placed menu items ${placedItems}`);
            assert(afterRow.pickersInRows === 0 && afterRow.rowsChildren.length === 0, `something inside rows: ${afterRow.rowsChildren}`);
            return { rowMenu: rowItems, rowMenuActions: rowMenu.flatMap(m => m.actions), wordMenu: wordItems, placedMenu: placedItems, rowRightClickOpenedDock: afterRow.open, maxRowTopShiftPx: rowShift };
        });

        await check('8b 行メニューの「分割」は分割モードに入る', async () => {
            await clickRowBlank(cdp, 'c-0004', 0, 'right');
            await sleep(600);
            const clicked = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-pop button')].find(x=>(x.textContent||'').trim()==='分割');if(!b)return false;b.click();return true})()`);
            await sleep(700);
            const state = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(ROW('c-0004'))});return{splitting:r.classList.contains('splitting'),marks:r.querySelectorAll('.akari-daihon-splitmark').length}})()`);
            const raw = await captionsRaw();
            assert(clicked, 'split item not found');
            assert(state.splitting, 'row not in split mode');
            assert(captionList(raw).length === 10, 'captions changed by entering split mode');
            await shot(cdp, '08b-split-mode.png');
            await evalOn(cdp, `(()=>{document.querySelector(${S(`${ROW('c-0004')} .akari-daihon-split`)})?.click();return true})()`);
            await sleep(400);
            return state;
        });

        await check('9 置いた文字の札 → 文字 / テンプレ / 見た目 / アニメ・高さは行のときと同じ', async () => {
            await closeDockIfOpen(cdp);
            await openRowDock(cdp, 'c-0003');
            const rowHeight = (await evalOn(cdp, DOCK_STATE)).box.height;
            await closeDockIfOpen(cdp);
            await clickAt(cdp, '.akari-daihon-placed-tag[data-caption-id="c-0102"]');
            await waitEval(cdp, `(()=>{const d=document.querySelector(${S(DOCK)});return d&&d.classList.contains('open')&&d.querySelector('[data-dock-tab="text"]')})()`, { label: 'placed dock', timeoutMs: 15_000 });
            await sleep(450);
            const heights = [];
            for (const tab of ['text', 'template', 'look', 'anim']) {
                await selectTab(cdp, tab);
                heights.push((await evalOn(cdp, DOCK_STATE)).box.height);
            }
            await selectTab(cdp, 'text');
            const state = await evalOn(cdp, DOCK_STATE);
            const shift = shiftOf(idle, await evalOn(cdp, TOPS));
            await shot(cdp, '09-placed-dock.png');
            assert(state.tabs.map(t => t.tab).join() === 'text,template,look,anim', `tabs ${state.tabs.map(t => t.tab)}`);
            assert(Math.max(...heights, rowHeight) - Math.min(...heights, rowHeight) <= 1, `heights ${heights} vs row ${rowHeight}`);
            assert(shift <= 0.5, `row top shifted ${shift}px`);
            return { title: state.title, tabs: state.tabs, heights, rowDockHeight: rowHeight, text: state.body.text, maxRowTopShiftPx: shift };
        });

        await check('10 閉じる: Esc / ✕ / 何もない所のクリック', async () => {
            const result = {};
            await closeDockIfOpen(cdp);
            await openRowDock(cdp, 'c-0002');
            await focusRows(cdp);
            await escape(cdp);
            result.esc = !(await evalOn(cdp, DOCK_STATE)).open;
            await openRowDock(cdp, 'c-0002');
            await clickAt(cdp, `${DOCK} .akari-daihon-dock-close`);
            await sleep(500);
            result.close = !(await evalOn(cdp, DOCK_STATE)).open;
            await openRowDock(cdp, 'c-0002');
            const p = await evalOn(cdp, `(()=>{const rows=document.querySelector('.akari-daihon-rows').getBoundingClientRect();const r=document.querySelector(${S(ROW('c-0001'))}).getBoundingClientRect();return{x:rows.left+2,y:r.top+r.height/2,hit:String(document.elementFromPoint(rows.left+2,r.top+r.height/2)?.className)}})()`);
            await realClick(cdp, p.x, p.y);
            await sleep(500);
            result.blank = !(await evalOn(cdp, DOCK_STATE)).open;
            result.blankHit = p.hit;
            assert(result.esc && result.close && result.blank, JSON.stringify(result));
            return result;
        });

        await check('7 「もっと細かく」でインスペクターがその字幕を開く', async () => {
            await evalOn(cdp, `(()=>{window.__dockInspector=[];window.addEventListener('akari.preview.captionSelected',e=>window.__dockInspector.push(e.detail?.captionId??null));return true})()`);
            await closeDockIfOpen(cdp);
            await openRowDock(cdp, 'c-0003');
            await selectTab(cdp, 'look');
            await clickAt(cdp, `${DOCK} [data-dock-detail="inspector"]`);
            await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))&&document.querySelector('[data-akari-ui="panel:inspector"]').getBoundingClientRect().width>0`, { label: 'inspector visible', timeoutMs: 60_000 });
            await sleep(1500);
            const inspector = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');const txt=e=>(e?.textContent||'').replace(/\\s+/g,' ').trim();return{header:txt(root.querySelector('.akari-inspector-selection-header, [class*="selection-header"]')).slice(0,160),text:txt(root).slice(0,400),tabs:[...root.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].map(t=>({id:t.getAttribute('data-akari-ui'),active:t.classList.contains('is-active')}))}})()`);
            const events = await evalOn(cdp, 'window.__dockInspector');
            assert(events.includes('c-0003'), `caption selection event was ${JSON.stringify(events)}`);
            assert(inspector.text.includes('豆は') || inspector.header.includes('c-0003') || inspector.text.includes('c-0003'), `inspector does not show c-0003: ${inspector.header} / ${inspector.text.slice(0, 120)}`);
            await shot(cdp, '07-inspector.png');
            return { events, inspector };
        });

        let dragged;
        await check('11a つまみを引いて高さを変える', async () => {
            await openDaihon(cdp);
            await closeDockIfOpen(cdp);
            await openRowDock(cdp, 'c-0002');
            const before = await evalOn(cdp, DOCK_STATE);
            const grip = await evalOn(cdp, center(`${DOCK} .akari-daihon-dock-grip`));
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x, y: grip.y, button: 'none' });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', buttons: 1, clickCount: 1 });
            for (let step = 1; step <= 10; step++) {
                await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x, y: grip.y - step * 12, button: 'left', buttons: 1 });
                await sleep(40);
            }
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x, y: grip.y - 120, button: 'left', buttons: 0, clickCount: 1 });
            await sleep(600);
            const after = await evalOn(cdp, DOCK_STATE);
            const stored = await evalOn(cdp, `localStorage.getItem('akari.daihon.dockHeight')`);
            const tabHeights = [];
            for (const tab of ['look', 'time', 'template']) { await selectTab(cdp, tab); tabHeights.push((await evalOn(cdp, DOCK_STATE)).box.height); }
            await shot(cdp, '11-resized.png');
            assert(after.box.height - before.box.height > 60, `height ${before.box.height} → ${after.box.height}`);
            assert(Math.max(...tabHeights) - Math.min(...tabHeights) <= 1, `tab heights after resize ${tabHeights}`);
            dragged = after.box.height;
            return { before: before.box.height, after: after.box.height, stored, dockh: after.dockh, tabHeightsAfterResize: tabHeights, panel: after.widget.height };
        });
        await sleep(3000);
        await stop(session);
        session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: ISO, keepProfile: true });
        cdp = session.cdp;
        await check('11b 再起動後も同じ高さ', async () => {
            await openDaihon(cdp);
            await openRowDock(cdp, 'c-0002');
            const state = await evalOn(cdp, DOCK_STATE);
            const stored = await evalOn(cdp, `localStorage.getItem('akari.daihon.dockHeight')`);
            await shot(cdp, '11-restarted.png');
            assert(dragged !== undefined, 'no dragged height');
            assert(Math.abs(state.box.height - dragged) <= 1, `after restart ${state.box.height} vs dragged ${dragged}`);
            return { afterRestart: state.box.height, dragged, stored, panel: state.widget.height };
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
