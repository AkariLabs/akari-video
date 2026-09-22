#!/usr/bin/env node
// 置いた文字の「文字」行 L1（AFTER・ラッパー作成の検証スクリプト）。
// 使い方: node l1-after.mjs <repo（本タスクのビルド）> <project（話した言葉 4 行の案件の写し）> [--port=9451]
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { command, launch, pressKey, sanitize, saveJson, screenshot, sleep, stop } from './l1-lib.mjs';
import { evalOn, realClick, realDrag } from './cdp-lib.mjs';
import { CHIPS, PLATES, ROW_LABELS, S, captionsOf, openProject, overlaps, shellCall, view, waitFor } from './l1-common.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [repo, project] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9451);
const SHELL = path.join(repo, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const RESULTS = path.join(ROOT, 'results-after.json');
const CAPTIONS = path.join(project, 'captions.json');
const out = { status: 'running', checks: [], screenshots: [] };
const assert = (c, m) => { if (!c) throw new Error(m); };
async function check(name, op) {
    const rec = { name, pass: false }; out.checks.push(rec);
    try { rec.detail = await op(); rec.pass = true; } catch (e) { rec.error = sanitize(e, repo); }
    finally { await saveJson(RESULTS, out); }
    return rec.detail;
}
async function shot(cdp, name) { await sleep(700); await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); }
const bytes = () => readFile(CAPTIONS, 'utf8');
const blur = cdp => evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
const cmdZ = async cdp => { await blur(cdp); await pressKey(cdp, 'z', 'KeyZ', 90, 4); };
const chip = async (cdp, id) => (await evalOn(cdp, CHIPS)).find(c => c.id === id);
const PLACED = ['置いた文字 1', '置いた文字 2', '置いた文字 3'];

let session;
try {
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(os.tmpdir(), 'ptor-l1', 'run-after') });
    await openProject(session, project, 4, PORT);
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`));
    await sleep(1500);
    const v = await view(PORT);
    const ids = await check('話した言葉がある時刻（3〜6 秒）に置いた文字を 3 本置ける', async () => {
        const got = [];
        for (const text of PLACED) {
            got.push(await evalOn(session.cdp, command('akari.caption.placeText', { start: 3, end: 6, text })));
            await waitFor(`${text} saved`, async () => (await captionsOf(project)).some(c => c.text === text));
            await sleep(800);
        }
        const rows = (await captionsOf(project)).filter(c => c.time_domain === 'output');
        assert(rows.length === 3 && rows.every(r => r.start === 3 && r.end === 6), S(rows));
        return { commandResults: got, rows: rows.map(r => ({ id: r.id, start: r.start, end: r.end, time_domain: r.time_domain, text: r.text })) };
    });
    const placedIds = (await captionsOf(project)).filter(c => c.time_domain === 'output').map(c => c.id);
    await check('「文字」行が「字幕」行の直上に出て、「字幕」行には話した言葉だけ・3 本は重ならない段に詰まる', async () => {
        await sleep(1000);
        const labels = await evalOn(session.cdp, ROW_LABELS);
        const chips = await evalOn(session.cdp, CHIPS);
        const moji = labels.find(l => l.text === '文字'), jimaku = labels.find(l => l.text === '字幕');
        assert(moji && jimaku && moji.top < jimaku.top, S(labels));
        const placed = chips.filter(c => placedIds.includes(c.id)), spoken = chips.filter(c => !placedIds.includes(c.id));
        assert(placed.length === 3, S(chips));
        const placedLanes = [...new Set(placed.map(c => c.lane))], spokenLanes = [...new Set(spoken.map(c => c.lane))];
        assert(placedLanes.length === 1 && !spokenLanes.includes(placedLanes[0]), S({ placedLanes, spokenLanes }));
        const tops = [...new Set(placed.map(c => c.top))];
        assert(tops.length >= 2, `tops ${S(tops)}`);
        const pairs = [];
        for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) if (overlaps(chips[i], chips[j])) pairs.push([chips[i].id, chips[j].id]);
        assert(pairs.length === 0, `overlapping chips ${S(pairs)}`);
        assert(Math.max(...placed.map(c => c.top + c.height)) <= jimaku.top + 4, 'placed chips must sit above 字幕 row');
        return { labels, placed, spoken: spoken.map(c => ({ id: c.id, lane: c.lane, top: c.top })), placedTops: tops, overlappingPairs: 0 };
    });
    await check('チップの色は台本と同じ置いた文字の色（id 順で循環）・文言はテキストの先頭', async () => {
        const chips = await evalOn(session.cdp, CHIPS);
        const placed = placedIds.slice().sort().map(id => chips.find(c => c.id === id));
        const colors = placed.map(c => c.bg);
        assert(new Set(colors).size === 3, S(colors));
        assert(placed.every((c, i) => c.text.startsWith(PLACED[i].slice(0, 5))), S(placed.map(c => c.text)));
        const vars = await evalOn(session.cdp, `${S(placed.map(c => c.id))}.map(id=>document.querySelector('.akari-annotations-strip-caption[data-akari-item-id="'+id+'"]').style.getPropertyValue('--akari-placed-text-color'))`);
        return { ids: placed.map(c => c.id), bg: colors, colorVars: vars, text: placed.map(c => c.text) };
    });
    await check('プレビュー（4 秒）に置いた文字 3 本 + 話した言葉 1 本', async () => {
        const plates = await waitFor('4 plates', async () => { const p = await v.eval(PLATES); return p.length >= 4 && p; });
        assert(PLACED.every(t => plates.some(p => p.text === t)) && plates.some(p => p.text.startsWith('まずはコーヒー')), S(plates));
        return plates;
    });
    await shot(session.cdp, 'after-01-placed-text-row.png');

    const target = placedIds[1];
    await check('チップをクリック → プレビューの選択と同期', async () => {
        const c = await chip(session.cdp, target);
        await realClick(session.cdp, c.left + c.width / 2, c.top + c.height / 2);
        const sel = await waitFor('preview selection', async () => { const s = await v.eval(`[...document.querySelectorAll('.caption-row-plate[data-selected]')].map(p=>p.id)`); return s.length > 0 && s; }, 10_000);
        assert(sel.some(id => id === `caption-plate-${target}`), S(sel));
        return { clicked: target, previewSelected: sel };
    });
    await check('ドラッグで時刻移動（長さ・time_domain 不変）→ Cmd+Z 1 手で byte 一致', async () => {
        const before = await bytes();
        const c = await chip(session.cdp, target);
        const y = c.top + c.height / 2, x = c.left + c.width / 2;
        await realDrag(session.cdp, [{ x, y }, { x: x + 90, y }], { steps: 12, stepDelayMs: 24 });
        const moved = await waitFor('moved', async () => { const r = (await captionsOf(project)).find(x => x.id === target); return r.start !== 3 && r; });
        assert(Math.abs((moved.end - moved.start) - 3) < 1e-6 && moved.time_domain === 'output', S(moved));
        const others = (await captionsOf(project)).filter(r => r.time_domain === 'output' && r.id !== target);
        assert(others.every(r => r.start === 3 && r.end === 6), 'others moved');
        await sleep(800);
        await cmdZ(session.cdp);
        await waitFor('undo bytes', async () => (await bytes()) === before, 15_000);
        return { moved: { start: moved.start, end: moved.end, time_domain: moved.time_domain }, undoByteEqual: true };
    });
    await check('端を掴んで長さ変更（start 不変・time_domain 不変）→ Cmd+Z 1 手で byte 一致', async () => {
        const before = await bytes();
        await sleep(800);
        const c = await chip(session.cdp, target);
        const y = c.top + c.height / 2, x = c.left + c.width - 2;
        await realDrag(session.cdp, [{ x, y }, { x: x + 60, y }], { steps: 12, stepDelayMs: 24 });
        const resized = await waitFor('resized', async () => { const r = (await captionsOf(project)).find(x => x.id === target); return r.end !== 6 && r; });
        assert(resized.start === 3 && resized.end > 6 && resized.time_domain === 'output', S(resized));
        await sleep(800);
        await cmdZ(session.cdp);
        await waitFor('undo bytes', async () => (await bytes()) === before, 15_000);
        return { resized: { start: resized.start, end: resized.end, time_domain: resized.time_domain }, undoByteEqual: true };
    });
    for (const [action, label] of [['duplicate', '複製'], ['delete', '削除']]) {
        await check(`右クリック →「${label}」→ Cmd+Z 1 手で byte 一致`, async () => {
            const before = await bytes();
            await sleep(800);
            const c = await chip(session.cdp, target);
            const x = c.left + c.width / 2, y = c.top + c.height / 2;
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
            const items = await waitFor('menu', async () => { const m = await evalOn(session.cdp, `[...document.querySelectorAll('[data-akari-context-menu] [data-akari-context-item]')].map(b=>({id:b.dataset.akariContextItem,label:b.textContent,disabled:b.disabled}))`); return m.length > 0 && m; }, 10_000);
            await shot(session.cdp, `after-0${action === 'duplicate' ? 2 : 3}-context-menu-${action}.png`);
            const btn = await evalOn(session.cdp, `(()=>{const b=document.querySelector('[data-akari-context-menu] [data-akari-context-item="${action}"]');const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
            await realClick(session.cdp, btn.x, btn.y);
            const rows = await waitFor(`${action} applied`, async () => { const r = await captionsOf(project); return (await bytes()) !== before && r; }, 15_000);
            const output = rows.filter(r => r.time_domain === 'output');
            if (action === 'duplicate') assert(output.length === 4, S(output));
            else assert(output.length === 2 && !output.some(r => r.id === target), S(output));
            await sleep(1000);
            const chipsNow = await evalOn(session.cdp, CHIPS);
            await cmdZ(session.cdp);
            await waitFor('undo bytes', async () => (await bytes()) === before, 15_000);
            return { menu: items, outputRowsAfter: output.map(r => ({ id: r.id, start: r.start, end: r.end, time_domain: r.time_domain, text: r.text })), placedChipsAfter: chipsNow.filter(c => !['c-0001', 'c-0002', 'c-0003', 'c-0004'].includes(c.id)).map(c => ({ id: c.id, top: c.top, left: c.left })), undoByteEqual: true };
        });
    }
    await shot(session.cdp, 'after-04-after-undo.png');
    v.cdp.close();
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (e) {
    out.status = 'error'; out.error = sanitize(e, repo);
} finally {
    await saveJson(RESULTS, out);
    await stop(session);
}
console.log(JSON.stringify({ status: out.status, checks: out.checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.error ? ` — ${c.error.slice(0, 300)}` : ''}`) }, null, 2));
