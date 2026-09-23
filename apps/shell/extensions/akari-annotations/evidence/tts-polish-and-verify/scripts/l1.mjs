#!/usr/bin/env node
// 実 Electron + CDP。fixture は OS の一時ディレクトリに作り、証跡にはパスを残さない。
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { fireCommand, launch, sanitize, saveJson, sleep, stop, waitEval } from './l1-lib.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(root, '..', '..', '..', '..', '..', '..');
const shell = path.join(repo, 'apps', 'shell');
const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const cli = path.join(repo, 'packages/akari-launcher/bin/akari.mjs');
const fixture = path.join(os.tmpdir(), 'tts-polish-and-verify-l1', 'fixture');
const project = path.join(fixture, 'spoken');
const isoDir = path.join(os.tmpdir(), 'tts-polish-and-verify-l1', 'run');
const results = path.join(root, 'results-l1.json');
const dialog = '[data-akari-read-aloud-dialog]';
const q = JSON.stringify;
const selectedPort = Number(process.env.AKARI_TTS_CDP_PORT ?? '19631');
if (!Number.isInteger(selectedPort) || selectedPort < 19631 || selectedPort > 19640) throw new Error('AKARI_TTS_CDP_PORT は 19631〜19640 を指定してください');
const checks = Array.from({ length: 5 }, (_, index) => ({ id: String(index + 1), pass: false, detail: '未実行' }));
const output = { checks };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const cliJson = args => {
    const result = spawnSync(process.execPath, [cli, 'narration', ...args, '--json'], {
        encoding: 'utf8', timeout: 240_000, env: { ...process.env, AKARI_HOME: path.join(isoDir, 'akari-home') }
    });
    let body;
    try { body = JSON.parse(result.stdout.trim()); } catch { body = {}; }
    return { code: result.status, body };
};
const probe = async () => {
    try { return (await fetch('http://127.0.0.1:50021/version', { signal: AbortSignal.timeout(3000) })).ok; }
    catch { return false; }
};
const voicevoxOwner = () => spawnSync('lsof', ['-nP', '-t', '-iTCP:50021', '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim();
async function shot(cdp, number) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 865, scale: 1 } });
    await writeFile(path.join(root, `${String(number).padStart(2, '0')}.png`), Buffer.from(data, 'base64'));
}
async function check(number, cdp, fn) {
    try { checks[number - 1].detail = await fn(); checks[number - 1].pass = true; }
    catch (error) { checks[number - 1].detail = sanitize(error, repo); }
    try { await shot(cdp, number); }
    catch (error) { checks[number - 1].pass = false; checks[number - 1].detail += `; screenshot: ${sanitize(error, repo)}`; }
    await saveJson(results, output);
}
async function close(cdp) {
    if (await evalOn(cdp, `Boolean(document.querySelector(${q(dialog)}))`)) {
        await evalOn(cdp, `document.querySelector(${q(dialog + ' .closeButton')})?.click()`);
        await waitEval(cdp, `!document.querySelector(${q(dialog)})`, { label: 'close dialog' });
    }
}
async function open(cdp, ids) {
    await evalOn(cdp, fireCommand('akari.caption.readAloud', { captionIds: ids }));
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog)}))`, { label: 'read aloud dialog' });
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' section[data-engine="voicevox"]')}))`, { label: 'engine cards' });
}
async function generateSingle(cdp) {
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: 'preview enabled' });
    await evalOn(cdp, `document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]')}).click()`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' audio[src]')}))`, { label: 'generated audio', timeoutMs: 600_000 });
}
async function generateBatch(cdp) {
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: 'batch enabled' });
    const started = Date.now();
    const owner = voicevoxOwner();
    await evalOn(cdp, `document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]')}).click()`);
    const deadline = Date.now() + 900_000;
    let done = false;
    while (Date.now() < deadline) {
        assert(owner && voicevoxOwner() === owner, 'VOICEVOX の待受 PID が生成中に変わりました');
        done = await evalOn(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].length===3&&[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].every(e=>e.textContent.includes('✓'))`);
        if (done) break;
        await sleep(2000);
    }
    assert(done, '3 行の生成が完了しませんでした');
    assert(owner && voicevoxOwner() === owner && await probe(), 'VOICEVOX が生成途中で再起動しました');
    return { rows: 3, elapsed_s: Number(((Date.now() - started) / 1000).toFixed(2)), voicevoxRestarted: false };
}
async function skip(number, reason, cdp) {
    checks[number - 1] = { id: String(number), pass: false, skip: true, detail: reason };
    await shot(cdp, number);
    await saveJson(results, output);
}

let session;
try {
    const made = spawnSync(process.execPath, [path.join(root, 'scripts/gen-fixture.mjs'), fixture], { encoding: 'utf8', timeout: 240_000 });
    assert(made.status === 0, `fixture: ${sanitize(made.stderr, repo)}`);
    const stopped = cliJson(['stop', '--engine', 'voicevox']);
    assert(stopped.code === 0, 'AKARI 管理の VOICEVOX を止められません');
    assert(!(await probe()), 'VOICEVOX が別の所有者により起動中です');
    await saveJson(results, output);
    session = await launch({ shellDir: shell, electron, project, port: selectedPort,
        isoDir });
    // launch は PID を保持し、lsof の CDP LISTEN PID と一致しなければ接続を拒む。
    const cdp = session.cdp;
    await open(cdp, ['c-0001']);
    await check(1, cdp, async () => {
        assert(await evalOn(cdp, `Boolean(document.querySelector(${q(dialog + ' section[data-engine="voicevox"] [data-availability="needs"]')}))`), 'needs カードがありません');
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: 'preview' });
        await evalOn(cdp, `document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]')}).click()`);
        await waitEval(cdp, `document.querySelector(${q(dialog)})?.textContent.includes('VOICEVOX を起動しています')`, { label: '起動中表示', timeoutMs: 60_000 });
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' audio[src]')}))`, { label: 'single generated', timeoutMs: 600_000 });
        assert(await evalOn(cdp, `Boolean(document.querySelector(${q(dialog + ' section[data-engine="voicevox"] [data-availability="available"]')}))`), 'available に変わっていません');
        return 'needs → 起動中 → 生成 → available';
    });
    const backend = cliJson(['verify', '--project', project, '--check-backend']);
    if (backend.code === 3 && backend.body.status === 'unavailable') await skip(3, backend.body.reason, cdp);
    else if (backend.code !== 0) throw new Error('聞き取り backend の確認に失敗しました');
    else await check(3, cdp, async () => {
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="verify"]:not(:disabled)')}))`, { label: 'verify enabled' });
        await evalOn(cdp, `document.querySelector(${q(dialog + ' [data-read-aloud-action="verify"]')}).click()`);
        await waitEval(cdp, `document.querySelector(${q(dialog)})?.textContent.includes('一致 ')&&/\\b(ok|check|ng)\\b/.test(document.querySelector(${q(dialog)})?.textContent||'')`, { label: 'single verification', timeoutMs: 900_000 });
        return { backend: backend.body.backend, shown: true };
    });
    await close(cdp);
    await open(cdp, ['c-0001', 'c-0002', 'c-0003']);
    await check(2, cdp, async () => generateBatch(cdp));
    await close(cdp);
    if (backend.code === 3) await skip(4, backend.body.reason, cdp);
    else {
        await open(cdp, ['c-0001', 'c-0002', 'c-0003']);
        await check(4, cdp, async () => {
            await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-verify-batch]:not(:disabled)')}))`, { label: 'verify checkbox' });
            await evalOn(cdp, `document.querySelector(${q(dialog + ' [data-read-aloud-verify-batch]')}).click()`);
            await generateBatch(cdp);
            await waitEval(cdp, `document.querySelectorAll(${q(dialog + ' [data-verify-verdict]')}).length===3`, { label: 'three verification scores', timeoutMs: 900_000 });
            return { backend: backend.body.backend, scores: 3 };
        });
        await close(cdp);
    }
    await open(cdp, ['c-0001']);
    await check(5, cdp, async () => {
        const state = await evalOn(cdp, `(()=>{const card=document.querySelector(${q(dialog + ' section[data-engine="irodori"]')});if(!card)return null;
            const note=[...card.querySelectorAll('small')].find(e=>e.textContent.includes('GPU 推奨'));
            const badge=card.querySelector('[data-availability]');
            if(!note||!badge)return null;const a=note.getBoundingClientRect(),b=badge.getBoundingClientRect();
            return {note:note.textContent,badge:badge.textContent,availability:badge.dataset.availability,separate:b.top>=a.bottom}})()`);
        assert(state?.availability === 'unconfigured' && state?.note.includes('処理が重い') && state?.badge && state.separate,
            '彩カードの未接続状態または注記との区切りが見えません');
        return { note: state.note, status: state.badge, availability: state.availability, separate: true };
    });
} catch (error) {
    output.error = sanitize(error, repo);
    for (const item of checks) if (item.detail === '未実行') item.detail = `前提失敗: ${output.error}`;
} finally {
    let electronStopError;
    try { await stop(session); } catch (error) { electronStopError = sanitize(error, repo); }
    const stopped = cliJson(['stop', '--engine', 'voicevox']);
    output.cleanup = { electronStopped: !electronStopError, voicevoxStopExit: stopped.code };
    if (electronStopError) output.error = electronStopError;
    output.status = checks.every(item => item.pass || item.skip) && !output.error && stopped.code === 0 ? 'pass' : 'fail';
    await saveJson(results, output);
}
if (output.status !== 'pass') process.exitCode = 1;
