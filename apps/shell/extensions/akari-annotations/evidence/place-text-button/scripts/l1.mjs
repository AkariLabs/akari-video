#!/usr/bin/env node
// 文字をすぐ置く L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <fixture dir> [--port=9443]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウス・実キーで操作する。
import { readFile, access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CDP, evalOn, listTargets, realDragMod } from './cdp-lib.mjs';
import { S, clickSelector, command, launch, pressKey, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'ptb-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9443);
const RUNS = path.join(os.tmpdir(), 'ptb-l1', 'runs');
const RESULTS = path.join(ROOT, 'results-l1.json');
const out = { status: 'running', checks: [], screenshots: [], measured: {} };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO); throw error; }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
async function shot(cdp, name) { await sleep(600); await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); }
const exists = file => access(file).then(() => true, () => false);
const captionsOf = async project => { const p = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')); return Array.isArray(p) ? p : p.captions; };
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;
const cmdZ = cdp => pressKey(cdp, 'z', 'KeyZ', 90, 4);
const cmdShiftZ = cdp => pressKey(cdp, 'z', 'KeyZ', 90, 12);
const blur = cdp => evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);

async function view(port) {
    // 字幕ファイルの新規作成などで webview が作り直されるので、失敗したらターゲットと文脈を取り直す。
    let cdp, ctx;
    const attach = async () => {
        cdp?.close();
        const target = await waitFor('webview target', async () => (await listTargets(port)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)), 120_000);
        cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
        const contexts = []; cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
        await cdp.send('Runtime.enable');
        await waitFor('preview stage', async () => {
            for (const c of [undefined, ...contexts.map(c => c.id)]) { try { if (await evalOn(cdp, `Boolean(document.getElementById('preview-stage'))`, c)) { ctx = c; return true; } } catch {} }
            return false;
        }, 120_000);
    };
    await attach();
    return {
        get cdp() { return cdp; },
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }
    };
}
const PLATES = `[...document.querySelectorAll('.caption-row-plate')].map(p=>{const l=p.querySelector('.akari-caption__line')||p;const r=l.getBoundingClientRect();const f=document.getElementById('preview-stage').querySelector('canvas,video')?.getBoundingClientRect();return{id:p.id,text:(l.textContent||'').trim(),cx:r.x+r.width/2,cy:r.y+r.height/2,left:r.x,w:r.width}})`;
const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height,cx:c.x+c.width/2,cy:c.y+c.height/2}:null})()`;
const NOTICES = `[...document.querySelectorAll('.theia-notification-toasts .theia-notification-list-item')].map(e=>e.textContent.trim())`;

async function openProject(session, project, seek) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-timeline-place-text'))`, { label: 'timeline button' });
    // プレビューが開くまで出力時刻のシークを繰り返す（開いていなければシークが開く）。
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await sleep(2000);
}

try {
    // ===== nocap: captions.json の無い案件・タイムラインの入口 =====
    const nocap = path.join(FIXTURE, 'nocap');
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project: nocap, port: PORT, isoDir: path.join(RUNS, 'nocap') });
    try {
        await openProject(session, nocap, 0);
        await check('狭いタイムラインでもボタンが 1 行（潰れない）', async () => {
            const m = await evalOn(session.cdp, `(()=>{const b=document.querySelector('.akari-timeline-place-text');const r=b.getBoundingClientRect();const s=getComputedStyle(b);const prev=b.previousElementSibling;return{width:r.width,height:r.height,whiteSpace:s.whiteSpace,text:b.textContent,prevTitle:prev?.getAttribute('title'),panelWidth:b.closest('.lm-Widget.akari-annotations, .theia-bottom-content-panel, .lm-DockPanel')?.getBoundingClientRect().width??null}})()`);
            assert(m.width > 60 && m.height < 40 && m.whiteSpace === 'nowrap', S(m));
            assert(m.prevTitle === '仮枠 (F)', `neighbour ${m.prevTitle}`);
            return m;
        });
        await shot(session.cdp, 'l1-01-narrow-toolbar.png');
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left');s.collapsePanel('right')`));
        await sleep(1500);
        const v = await view(PORT);
        assert(!(await exists(path.join(nocap, 'captions.json'))), 'fixture already has captions.json');
        await clickSelector(session.cdp, '.akari-timeline-place-text');
        const created = await check('captions.json が無い案件で押すと output 域の行が 1 本できる', async () => {
            const list = await waitFor('captions.json created', async () => (await exists(path.join(nocap, 'captions.json'))) && captionsOf(nocap));
            assert(list.length === 1, `rows ${list.length}`);
            const row = list[0];
            assert(row.time_domain === 'output' && row.sourceRef === null && row.edited === true && row.speaker === null && row.text === 'テキストを入力', S(row));
            assert(row.start === 0 && row.end === 3, `span ${row.start}-${row.end}`);
            assert(row.text_style?.position?.x === 0.5 && row.text_style?.position?.y === 0.5, S(row.text_style));
            return row;
        });
        await check('プレビューに「テキストを入力」が出て選択され、時刻が合う', async () => {
            const plates = await waitFor('plate', async () => { const p = await v.eval(PLATES); return p.some(x => x.id === `caption-plate-${created.id}`) && p; });
            const frame = await v.eval(FRAME);
            const plate = plates.find(x => x.id === `caption-plate-${created.id}`);
            const selected = await evalOn(session.cdp, `[...document.querySelectorAll('.akari-annotations-caption.selected, [data-caption-id].selected')].map(e=>e.dataset.captionId)`);
            return { plate, frame, verticalOffsetPx: frame ? Math.round(plate.cy - frame.cy) : null, leftMinusCenterPx: frame ? Math.round(plate.left - frame.cx) : null, timelineSelected: selected };
        });
        await shot(session.cdp, 'l1-02-nocap-placed.png');
        await check('置いた文字をプレビューでドラッグして位置を変えられる', async () => {
            await v.eval(`window.addEventListener('pointermove',e=>window.__ptbPointer={x:e.clientX,y:e.clientY},true)`);
            const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).find(r=>r.width>200&&r.height>200);return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
            const probe = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...probe, button: 'none' }); await sleep(300);
            const local = await waitFor('pointer', () => v.eval('window.__ptbPointer'));
            const plate = (await v.eval(PLATES)).find(x => x.id === `caption-plate-${created.id}`);
            const start = { x: plate.cx + probe.x - local.x, y: plate.cy + probe.y - local.y };
            await realDragMod(session.cdp, [start, { x: start.x + 120, y: start.y - 80 }], { stepDelayMs: 50 });
            const moved = await waitFor('position saved', async () => { const r = (await captionsOf(nocap))[0]; return r.text_style.position.x !== 0.5 && r.text_style; });
            return moved;
        });
        await shot(session.cdp, 'l1-03-nocap-dragged.png');
        await check('Cmd+Z の 1 手で消える（captions.json ごと元の無い状態へ）/ Cmd+Shift+Z で戻る', async () => {
            await blur(session.cdp); await cmdZ(session.cdp);
            await waitFor('captions.json removed', async () => !(await exists(path.join(nocap, 'captions.json'))));
            await sleep(1500);
            const plates = await v.eval(PLATES);
            await blur(session.cdp); await cmdShiftZ(session.cdp);
            const redo = await waitFor('redo', async () => (await exists(path.join(nocap, 'captions.json'))) && captionsOf(nocap));
            return { afterUndoFileExists: false, afterUndoPlates: plates.length, afterRedoRows: redo.length, note: 'プレビューのドラッグは既存仕様で履歴に積まれない（置いた 1 手と一緒に戻る）' };
        });
        await check('同じ時間に置いた文字が既にあると入らず、理由が 1 枚だけ出る', async () => {
            const before = await readFile(path.join(nocap, 'captions.json'), 'utf8');
            await clickSelector(session.cdp, '.akari-timeline-place-text');
            const notices = await waitFor('notice', async () => { const n = await evalOn(session.cdp, NOTICES); return n.some(t => t.includes('同じ時間に置いた文字が既にあります')) && n; });
            await sleep(1500);
            const after = await readFile(path.join(nocap, 'captions.json'), 'utf8');
            assert(before === after, 'captions.json changed');
            const count = (await evalOn(session.cdp, NOTICES)).filter(t => t.includes('同じ時間に置いた文字')).length;
            assert(count === 1, `notice count ${count}`);
            return { unchanged: true, notices: count };
        });
        await shot(session.cdp, 'l1-04-overlap-rejected.png');
        await check('edit-lint: error なし（captions.overlap を作らない）', async () => {
            const r = spawnSync(process.execPath, [path.join(REPO, 'packages/edit-lint/bin/edit-lint.mjs'), nocap, '--json'], { encoding: 'utf8' });
            const report = JSON.parse(r.stdout);
            const errors = report.findings.filter(f => f.severity === 'error');
            assert(r.status === 0 && errors.length === 0, S(errors));
            return { exit: r.status, verdict: report.verdict, findings: report.findings.map(f => `${f.severity}:${f.code ?? f.rule ?? ''}`) };
        });
        await check('stylePreset つきのコマンド 1 回 → 行とスタイルが 1 手の Cmd+Z で戻る', async () => {
            const before = await readFile(path.join(nocap, 'captions.json'), 'utf8');
            const id = await evalOn(session.cdp, command('akari.caption.placeText', { start: 5, end: 7, text: '見出し', stylePreset: 'subtitle-news' }));
            const row = await waitFor('preset row', async () => (await captionsOf(nocap)).find(c => c.id === id));
            assert(row.style_preset === 'subtitle-news' && row.time_domain === 'output', S(row));
            await sleep(800);
            await blur(session.cdp); await cmdZ(session.cdp);
            await waitFor('undo bytes', async () => (await readFile(path.join(nocap, 'captions.json'), 'utf8')) === before);
            return { id, row };
        });
        v.cdp.close();
    } finally { await stop(session); }

    // ===== spoken: 話した言葉のある案件・台本の入口 =====
    const spoken = path.join(FIXTURE, 'spoken');
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: spoken, port: PORT, isoDir: path.join(RUNS, 'spoken') });
    try {
        await openProject(session, spoken, 4);
        await evalOn(session.cdp, command('akari.daihon.open'));
        await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===4`, { label: 'daihon rows', timeoutMs: 120_000 });
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`));
        await sleep(1500);
        const v = await view(PORT);
        const before = await readFile(path.join(spoken, 'captions.json'), 'utf8');
        // ⌘クリックで 2 行を選ぶ（台本の選択 = ⌘=追加）。
        await clickSelector(session.cdp, '.akari-daihon-row[data-caption-id="c-0002"] .akari-daihon-row-text', 4);
        await clickSelector(session.cdp, '.akari-daihon-row[data-caption-id="c-0003"] .akari-daihon-row-text', 4);
        const selected = await waitFor('two rows selected', async () => { const x = await evalOn(session.cdp, `[...document.querySelectorAll('.akari-daihon-row.selected')].map(r=>r.dataset.captionId)`); return x.length === 2 && x; });
        await clickSelector(session.cdp, '.akari-daihon-place-text');
        const placed = await check('台本で 2 行選んで「T この行から文字を置く」→ 2 行ぶんの区間に入る', async () => {
            const row = await waitFor('placed row', async () => (await captionsOf(spoken)).find(c => c.time_domain === 'output'));
            assert(row.start === 3 && row.end === 8.5, `span ${row.start}-${row.end}`);
            return { selected, row };
        });
        await check('台本の行は増えず、バー 2 行と札が出る', async () => {
            const m = await waitFor('bars', async () => { const x = await evalOn(session.cdp, `({rows:[...document.querySelectorAll('.akari-daihon-row')].map(r=>r.dataset.captionId),bars:[...document.querySelectorAll('.akari-daihon-placed-bar')].map(b=>b.closest('.akari-daihon-row').dataset.captionId),tags:[...document.querySelectorAll('.akari-daihon-placed-tag')].map(t=>t.textContent)})`); return x.bars.length === 2 && x; });
            assert(m.rows.length === 4 && S(m.bars) === S(['c-0002', 'c-0003']) && m.tags.length === 1 && m.tags[0].includes('2 行'), S(m));
            return m;
        });
        await check('話した言葉の字幕と同じ時刻でもプレビューに両方出る', async () => {
            const plates = await waitFor('two plates', async () => { const p = await v.eval(PLATES); return p.length >= 2 && p; });
            assert(plates.some(p => p.id === `caption-plate-${placed.row.id}`), S(plates));
            return plates.map(p => ({ id: p.id, text: p.text }));
        });
        await shot(session.cdp, 'l1-05-daihon-placed.png');
        await check('台本の入口でも Cmd+Z の 1 手でバイト単位に戻る', async () => {
            await blur(session.cdp); await cmdZ(session.cdp);
            await waitFor('undo', async () => (await readFile(path.join(spoken, 'captions.json'), 'utf8')) === before);
            await sleep(1500);
            const bars = await evalOn(session.cdp, `document.querySelectorAll('.akari-daihon-placed-bar').length`);
            assert(bars === 0, `bars ${bars}`);
            await blur(session.cdp); await cmdShiftZ(session.cdp);
            await waitFor('redo', async () => (await captionsOf(spoken)).some(c => c.time_domain === 'output'));
            return { bytesEqual: true, barsAfterUndo: bars };
        });
        v.cdp.close();
    } finally { await stop(session); }
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
