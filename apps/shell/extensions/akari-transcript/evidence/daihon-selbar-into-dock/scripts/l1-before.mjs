#!/usr/bin/env node
// BEFORE（変更前ビルド）: 行を 1 行・3 行選んだときの選択バーの位置と高さ（文言の折れ）と、ドックとの位置関係を記録する。
// 使い方: node l1-before.mjs <fixture dir> [--port=9475]
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';
import { DOCK, LAYOUT, MENU, ROW } from './l1-measure.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-selbar-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9475);
const RUNS = path.join(os.tmpdir(), 'daihon-selbar-into-dock-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-before.json');
const SHIFT = 8;
const out = { phase: 'before', status: 'running', observations: {}, screenshots: [] };

async function shot(cdp, name) { await sleep(500); await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); }
async function clickRowBlank(cdp, id, modifiers = 0) {
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(ROW(id))});r.scrollIntoView({block:'start'});const b=r.getBoundingClientRect();const x=b.right-10,y=b.top+6;return{x,y,inRow:r.contains(document.elementFromPoint(x,y))}})()`);
    if (!p.inRow) throw new Error(`${id} blank point is covered`);
    await realClick(cdp, p.x, p.y, { modifiers });
}
async function rightClickRow(cdp, id) {
    const p = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(ROW(id))}).getBoundingClientRect();return{x:b.right-10,y:b.top+6}})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 });
}

try {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(FIXTURE, 'dock'), port: PORT, isoDir: path.join(RUNS, 'before') });
    try {
        const { cdp } = session;
        await evalOn(cdp, command('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=8&&document.querySelectorAll('.akari-daihon-placed-tag').length>=2`, { label: 'daihon rows', timeoutMs: 240_000 });
        await sleep(2500);
        out.observations.idle = await evalOn(cdp, LAYOUT);
        await shot(cdp, 'before-00-idle.png');

        // 1 行目 = c-0005 をクリック → Shift+クリックで c-0003（上側。ドックに覆われない位置）まで広げて 3 行
        await clickRowBlank(cdp, 'c-0005');
        await waitEval(cdp, `document.querySelector(${S(DOCK)})?.classList.contains('open')`, { label: 'dock open', timeoutMs: 15_000 });
        await sleep(900);
        out.observations.select1 = await evalOn(cdp, LAYOUT);
        await shot(cdp, 'before-01-select-1.png');
        await saveJson(RESULTS, out);

        await clickRowBlank(cdp, 'c-0003', SHIFT);
        await sleep(900);
        out.observations.select3 = await evalOn(cdp, LAYOUT);
        await shot(cdp, 'before-02-select-3.png');
        await saveJson(RESULTS, out);

        // 3 行選択のまま行を右クリックしたときのメニューと選択
        await rightClickRow(cdp, 'c-0004');
        await sleep(700);
        out.observations.rightClickIn3 = { menu: await evalOn(cdp, MENU), layout: await evalOn(cdp, LAYOUT) };
        await shot(cdp, 'before-03-row-context.png');
    } finally { await stop(session); }
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
}
await saveJson(RESULTS, out);
const o = out.observations;
const brief = key => o[key] && { selbar: o[key].selbar.box, countText: o[key].selbar.countText, countLines: o[key].selbar.countLines,
    buttons: o[key].selbar.buttons.map(b => `${b.text}:${b.lines}`), dock: o[key].dock.box, title: o[key].dock.title, band: o[key].relation.bandBelowDockPx };
process.stdout.write(`${JSON.stringify({ status: out.status, select1: brief('select1'), select3: brief('select3'), menu: o.rightClickIn3?.menu, error: out.error })}\n`);
