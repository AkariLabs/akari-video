#!/usr/bin/env node
// BEFORE（変更前ビルド）の台本パネルを実機で撮り、行数と行の寸法を記録する。
// 使い方: node l1-before.mjs <fixture dir> [--port=9441]
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROW_METRICS, clickSelector, command, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval, evalOn } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'dptb-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9441);
const RUNS = path.join(os.tmpdir(), 'dptb-l1', 'runs');
const out = { phase: 'before', status: 'running', fixtures: {} };
const RESULTS = path.join(ROOT, 'results-before.json');

try {
    for (const name of ['placed', 'none']) {
        const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, name), port: PORT, isoDir: path.join(RUNS, `before-${name}`) });
        try {
            await evalOn(session.cdp, command('akari.daihon.open'));
            const count = await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>0&&document.querySelectorAll('.akari-daihon-row').length`, { label: 'daihon rows', timeoutMs: 240_000 });
            await sleep(1500);
            await clickSelector(session.cdp, '.akari-daihon-title').catch(() => {});
            await sleep(500);
            const metrics = await evalOn(session.cdp, ROW_METRICS);
            const shot = `before-${name === 'placed' ? '01-placed' : '02-none'}.png`;
            await screenshot(session.cdp, path.join(ROOT, shot));
            out.fixtures[name] = { rowCount: count, rowIds: metrics.map(m => m.id), rows: metrics, screenshot: shot };
            await saveJson(RESULTS, out);
        } finally { await stop(session); }
    }
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, rows: Object.fromEntries(Object.entries(out.fixtures).map(([k, v]) => [k, v.rowCount])), error: out.error })}\n`);
