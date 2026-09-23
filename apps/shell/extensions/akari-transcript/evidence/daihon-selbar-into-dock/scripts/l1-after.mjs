#!/usr/bin/env node
// AFTER（変更後ビルド）: 選択バーをドックへ統合した結果を実機で確かめる。
//   1 1 行の選択: ドックの下に帯が出ない（.akari-daihon-selbar 0 個か非表示）・ヘッダー = 行の文言 + 説明
//   2 3 行の選択: 帯なし・ヘッダー「3 行を選択中」・ドックの高さ / タブは変わらない
//   3 3 行選択のまま右クリック: 選択行を結合 / 発話にぴったり / 選択行をカット があり、選択は 3 行のまま
//   4 右クリック「選択行を結合」→ 3 行が 1 行 → Cmd+Z 1 手で captions.json が byte 一致
//   5 右クリック「発話にぴったり」→ 3 行とも display_timing = speech-tight → Cmd+Z 1 手
//   6 右クリック「選択行をカット」→ edit.json にカット → 既存の「↩ 戻す」1 手（映像カットの取り消し経路）
//   7 ドックのテンプレタブで 3 行に一括適用 → Cmd+Z 1 手
//   8 1 行の右クリック: 旧選択バーの 1 行向け操作（次の行と結合・発話にぴったり・カット）も残る
//   9 解除: ドックの ✕ / Esc で選択が外れる
// 使い方: node l1-after.mjs <fixture dir> [--port=9475] [--prefix=after]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';
import { DOCK, LAYOUT, MENU, ROW } from './l1-measure.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-selbar-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9475);
const PREFIX = process.argv.find(v => v.startsWith('--prefix='))?.slice(9) ?? 'after';
const RUNS = path.join(os.tmpdir(), 'daihon-selbar-into-dock-l1', 'runs');
const RESULTS = path.join(ROOT, `results-${PREFIX}.json`);
const PROJECT = path.join(FIXTURE, 'dock');
const META = 4;
const SHIFT = 8;
const THREE = ['c-0003', 'c-0004', 'c-0005'];
const out = { phase: PREFIX, status: 'running', checks: [], screenshots: [] };

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
const raw = name => readFile(path.join(PROJECT, name), 'utf8');
const captionList = text => { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : parsed.captions; };
const captionOf = (text, id) => captionList(text).find(caption => caption.id === id);
async function waitRaw(name, predicate, label, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const text = await raw(name); if (predicate(text)) return text; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}
async function clickRowBlank(cdp, id, modifiers = 0) {
    // 行リストは scroll-behavior:smooth なので、スクロールを即時にして止まってから押す位置を測る。
    await evalOn(cdp, `(()=>{document.querySelector(${S(ROW(id))}).scrollIntoView({block:'start',behavior:'instant'});return true})()`);
    await sleep(250);
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(ROW(id))});const b=r.getBoundingClientRect();const x=b.right-10,y=b.top+6;return{x,y,inRow:r.contains(document.elementFromPoint(x,y))}})()`);
    if (!p.inRow) throw new Error(`${id} blank point is covered`);
    await realClick(cdp, p.x, p.y, { modifiers });
}
async function rightClickRow(cdp, id) {
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(ROW(id))});const b=r.getBoundingClientRect();const x=b.right-10,y=b.top+6;return{x,y,inRow:r.contains(document.elementFromPoint(x,y))}})()`);
    if (!p.inRow) throw new Error(`${id} right-click point is covered`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
    await sleep(600);
}
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
async function clickAt(cdp, selector) {
    const p = await waitEval(cdp, center(selector), { label: `${selector} visible`, timeoutMs: 30_000 });
    await realClick(cdp, p.x, p.y);
}
const focusRows = cdp => evalOn(cdp, `(()=>{document.querySelector('.akari-daihon-rows')?.focus({preventScroll:true});return document.activeElement?.className??null})()`);
const undo = async cdp => { await focusRows(cdp); await sleep(150); await pressKey(cdp, 'z', 'KeyZ', 90, META); };
const dismissPops = cdp => evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(n=>n.remove());return true})()`);
const dismissNotifications = cdp => evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item-close').forEach(b=>b.click());return true})()`);
const layout = cdp => evalOn(cdp, LAYOUT);
async function clearSelection(cdp) {
    await dismissPops(cdp);
    const state = await layout(cdp);
    if (state.dock.open) await clickAt(cdp, `${DOCK} .akari-daihon-dock-close`);
    await sleep(300);
    if ((await layout(cdp)).selected.length) { await focusRows(cdp); await pressKey(cdp, 'Escape', 'Escape', 27, 0); await sleep(400); }
}
async function selectOne(cdp, id) {
    await clearSelection(cdp);
    await clickRowBlank(cdp, id);
    await waitEval(cdp, `document.querySelector(${S(DOCK)})?.classList.contains('open')`, { label: 'dock open', timeoutMs: 15_000 });
    await sleep(700);
}
// c-0005 → Shift+クリックで c-0003（上側。ドックに覆われない位置）まで = 3 行
async function selectThree(cdp) {
    await selectOne(cdp, 'c-0005');
    await clickRowBlank(cdp, 'c-0003', SHIFT);
    try {
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row.selected').length===3`, { label: '3 rows selected', timeoutMs: 15_000 });
    } catch (error) {
        const state = await layout(cdp);
        throw new Error(`${error.message}: selected=${state.selected} dock=${state.dock.open}/${state.dock.title}`);
    }
    await sleep(700);
}
async function menuAction(cdp, action) {
    const menu = await evalOn(cdp, MENU);
    const item = menu.flatMap(m => m.items).find(i => i.action === action);
    assert(item, `row menu has no ${action}: ${JSON.stringify(menu)}`);
    assert(!item.disabled, `${action} disabled: ${item.title}`);
    await clickAt(cdp, `.akari-daihon-row-menu [data-row-action="${action}"]`);
    return item;
}
const noBand = state => {
    assert(state.selbar.visibleCount === 0, `selection bar visible: ${JSON.stringify(state.selbar.box)}`);
    assert(state.relation.bandsBetweenDockAndFooter.length === 0, `band below dock: ${JSON.stringify(state.relation.bandsBetweenDockAndFooter)}`);
    assert(Math.abs(state.dock.box.bottom - state.footer.top) <= 1.5, `dock bottom ${state.dock.box.bottom} != footer top ${state.footer.top}`);
};
const HINT = 'Shift=範囲 / ⌘=追加';

try {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: path.join(RUNS, PREFIX) });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=8&&document.querySelectorAll('.akari-daihon-placed-tag').length>=2`, { label: 'daihon rows', timeoutMs: 240_000 });
        await sleep(2500);
        out.idle = await layout(cdp);
        await shot(cdp, '00-idle.png');
        const originalCaptions = await raw('captions.json');
        const originalEdit = await raw('edit.json');

        await check('1 1 行の選択: 帯なし・ヘッダー = 行の文言 + 説明', async () => {
            await selectOne(cdp, 'c-0005');
            const state = await layout(cdp);
            noBand(state);
            assert(state.dock.title === '蒸らしは30 秒くらい', `title ${state.dock.title}`);
            assert(state.dock.head.text.includes(HINT), `hint missing: ${state.dock.head.text}`);
            await shot(cdp, '01-select-1.png');
            return { selbar: state.selbar, bands: state.relation.bandsBetweenDockAndFooter, dock: state.dock.box, footer: state.footer, head: state.dock.head, selected: state.selected };
        });
        await check('2 3 行の選択: 帯なし・ヘッダー「3 行を選択中」・ドックの高さとタブは不変', async () => {
            await selectThree(cdp);
            const state = await layout(cdp);
            noBand(state);
            assert(state.dock.title === '3 行を選択中', `title ${state.dock.title}`);
            assert(state.dock.head.text.includes(HINT), `hint missing: ${state.dock.head.text}`);
            assert(state.dock.head.children.every(c => c.lines === 1), `head wraps: ${JSON.stringify(state.dock.head.children)}`);
            assert(state.dock.box.height === out.checks[0].detail?.dock?.height, `dock height ${state.dock.box.height} != ${out.checks[0].detail?.dock?.height}`);
            assert(JSON.stringify(state.dock.tabs.map(t => t.tab)) === JSON.stringify(['template', 'look', 'anim', 'emphasis', 'time']), `tabs ${JSON.stringify(state.dock.tabs)}`);
            await shot(cdp, '02-select-3.png');
            return { selbar: state.selbar, bands: state.relation.bandsBetweenDockAndFooter, dock: state.dock.box, footer: state.footer, head: state.dock.head, tabs: state.dock.tabs, selected: state.selected };
        });
        await check('3 3 行選択のまま右クリック: 選択行を結合 / 発話にぴったり / 選択行をカット・選択は 3 行のまま', async () => {
            await rightClickRow(cdp, 'c-0004');
            const menu = await evalOn(cdp, MENU);
            const state = await layout(cdp);
            const items = menu.flatMap(m => m.items);
            for (const [action, text] of [['merge-selected', '選択行を結合'], ['speech-tight', '発話にぴったり'], ['cut', '選択行をカット']]) {
                const item = items.find(i => i.action === action);
                assert(item && item.text.includes(text) && !item.disabled, `${action} ${JSON.stringify(item)}`);
            }
            assert(JSON.stringify(state.selected) === JSON.stringify(THREE), `selection ${state.selected}`);
            await shot(cdp, '03-row-context-3.png');
            await dismissPops(cdp);
            return { items, selected: state.selected };
        });
        await check('4 右クリック「選択行を結合」→ 3 行が 1 行 → Cmd+Z 1 手で byte 一致', async () => {
            await selectThree(cdp);
            const before = await raw('captions.json');
            assert(before === originalCaptions, 'captions.json differs from fixture before merge');
            await rightClickRow(cdp, 'c-0004');
            await menuAction(cdp, 'merge-selected');
            const merged = await waitRaw('captions.json', text => captionList(text).length === captionList(before).length - 2, 'captions merged to 1 row');
            const ids = captionList(merged).map(c => c.id);
            const survivors = THREE.filter(id => ids.includes(id));
            assert(survivors.length === 1, `survivors ${survivors}`);
            const joined = captionOf(merged, survivors[0]);
            await sleep(1200);
            const rowsAfter = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-row').length`);
            await shot(cdp, '04-merged.png');
            await undo(cdp);
            await waitRaw('captions.json', text => text === before, 'captions.json byte-identical after 1 undo');
            await sleep(1000);
            assert(await raw('captions.json') === before, 'captions.json changed again after undo');
            await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: 'rows restored', timeoutMs: 20_000 });
            await dismissNotifications(cdp);
            return { captionsBefore: captionList(before).length, captionsAfter: captionList(merged).length, rowsAfter,
                merged: { id: joined.id, text: joined.text, start: joined.start, end: joined.end }, undo: 'byte-identical after 1 Cmd+Z' };
        });
        await check('5 右クリック「発話にぴったり」→ 3 行とも speech-tight → Cmd+Z 1 手で byte 一致', async () => {
            await selectThree(cdp);
            const before = await raw('captions.json');
            await rightClickRow(cdp, 'c-0004');
            await menuAction(cdp, 'speech-tight');
            const changed = await waitRaw('captions.json', text => THREE.every(id => captionOf(text, id)?.display_timing === 'speech-tight'), '3 rows speech-tight');
            const others = captionList(changed).filter(c => !THREE.includes(c.id) && c.display_timing !== undefined).map(c => c.id);
            assert(others.length === 0, `other rows changed ${others}`);
            await shot(cdp, '05-speech-tight.png');
            await undo(cdp);
            await waitRaw('captions.json', text => text === before, 'captions.json byte-identical after 1 undo');
            await sleep(1000);
            assert(await raw('captions.json') === before, 'captions.json changed again after undo');
            await dismissNotifications(cdp);
            return { timings: THREE.map(id => captionOf(changed, id).display_timing), othersChanged: others, undo: 'byte-identical after 1 Cmd+Z' };
        });
        await check('6 右クリック「選択行をカット」→ edit.json に 3 行分のカット → 既存の「↩ 戻す」で byte 一致', async () => {
            // 映像ごとカットの取り消しは台本の履歴（Cmd+Z）ではなくカットの札の「↩ 戻す」が既存の経路（本変更で経路は不変）。
            await selectThree(cdp);
            const before = await raw('edit.json');
            assert(before === originalEdit, 'edit.json differs from fixture before cut');
            await rightClickRow(cdp, 'c-0004');
            const item = await menuAction(cdp, 'cut');
            const changed = await waitRaw('edit.json', text => text !== before, 'edit.json cut');
            const items = JSON.parse(changed).tracks.find(t => t.id === 'v-main').items;
            assert(items.length === 4, `main items after cut ${items.length}`);
            await waitEval(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length===3`, { label: '3 cut cells', timeoutMs: 20_000 });
            await sleep(800);
            await shot(cdp, '06-cut.png');
            await undo(cdp);
            await sleep(1500);
            const afterCmdZ = await raw('edit.json');
            const restore = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-cutcell .akari-daihon-rbtn')].find(x=>!x.disabled&&(x.textContent||'').includes('戻す'));if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
            assert(restore, 'restore button not found');
            await realClick(cdp, restore.x, restore.y);
            await waitRaw('edit.json', text => text === before, 'edit.json byte-identical after 戻す');
            await sleep(1000);
            assert(await raw('edit.json') === before, 'edit.json changed again after 戻す');
            await dismissNotifications(cdp);
            return { label: item.text, mainItemsAfterCut: items.map(i => ({ at: i.at, duration: i.duration, in: i.source?.in, out: i.source?.out })),
                cmdZChangedEdit: afterCmdZ !== changed, restore: 'byte-identical after 1 click of ↩ 戻す' };
        });
        await check('7 ドックのテンプレタブで 3 行に一括適用 → Cmd+Z 1 手で byte 一致', async () => {
            await selectThree(cdp);
            const before = await raw('captions.json');
            await clickAt(cdp, `${DOCK} [data-dock-tab="template"]`);
            await sleep(400);
            await clickAt(cdp, `${DOCK} .akari-daihon-tplcard[data-preset-id="subtitle-variety"]`);
            const changed = await waitRaw('captions.json', text => THREE.every(id => captionOf(text, id)?.style_preset === 'subtitle-variety'), '3 rows subtitle-variety');
            await shot(cdp, '07-template-3.png');
            await undo(cdp);
            await waitRaw('captions.json', text => text === before, 'captions.json byte-identical after 1 undo');
            await sleep(1000);
            assert(await raw('captions.json') === before, 'captions.json changed again after undo');
            await dismissNotifications(cdp);
            return { presets: THREE.map(id => captionOf(changed, id).style_preset), undo: 'byte-identical after 1 Cmd+Z' };
        });
        await check('8 1 行の右クリック: 次の行と結合 / 発話にぴったり / ここで切る が残る', async () => {
            await selectOne(cdp, 'c-0003');
            await rightClickRow(cdp, 'c-0003');
            const items = (await evalOn(cdp, MENU)).flatMap(m => m.items);
            for (const action of ['cut', 'split', 'merge-next', 'speech-tight', 'insert-below', 'delete']) {
                assert(items.some(i => i.action === action), `1-row menu lacks ${action}: ${JSON.stringify(items)}`);
            }
            assert(!items.some(i => i.action === 'merge-selected'), '1-row menu shows merge-selected');
            await shot(cdp, '08-row-context-1.png');
            await dismissPops(cdp);
            return { items };
        });
        await check('9 解除: ドックの ✕ / Esc で選択が外れる', async () => {
            await selectThree(cdp);
            await clickAt(cdp, `${DOCK} .akari-daihon-dock-close`);
            await sleep(600);
            const afterClose = await layout(cdp);
            assert(!afterClose.dock.open && afterClose.selected.length === 0, `✕: open=${afterClose.dock.open} selected=${afterClose.selected}`);
            await selectThree(cdp);
            await focusRows(cdp);
            await pressKey(cdp, 'Escape', 'Escape', 27, 0);
            await sleep(600);
            const afterEsc = await layout(cdp);
            assert(!afterEsc.dock.open && afterEsc.selected.length === 0, `Esc: open=${afterEsc.dock.open} selected=${afterEsc.selected}`);
            await shot(cdp, '09-cleared.png');
            return { close: { open: afterClose.dock.open, selected: afterClose.selected, selbarVisible: afterClose.selbar.visibleCount },
                escape: { open: afterEsc.dock.open, selected: afterEsc.selected, selbarVisible: afterEsc.selbar.visibleCount } };
        });
        out.final = { captionsUnchanged: await raw('captions.json') === originalCaptions, editUnchanged: await raw('edit.json') === originalEdit };
    } finally { await stop(session); }
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
}
if (out.status !== 'pass') process.exitCode = 1;
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, checks: out.checks.map(c => ({ name: c.name, pass: c.pass, error: c.error })), final: out.final, error: out.error })}\n`);
