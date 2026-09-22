#!/usr/bin/env node
// 手順 0 の再現（BEFORE・ラッパー作成の検証スクリプト）。
// 使い方: node l1-before.mjs <repo（基点のビルド）> <project（話した言葉 4 行の案件の写し）> [--port=9451]
// (a) 置いた文字 1 本目のチップが「字幕」行の話した言葉のチップと重なって描かれる
// (b) 同じ時刻の 2 本目が「同じ時間に置いた文字が既にあります」で拒否される
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { command, launch, sanitize, saveJson, screenshot, sleep, stop } from './l1-lib.mjs';
import { evalOn } from './cdp-lib.mjs';
import { CHIPS, NOTICES, PLATES, ROW_LABELS, S, captionsOf, openProject, overlaps, shellCall, view, waitFor } from './l1-common.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [repo, project] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9451);
const SHELL = path.join(repo, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const RESULTS = path.join(ROOT, 'results-before.json');
const out = { status: 'running', checks: [], screenshots: [] };
const assert = (c, m) => { if (!c) throw new Error(m); };
async function check(name, op) {
    const rec = { name, pass: false }; out.checks.push(rec);
    try { rec.detail = await op(); rec.pass = true; } catch (e) { rec.error = sanitize(e, repo); }
    finally { await saveJson(RESULTS, out); }
    return rec.detail;
}
async function shot(cdp, name) { await sleep(700); await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); }

let session;
try {
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(os.tmpdir(), 'ptor-l1', 'run-before') });
    await openProject(session, project, 4, PORT);
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`));
    await sleep(1500);
    const v = await view(PORT);
    const id1 = await evalOn(session.cdp, command('akari.caption.placeText', { start: 3, end: 6, text: '置いた文字 1' }));
    await check('(a) 1 本目のチップが「字幕」行の話した言葉のチップと重なる', async () => {
        const row = await waitFor('placed row', async () => (await captionsOf(project)).find(c => c.time_domain === 'output'));
        const chips = await waitFor('placed chip', async () => { const x = await evalOn(session.cdp, CHIPS); return x.some(c => c.id === row.id) && x; });
        const placed = chips.find(c => c.id === row.id), spoken = chips.find(c => c.id === 'c-0002');
        assert(overlaps(placed, spoken), S({ placed, spoken }));
        return { commandResult: id1, row: { id: row.id, start: row.start, end: row.end, time_domain: row.time_domain }, placed, spoken, sameTop: placed.top === spoken.top, rowLabels: await evalOn(session.cdp, ROW_LABELS) };
    });
    await shot(session.cdp, 'before-01-chip-overlaps-spoken.png');
    await check('(b) 同じ時刻の 2 本目は「同じ時間に置いた文字が既にあります」で入らない', async () => {
        const before = await readFile(path.join(project, 'captions.json'), 'utf8');
        let result, thrown = null;
        try { result = await evalOn(session.cdp, command('akari.caption.placeText', { start: 3, end: 6, text: '置いた文字 2' })); } catch (e) { thrown = sanitize(e, repo).slice(0, 300); }
        const notices = await waitFor('notice', async () => { const n = await evalOn(session.cdp, NOTICES); return n.some(t => t.includes('同じ時間に置いた文字が既にあります')) && n; }, 15_000);
        await sleep(1500);
        const after = await readFile(path.join(project, 'captions.json'), 'utf8');
        assert(before === after, 'captions.json changed');
        return { commandResult: result ?? null, thrown, notices, captionsUnchanged: true, outputRows: (await captionsOf(project)).filter(c => c.time_domain === 'output').length };
    });
    await shot(session.cdp, 'before-02-second-rejected.png');
    await check('プレビュー（参考）', async () => v.eval(PLATES));
    v.cdp.close();
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (e) {
    out.status = 'error'; out.error = sanitize(e, repo);
} finally {
    await saveJson(RESULTS, out);
    await stop(session);
}
console.log(JSON.stringify({ status: out.status, checks: out.checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.error ? ` — ${c.error.slice(0, 200)}` : ''}`) }, null, 2));
