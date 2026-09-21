#!/usr/bin/env node
// AFTER（変更後ビルド）の台本パネルで、置いた文字のバー・札・範囲編集・一括操作の除外を実機で確かめる。
// 使い方: node l1-after.mjs <fixture dir> [--port=9441]
// fixture は gen-fixture.mjs で作る（placed = 話した言葉 8 行 + 置いた文字 4 本 / none = 置いた文字 0 本）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
    ROW_METRICS, S, clickSelector, command, evalOn, launch, pressKey, sanitize, saveJson, screenshot, sleep, stop, waitEval
} from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'dptb-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9441);
const RUNS = path.join(os.tmpdir(), 'dptb-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-after.json');
const out = { phase: 'after', status: 'running', checks: [], screenshots: [], measured: {} };
const PLACED_IDS = ['p-a', 'p-b', 'p-c', 'p-d'];
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
const captionsOf = async project => {
    const parsed = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
    return Array.isArray(parsed) ? parsed : parsed.captions;
};
const byId = (captions, id) => captions.find(caption => caption.id === id);
async function waitCaptions(project, predicate, label) {
    const deadline = Date.now() + 30_000;
    let last;
    while (Date.now() < deadline) {
        try { last = await captionsOf(project); if (predicate(last)) return last; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}

// バー・札・列の DOM 実測（computed style）。
const PLACED_METRICS = `(()=>{const px=v=>Math.round(v*100)/100;const rows=[...document.querySelectorAll('.akari-daihon-row')];const list=document.querySelector('.akari-daihon-rows');return{
  rowCount:rows.length,rowIds:rows.map(r=>r.dataset.captionId),hasPlacedBars:list.classList.contains('has-placed-bars'),placedWidthVar:getComputedStyle(list).getPropertyValue('--placed-width').trim(),
  columns:rows.map(r=>{const c=r.querySelector('.akari-daihon-placed-columns');if(!c)return null;const cs=getComputedStyle(c);return{width:px(c.getBoundingClientRect().width),computedWidth:cs.width,laneCount:c.dataset.laneCount,paddingLeft:cs.paddingLeft,paddingRight:cs.paddingRight,bars:[...c.querySelectorAll('.akari-daihon-placed-bar')].map(b=>{const bs=getComputedStyle(b);const br=b.getBoundingClientRect();return{id:b.dataset.captionId,lane:b.dataset.lane,width:px(br.width),computedWidth:bs.width,left:px(br.left-c.getBoundingClientRect().left),top:px(br.top-r.getBoundingClientRect().top),bottomGap:px(r.getBoundingClientRect().bottom-br.bottom),height:px(br.height),borderRadius:bs.borderRadius,background:bs.backgroundColor,first:b.classList.contains('first'),last:b.classList.contains('last')}})}}),
  rowPadding:rows.map(r=>getComputedStyle(r).paddingLeft),
  tags:[...document.querySelectorAll('.akari-daihon-placed-tag')].map(t=>{const s=getComputedStyle(t);return{id:t.dataset.captionId,row:t.closest('.akari-daihon-row')?.dataset.captionId,text:t.textContent,borderTopWidth:s.borderTopWidth,borderRightWidth:s.borderRightWidth,borderBottomWidth:s.borderBottomWidth,borderLeftWidth:s.borderLeftWidth,borderLeftStyle:s.borderLeftStyle,boxShadow:s.boxShadow,background:s.backgroundColor,color:s.color,borderRadius:s.borderRadius}})}})()`;
const barsOf = (metrics, id) => metrics.columns.flatMap((column, row) => (column?.bars ?? []).filter(bar => bar.id === id).map(bar => ({ ...bar, row })));

async function openDaihon(session, rows) {
    await evalOn(session.cdp, command('akari.daihon.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===${rows}`, { label: `${rows} daihon rows`, timeoutMs: 240_000 });
    await sleep(1500);
}

try {
    // --- 置いた文字 4 本 ---
    const project = path.join(FIXTURE, 'placed');
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(RUNS, 'after-placed') });
    try {
        await openDaihon(session, 8);
        await clickSelector(session.cdp, '.akari-daihon-title').catch(() => {});
        await shot(session.cdp, 'after-01-placed.png');
        const metrics = await evalOn(session.cdp, PLACED_METRICS);
        out.measured.placed = metrics;
        out.measured.placedRows = await evalOn(session.cdp, ROW_METRICS);

        await check('台本の行は話した言葉の 8 行だけ', () => {
            assert(metrics.rowCount === 8, `rows ${metrics.rowCount}`);
            assert(metrics.rowIds.every(id => id.startsWith('s-')), `row ids ${metrics.rowIds}`);
            return { rowCount: metrics.rowCount, rowIds: metrics.rowIds };
        });
        await check('バーの列は 2 本・列の総幅 10px（4+2+4）・バー幅 4px・余白なし', () => {
            const widths = [...new Set(metrics.columns.map(column => column.width))];
            const laneCounts = [...new Set(metrics.columns.map(column => column.laneCount))];
            const bars = metrics.columns.flatMap(column => column.bars);
            assert(widths.length === 1 && widths[0] === 10, `column widths ${widths}`);
            assert(laneCounts.length === 1 && laneCounts[0] === '2', `lane counts ${laneCounts}`);
            assert(bars.every(bar => bar.width === 4 && bar.computedWidth === '4px'), 'bar width');
            assert(metrics.columns.every(column => column.paddingLeft === '0px' && column.paddingRight === '0px'), 'column padding');
            const lefts = [...new Set(bars.map(bar => `${bar.lane}:${bar.left}`))].sort();
            return { columnWidth: widths[0], laneCount: 2, barWidths: [...new Set(bars.map(bar => bar.computedWidth))], laneLefts: lefts };
        });
        await check('全体 = 8 行・3 行と 2 行は同じ列・1 行だけはバー無し', () => {
            const a = barsOf(metrics, 'p-a'), b = barsOf(metrics, 'p-b'), c = barsOf(metrics, 'p-c'), d = barsOf(metrics, 'p-d');
            assert(a.length === 8 && a[0].row === 0 && a.at(-1).row === 7, `p-a rows ${a.map(x => x.row)}`);
            assert(b.length === 3 && b[0].row === 1 && b.at(-1).row === 3, `p-b rows ${b.map(x => x.row)}`);
            assert(d.length === 2 && d[0].row === 5 && d.at(-1).row === 6, `p-d rows ${d.map(x => x.row)}`);
            assert(c.length === 0, 'p-c has bars');
            assert(new Set(b.map(x => x.lane)).size === 1 && b[0].lane === d[0].lane, 'p-b and p-d lane');
            assert(a[0].lane !== b[0].lane, 'p-a lane distinct');
            assert(b[0].first && b[0].top === 3 && b.at(-1).last && b.at(-1).bottomGap === 3, 'first/last inset 3px');
            assert(b[1].top === 0 && b[1].bottomGap === 0, 'middle bar full height');
            return {
                'p-a': { rows: a.map(x => x.row), lane: a[0].lane }, 'p-b': { rows: b.map(x => x.row), lane: b[0].lane },
                'p-c': { rows: [], lane: null }, 'p-d': { rows: d.map(x => x.row), lane: d[0].lane },
                firstBar: { top: b[0].top, radius: b[0].borderRadius }, lastBar: { bottomGap: b.at(-1).bottomGap, radius: b.at(-1).borderRadius }
            };
        });
        await check('札は先頭行に 4 枚・枠線 0・左の縦線なし・N 行 / 全体の添え書き', () => {
            const tags = metrics.tags;
            assert(tags.length === 4, `tags ${tags.length}`);
            const expectRow = { 'p-a': 's-1', 'p-b': 's-2', 'p-c': 's-5', 'p-d': 's-6' };
            for (const tag of tags) {
                assert(expectRow[tag.id] === tag.row, `${tag.id} on ${tag.row}`);
                for (const key of ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) assert(tag[key] === '0px', `${tag.id} ${key} ${tag[key]}`);
            }
            const text = Object.fromEntries(tags.map(tag => [tag.id, tag.text]));
            assert(text['p-a'].endsWith('· 全体') && text['p-b'].endsWith('· 3 行') && text['p-d'].endsWith('· 2 行') && !text['p-c'].includes('·'), S(text));
            return tags;
        });
        await check('行の左余白 = 元の 8px + 列 10px', () => {
            assert(metrics.rowPadding.every(value => value === '18px'), S(metrics.rowPadding));
            return { rowPaddingLeft: metrics.rowPadding[0], rowTextLeft: out.measured.placedRows[0].rowText.left };
        });

        await check('選択なしのテンプレ一括適用で置いた文字の style_preset が変わらない', async () => {
            await clickSelector(session.cdp, '.akari-daihon-tpl');
            await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-tplcard').length>0`, { label: 'preset cards' });
            const title = await evalOn(session.cdp, `document.querySelector('.akari-daihon-pttl')?.textContent`);
            await clickSelector(session.cdp, '.akari-daihon-tplcard[data-preset-id="subtitle-news"]');
            await clickSelector(session.cdp, '.akari-daihon-tplfoot button.primary');
            const after = await waitCaptions(project, list => list.filter(c => c.id.startsWith('s-')).every(c => c.style_preset === 'subtitle-news'), 'spoken rows preset');
            const placed = Object.fromEntries(PLACED_IDS.map(id => [id, byId(after, id).style_preset ?? null]));
            assert(Object.values(placed).every(value => value === null), S(placed));
            return { pickerTitle: title, spokenPreset: 'subtitle-news', placedPreset: placed };
        });

        await check('無音の一括短縮の提案に置いた文字が現れない', async () => {
            const chips = await evalOn(session.cdp, `[...document.querySelectorAll('.akari-daihon-gapchip')].map(c=>({row:c.closest('.akari-daihon-row')?.dataset.captionId,text:c.textContent}))`);
            assert(chips.every(chip => chip.row?.startsWith('s-')), S(chips));
            return { gapChips: chips };
        });

        await check('札クリック → 選択・範囲編集、「後ろへ 1 行広げる」で end が次の行の終わりへ・バーが 1 行伸びる', async () => {
            await clickSelector(session.cdp, '.akari-daihon-placed-tag[data-caption-id="p-b"]');
            await waitEval(session.cdp, `(()=>{const e=document.querySelector('.akari-daihon-placed-editor');return e&&!e.hidden&&e.dataset.captionId==='p-b'})()`, { label: 'placed editor' });
            const editor = await evalOn(session.cdp, `(()=>{const e=document.querySelector('.akari-daihon-placed-editor');return{text:e.innerText,actions:[...e.querySelectorAll('[data-action]')].map(b=>({action:b.dataset.action,label:b.textContent,disabled:b.disabled})),tagSelected:document.querySelector('.akari-daihon-placed-tag[data-caption-id="p-b"]').classList.contains('selected'),tagBorder:getComputedStyle(document.querySelector('.akari-daihon-placed-tag[data-caption-id="p-b"]')).borderTopWidth,selectedBars:document.querySelectorAll('.akari-daihon-placed-bar.selected[data-caption-id="p-b"]').length}})()`);
            await shot(session.cdp, 'after-02-selected.png');
            await clickSelector(session.cdp, '.akari-daihon-placed-actions [data-action="expand-end"]');
            const after = await waitCaptions(project, list => byId(list, 'p-b').end === 19.2, 'p-b end 19.2');
            await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-placed-bar[data-caption-id="p-b"]').length===4`, { label: 'p-b 4 bars' });
            const m = await evalOn(session.cdp, PLACED_METRICS);
            await shot(session.cdp, 'after-03-expand-end.png');
            const pb = byId(after, 'p-b');
            assert(pb.start === 4 && pb.time_domain === 'output', S(pb));
            return { editor, captionAfter: { start: pb.start, end: pb.end, time_domain: pb.time_domain }, barRows: barsOf(m, 'p-b').map(x => x.row), tag: m.tags.find(t => t.id === 'p-b').text, laneCount: m.columns[0].laneCount };
        });

        await check('Cmd+Z の 1 手で戻る', async () => {
            await pressKey(session.cdp, 'z', 'KeyZ', 90, META);
            const after = await waitCaptions(project, list => byId(list, 'p-b').end === 15.2, 'p-b end back to 15.2');
            await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-placed-bar[data-caption-id="p-b"]').length===3`, { label: 'p-b 3 bars' });
            const m = await evalOn(session.cdp, PLACED_METRICS);
            await shot(session.cdp, 'after-04-undo.png');
            const pb = byId(after, 'p-b');
            return { captionAfterUndo: { start: pb.start, end: pb.end, time_domain: pb.time_domain }, barRows: barsOf(m, 'p-b').map(x => x.row) };
        });

        await check('「全体」で最初の行から最後の行まで通る', async () => {
            await clickSelector(session.cdp, '.akari-daihon-placed-bar[data-caption-id="p-d"]');
            await waitEval(session.cdp, `document.querySelector('.akari-daihon-placed-editor')?.dataset.captionId==='p-d'&&!document.querySelector('.akari-daihon-placed-editor').hidden`, { label: 'p-d editor' });
            await clickSelector(session.cdp, '.akari-daihon-placed-actions [data-action="all"]');
            const after = await waitCaptions(project, list => byId(list, 'p-d').start === 0 && byId(list, 'p-d').end === 31.2, 'p-d whole');
            await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-placed-bar[data-caption-id="p-d"]').length===8`, { label: 'p-d 8 bars' });
            const m = await evalOn(session.cdp, PLACED_METRICS);
            await shot(session.cdp, 'after-05-all.png');
            const pd = byId(after, 'p-d');
            return { captionAfter: { start: pd.start, end: pd.end, time_domain: pd.time_domain }, barRows: barsOf(m, 'p-d').map(x => x.row), tag: m.tags.find(t => t.id === 'p-d').text, laneCount: m.columns[0].laneCount, columnWidth: m.columns[0].width };
        });

        await check('一括短縮を実行しても置いた文字は書き換えられない', async () => {
            const before = await captionsOf(project);
            await clickSelector(session.cdp, 'button.akari-daihon-silence');
            await waitEval(session.cdp, `[...document.querySelectorAll('.akari-daihon-pop button')].some(b=>b.textContent.includes('一括で詰める'))`, { label: 'silence pop' });
            await evalOn(session.cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-pop button')].find(b=>b.textContent.includes('一括で詰める'));b.setAttribute('data-l1','silence-apply');return true})()`);
            await clickSelector(session.cdp, '[data-l1="silence-apply"]');
            await sleep(3000);
            const footer = await evalOn(session.cdp, `document.querySelector('.akari-daihon-footer')?.textContent`);
            const after = await captionsOf(project);
            const edit = await readFile(path.join(project, 'edit.json'), 'utf8');
            const unchanged = PLACED_IDS.every(id => S(byId(before, id)) === S(byId(after, id)));
            assert(unchanged, 'placed captions changed');
            assert(!PLACED_IDS.some(id => edit.includes(`"${id}"`)), 'placed id referenced in edit.json');
            return { footer, placedUnchanged: unchanged, placedIdsInEditJson: 0 };
        });
    } finally { await stop(session); }

    // --- 置いた文字 0 本 ---
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'none'), port: PORT, isoDir: path.join(RUNS, 'after-none') });
    try {
        await openDaihon(session, 8);
        await clickSelector(session.cdp, '.akari-daihon-title').catch(() => {});
        await shot(session.cdp, 'after-06-none.png');
        const metrics = await evalOn(session.cdp, PLACED_METRICS);
        const rows = await evalOn(session.cdp, ROW_METRICS);
        out.measured.none = metrics;
        out.measured.noneRows = rows;
        await check('置いた文字 0 本: バーの列の幅 0・行の左余白と本文位置は BEFORE と同じ', async () => {
            const before = JSON.parse(await readFile(path.join(ROOT, 'results-before.json'), 'utf8')).fixtures.none.rows;
            assert(metrics.columns.every(column => !column || column.width === 0), 'column width');
            assert(!metrics.hasPlacedBars && metrics.tags.length === 0, 'bars/tags present');
            assert(metrics.rowPadding.every(value => value === '8px'), S(metrics.rowPadding));
            const same = rows.every((row, index) => row.rowText.left === before[index].rowText.left && row.height === before[index].height && row.timecode.left === before[index].timecode.left);
            assert(same, 'row geometry differs from BEFORE');
            return { columnWidths: [...new Set(metrics.columns.map(column => column?.width ?? 0))], rowPaddingLeft: metrics.rowPadding[0], rowTextLeft: { before: before[0].rowText.left, after: rows[0].rowText.left }, rowHeight: { before: before[0].height, after: rows[0].height } };
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
