#!/usr/bin/env node
// 台本で文字を直したときの runs の付け替え（L1・ラッパー作成の検証スクリプト。AFTER のみ）。
// 使い方: node rederive-l1.mjs [fixture dir] [--port=9487]（fixture は gen-fixture.mjs --runs）
// c-0001「これは最高のアイデアです」（run 最高 = 3–5 / アイデア = 6–10）を台本パネルで 3 回直す:
//   1. 前に 2 文字足す（ねえ）→ run が 2 文字ずれて同じ語（最高・アイデア）に掛かったまま
//   2. run の中の 1 文字を直す（最高 → 最強）→ 範囲が保たれる
//   3. run の語を消す（最強 → なし）→ run が外れて通知
// 台本の操作は akari-transcript/evidence/daihon-edit-keeps-style の l1.mjs と同じ（行本文のダブルクリック → 全選択 → 入力 → Enter）。
import { cp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CDP, listTargets } from './cdp-lib.mjs';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, sleep, stop as stopSession, waitEval } from './l1-lib.mjs';

async function stop(session) { await stopSession(session); if (session?.isoDir) spawnSync('/usr/bin/pkill', ['-f', '--', `--user-data-dir=${session.isoDir}`]); }
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const TMP = path.join(os.tmpdir(), 'caption-runs-render-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(2).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture-runs'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9487);
const RESULTS = path.join(ROOT, 'results-rederive-after.json');
const out = { phase: 'after', status: 'running', edits: [], screenshots: [], checks: [] };
const EDITS = [
    { name: '1. run の前に 2 文字足す', from: 'これは', to: 'ねえこれは', expect: runs => runs.length === 2 && runs[0].from === 5 && runs[0].to === 7 && runs[1].from === 8 && runs[1].to === 12 },
    { name: '2. run の中の 1 文字を直す（最高 → 最強）', from: '最高', to: '最強', expect: runs => runs.length === 2 && runs[0].from === 5 && runs[0].to === 7 && runs[1].from === 8 && runs[1].to === 12 },
    { name: '3. run の語を消す（最強）', from: '最強', to: '', expect: runs => runs.length === 1 && runs[0].from === 6 && runs[0].to === 10 }
];
const graphemes = text => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment);
const runText = (record, run) => graphemes(record.display_text ?? record.text).slice(run.from, run.to).join('');

async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
async function view(port) {
    let cdp, ctx;
    const attach = async () => {
        cdp?.close(); cdp = undefined;
        await waitFor('preview stage', async () => {
            const targets = (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
            for (const target of targets) {
                const client = new CDP(target.webSocketDebuggerUrl);
                try { await client.connect(); } catch { continue; }
                const contexts = []; client.on('Runtime.executionContextCreated', p => contexts.push(p.context));
                try { await client.send('Runtime.enable'); } catch { client.close(); continue; }
                await sleep(300);
                for (const c of [undefined, ...contexts.map(c => c.id)]) {
                    try { if (await evalOn(client, `Boolean(document.getElementById('preview-stage'))`, c)) { cdp = client; ctx = c; return true; } } catch {}
                }
                client.close();
            }
            return false;
        }, 180_000);
    };
    await attach();
    return { close: () => cdp?.close(), eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } } };
}
const PREVIEW_RUNS = `(()=>{const p=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith('caption-plate-c-0001')&&getComputedStyle(e).display!=='none');if(!p)return null;return{text:p.textContent,runs:[...p.querySelectorAll('.akari-caption__run, [data-akari-run]')].map(e=>({text:e.textContent,role:e.getAttribute('data-role'),color:getComputedStyle(e).color}))}})()`;
const NOTICES = `(()=>[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item, .akari-daihon-notice, .akari-daihon-status, [class*="daihon"][class*="notice"], [class*="toast"]')].map(e=>e.textContent.trim()).filter(Boolean).slice(-6))()`;

let session;
try {
    const work = path.join(TMP, 'run-rederive-after');
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(path.join(work, 'project'));
    const readRoot = async () => JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
    const seek = time => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
    const isoDir = path.join(TMP, 'iso-caption-runs-render-rederive');
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir });
    session.isoDir = isoDir;
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitFor('preview webview', async () => { await seek(1); await sleep(3000); return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)); }, 180_000);
    await waitFor('daihon rows', async () => {
        await evalOn(session.cdp, command('akari.daihon.open'));
        return waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>=5`, { label: 'daihon rows', timeoutMs: 20_000 }).catch(() => false);
    }, 300_000);
    await sleep(2500);
    const v = await view(PORT);
    const previewState = async () => { await seek(1); await sleep(1500); return v.eval(PREVIEW_RUNS); };
    const initial = (await readRoot()).captions.find(c => c.id === 'c-0001');
    out.initial = { text: initial.text, runs: initial.runs, runTexts: initial.runs.map(r => runText(initial, r)), preview: await waitFor('c-0001 preview', previewState, 90_000) };
    await saveJson(RESULTS, out);
    for (const [index, edit] of EDITS.entries()) {
        const selector = `.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-row-text`;
        await waitEval(session.cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return false;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: 'c-0001 row', timeoutMs: 30_000 });
        await sleep(300);
        const point = await evalOn(session.cdp, `(()=>{const r=document.querySelector(${S(selector)}).getBoundingClientRect();return{x:r.left+Math.min(24,r.width/2),y:r.top+r.height/2}})()`);
        await realClick(session.cdp, point.x, point.y, { clickCount: 2 });
        const inputSel = `.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-row-edit input`;
        const shown = await waitEval(session.cdp, `(()=>{const i=document.querySelector(${S(inputSel)});return i?i.value:null})()`, { label: 'c-0001 input', timeoutMs: 15_000 });
        if (!shown.includes(edit.from)) throw new Error(`input value does not contain ${edit.from}: ${shown}`);
        const next = shown.replace(edit.from, edit.to);
        await evalOn(session.cdp, `(()=>{const i=document.querySelector(${S(inputSel)});i.focus();i.select();return true})()`);
        await session.cdp.send('Input.insertText', { text: next });
        await sleep(200);
        const before = (await readRoot()).captions.find(c => c.id === 'c-0001');
        const noticesBefore = await evalOn(session.cdp, NOTICES).catch(() => []);
        await pressKey(session.cdp, 'Enter', 'Enter', 13, 0);
        const after = await waitFor('c-0001 written', async () => { const r = (await readRoot()).captions.find(c => c.id === 'c-0001'); return r && r.text !== before.text ? r : null; }, 30_000);
        await sleep(1200);
        const notices = await evalOn(session.cdp, NOTICES).catch(() => []);
        const shot = `after-rederive-${index + 1}.png`;
        await session.cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => writeFile(path.join(ROOT, shot), Buffer.from(data, 'base64')));
        out.screenshots.push(shot);
        const runs = after.runs ?? [];
        const record = {
            name: edit.name, typed: next, textBefore: before.text, textAfter: after.text,
            runsBefore: before.runs ?? [], runsAfter: runs, runTextsAfter: runs.map(r => runText(after, r)),
            noticesBefore, notices, newNotices: notices.filter(n => !noticesBefore.includes(n)),
            preview: await previewState(), pass: edit.expect(runs)
        };
        out.edits.push(record);
        await saveJson(RESULTS, out);
    }
    out.status = out.edits.every(e => e.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    if (session) await session.cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => writeFile(path.join(TMP, 'fail-rederive.png'), Buffer.from(data, 'base64'))).catch(() => {});
} finally {
    await saveJson(RESULTS, out);
    await stop(session);
}
console.log(JSON.stringify({ status: out.status, error: out.error, edits: out.edits.map(e => ({ name: e.name, pass: e.pass, runs: e.runsAfter, texts: e.runTextsAfter, newNotices: e.newNotices })) }));
