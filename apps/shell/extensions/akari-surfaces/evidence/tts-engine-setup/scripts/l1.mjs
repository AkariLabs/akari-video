#!/usr/bin/env node
// 設定「読み上げ」エンジン席の L1。Electron と VOICEVOX はこの実行が起動した PID だけ片付ける。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, clickSelector, sanitize, saveJson, sleep, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const CLI = path.join(REPO, 'packages/akari-launcher/bin/akari.mjs');
const RESULTS = path.join(ROOT, 'results-l1.json');
const names = [
    '読み上げ節に VOICEVOX・Gemini・彩の 3 カードがある',
    '止まっている VOICEVOX を起動し版つきのピルになる',
    '声を試すと音声ができ audio の src に入る',
    'AKARI が起動した VOICEVOX を止めると停止ピルになる',
    'Gemini のピルが fal 鍵の有無と一致し接続節へ移る',
    '彩のピルが近日である'
];
const out = { status: 'running', checks: names.map(name => ({ name, pass: false, detail: '未実行' })) };
const q = value => JSON.stringify(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const card = id => `[data-akari-settings-section="narration"] [data-akari-narration-engine="${id}"]`;
async function probeVoicevox() {
    try { const response = await fetch('http://127.0.0.1:50021/version', { signal: AbortSignal.timeout(1500) }); return response.ok; }
    catch { return false; }
}
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function check(index, run) {
    try { out.checks[index].detail = await run(); out.checks[index].pass = true; }
    catch (error) { out.checks[index].detail = sanitize(error, REPO); }
    await saveJson(RESULTS, out);
}
async function shot(cdp, name) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png',
        clip: { x: 0, y: 0, width: 1440, height: 865, scale: 1 } });
    await writeFile(path.join(ROOT, name), Buffer.from(data, 'base64'));
}
async function waitPill(cdp, id, prefix) {
    return waitEval(cdp, `(()=>{const c=document.querySelector(${q(card(id))});const p=c?.querySelector('.akari-set-pill');return p?.textContent?.startsWith(${q(prefix)})?p.textContent:null})()`,
        { label: `${id} ${prefix}`, timeoutMs: 120_000 });
}
function command(env, args) {
    const result = spawnSync(process.execPath, [CLI, 'narration', ...args, '--json'], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000 });
    if (result.status !== 0) throw new Error(`narration CLI exit ${result.status}`);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

let session, scratch, startedByAkari = false;
const started = Date.now();
try {
    await saveJson(RESULTS, out);
    if (await probeVoicevox()) throw new Error('開始時に VOICEVOX が既に動作中。外部起動のため条件 (4) を検証できません。');
    scratch = await mkdtemp(path.join(os.tmpdir(), 'akari-tts-engine-l1-'));
    const project = path.join(scratch, 'project');
    const isoDir = path.join(scratch, 'profile');
    await mkdir(project);
    const port = await freePort();
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port, isoDir });
    await evalOn(session.cdp, fireCommand('akari.settings.open', 'narration'));
    await waitEval(session.cdp, `Boolean(document.querySelector('[data-akari-settings-section="narration"]:not([hidden])'))`, { label: '読み上げ節' });
    await check(0, async () => {
        await waitPill(session.cdp, 'voicevox', '止まっています');
        const cards = await evalOn(session.cdp, `([...document.querySelectorAll('[data-akari-settings-section="narration"] [data-akari-narration-engine]')]).map(c=>({id:c.dataset.akariNarrationEngine,label:c.querySelector('strong')?.textContent}))`);
        assert(cards.length === 3 && cards.map(c => c.id).join(',') === 'voicevox,gemini-tts,irodori', '3 カードの並びが違います');
        await shot(session.cdp, '01-cards.png');
        return { cards: cards.map(c => c.label) };
    });
    await check(1, async () => {
        startedByAkari = true;
        await clickSelector(session.cdp, `${card('voicevox')} [data-akari-narration-action="start"]`);
        const text = await waitPill(session.cdp, 'voicevox', '起動中 · ');
        assert(/^起動中 · \S+/.test(text), '版がありません');
        await shot(session.cdp, '02-started.png');
        return { pill: text };
    });
    await check(2, async () => {
        await clickSelector(session.cdp, `${card('voicevox')} [data-akari-narration-action="preview"]`);
        const state = await waitEval(session.cdp, `(()=>{const a=document.querySelector(${q(card('voicevox') + ' audio[data-akari-narration-preview]')});return a?.src?.startsWith('data:audio/wav;base64,')?{hasSrc:true,bytes:a.src.length}:null})()`,
            { label: 'VOICEVOX 試聴', timeoutMs: 120_000 });
        assert(state.bytes > 1000, '音声が空です');
        await shot(session.cdp, '03-preview.png');
        return { hasAudioSrc: true, encodedLength: state.bytes };
    });
    await check(3, async () => {
        const enabled = await evalOn(session.cdp, `!document.querySelector(${q(card('voicevox') + ' [data-akari-narration-action="stop"]')})?.disabled`);
        assert(enabled, 'AKARI 起動分なのに止めるボタンが無効です');
        await clickSelector(session.cdp, `${card('voicevox')} [data-akari-narration-action="stop"]`);
        const text = await waitPill(session.cdp, 'voicevox', '止まっています');
        assert(!(await probeVoicevox()), 'VOICEVOX プロセスが残っています');
        startedByAkari = false;
        await shot(session.cdp, '04-stopped.png');
        return { pill: text, engineStopped: true };
    });
    await check(4, async () => {
        const env = { AKARI_HOME: path.join(isoDir, 'akari-home') };
        const engines = command(env, ['engines']);
        const keyPresent = engines.engines.find(e => e.id === 'gemini-tts')?.availability.state === 'available';
        const text = await waitPill(session.cdp, 'gemini-tts', keyPresent ? 'fal の鍵あり' : 'fal の鍵がありません');
        await clickSelector(session.cdp, `${card('gemini-tts')} [data-akari-narration-action="connections"]`);
        await waitEval(session.cdp, `Boolean(document.querySelector('[data-akari-settings-section="connections"]:not([hidden])'))`, { label: '接続と API キー節' });
        return { pill: text, matchesCredentialState: true, connectionsOpened: true };
    });
    await check(5, async () => {
        await clickSelector(session.cdp, '[data-settings-nav="narration"]');
        const text = await waitPill(session.cdp, 'irodori', '近日');
        await shot(session.cdp, '05-irodori.png');
        return { pill: text };
    });
} catch (error) {
    out.error = sanitize(error, REPO);
    for (const record of out.checks) if (record.detail === '未実行') record.detail = `前提の起動に失敗: ${out.error}`;
} finally {
    if (startedByAkari && scratch) {
        try { command({ AKARI_HOME: path.join(scratch, 'profile', 'akari-home') }, ['stop', '--engine', 'voicevox']); }
        catch (error) { out.cleanupError = sanitize(error, REPO); }
    }
    await stop(session);
    if (scratch) await rm(scratch, { recursive: true, force: true });
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
    out.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
    await saveJson(RESULTS, out);
}
if (out.status !== 'pass') process.exitCode = 1;
