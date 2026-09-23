#!/usr/bin/env node
// BEFORE（変更前ビルド）: HTML オーバーレイ・画像を持つ fixture で、台本に添付が何も出ないことを記録する。
// 使い方: node l1-before.mjs <fixture dir> [--port=9471]
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { clickSelector, command, evalOn, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-attachments-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9471);
const RUNS = path.join(os.tmpdir(), 'daihon-attachments-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-before.json');
const out = { phase: 'before', status: 'running', fixtures: {} };

// 台本の行ごとに、行の中に出ている札・棒（置いた文字・添付）の文字と数。
const ROW_ATTACH = `(()=>[...document.querySelectorAll('.akari-daihon-row')].map((row,index)=>({index,id:row.dataset.captionId,
  text:(row.querySelector('.akari-daihon-row-text')?.textContent||'').slice(0,20),
  tags:[...row.querySelectorAll('.akari-daihon-placed-tags > *')].map(t=>(t.textContent||'').trim()),
  bars:row.querySelectorAll('.akari-daihon-placed-bar').length,
  attachNodes:row.querySelectorAll('[class*=attach],[data-attachment-id],[data-item-id]').length})))()`;

try {
    for (const name of ['attach', 'many']) {
        const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, name), port: PORT,
            isoDir: path.join(RUNS, `before-${name}`) });
        try {
            await evalOn(session.cdp, command('akari.daihon.open'));
            const count = await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>0&&document.querySelectorAll('.akari-daihon-row').length`,
                { label: 'daihon rows', timeoutMs: 240_000 });
            await sleep(2500);
            await clickSelector(session.cdp, '.akari-daihon-title').catch(() => {});
            await sleep(500);
            const rows = await evalOn(session.cdp, ROW_ATTACH);
            const bodyHasAttachmentNames = await evalOn(session.cdp, `(()=>{const t=document.querySelector('.akari-daihon-rows')?.textContent||'';return{logo:t.includes('YouTube ロゴ'),lower:t.includes('下帯'),beans:t.includes('coffee-beans'),many:t.includes('帯 1')}})()`);
            const shot = `before-${name === 'attach' ? '01-attach' : '02-many'}.png`;
            await screenshot(session.cdp, path.join(ROOT, shot));
            out.fixtures[name] = { rowCount: count, rows, bodyHasAttachmentNames,
                attachmentTagCount: rows.reduce((sum, row) => sum + row.attachNodes, 0), screenshot: shot };
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
process.stdout.write(`${JSON.stringify({ status: out.status, fixtures: Object.fromEntries(Object.entries(out.fixtures).map(([k, v]) => [k, { rows: v.rowCount, names: v.bodyHasAttachmentNames, attachNodes: v.attachmentTagCount }])), error: out.error })}\n`);
