#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, sanitize, saveJson, sleep, waitEval } from './l1-lib.mjs';
import { startFakeIrodori } from './fake-irodori.mjs';
import { makeVoicevoxFixture } from './voicevox-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const RESULTS = path.join(ROOT, 'results-l1.json');
const D = '[data-akari-voice-clone-dialog]';
const q = JSON.stringify;
const names = [
    'コマンドで開き、同意 1 まで次へ不可',
    '偽マイク録音が 15 秒以上でレベルメーターが動く',
    'ローカル確認 4 行と SpeechAnalyzer 原稿照合',
    '彩が既定選択され fal は無効',
    '聞き比べ B に偽彩の wav が入る',
    '保存後の正本と写しを隔離 HOME で確認',
    '途中で閉じた正本が消える',
    'ファイル持ち込みで確かめるまで進む'
];
const out = { status: 'running', executedAt: new Date().toISOString(),
    cdp: { port: null, launchedPid: null, connectedPid: null, pidMatched: false },
    voicevox: { engine: 'headless', port: null, pid: null, startedByScript: false,
        stoppedByScript: false, processGone: null, portClosedAtEnd: null },
    electron: { processGone: null, portClosed: null },
    fakeIrodori: { closed: null, portClosed: null, inProcess: true },
    checks: names.map(name => ({ name, pass: false, measured: null })) };
const assert = (value, message) => { if (!value) throw new Error(message); };
let iso, fake, session, fixture;

function listenerPids(port) {
    const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw new Error('lsof failed');
    return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
}
async function choosePort() {
    for (let port = 19671; port <= 19680; port++) {
        if (!listenerPids(port).length) return port;
    }
    throw new Error('CDP ポートが空いていません');
}
async function shot(cdp, i) {
    const rect = await evalOn(cdp, `(()=>{const e=document.querySelector(${q(D + ' .dialogBlock')});if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
    const clip = rect ?? { x: 900, y: 0, width: 400, height: 150 };
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const cropped = spawnSync('magick', ['png:-', '-crop', `${clip.width}x${clip.height}+${clip.x}+${clip.y}`, '+repage', 'png:-'],
        { input: Buffer.from(data, 'base64'), maxBuffer: 10_000_000 });
    if (cropped.status !== 0) throw new Error('screenshot crop failed');
    await writeFile(path.join(ROOT, `${String(i).padStart(2, '0')}.png`), cropped.stdout);
}
async function check(i, cdp, fn) {
    const started = Date.now();
    try { out.checks[i - 1].measured = await fn(); out.checks[i - 1].pass = true; }
    catch (error) { out.checks[i - 1].measured = { error: sanitize(error, REPO) }; }
    if (i !== 6 && i !== 7) try { await shot(cdp, i); } catch (error) { out.checks[i - 1].screenshotError = sanitize(error, REPO); out.checks[i - 1].pass = false; }
    out.checks[i - 1].seconds = Number(((Date.now() - started) / 1000).toFixed(2));
    await saveJson(RESULTS, out);
    if (!out.checks[i - 1].pass) throw new Error(`${names[i - 1]} failed`);
}
async function click(cdp, selector) { await evalOn(cdp, `document.querySelector(${q(selector)})?.click()`); }
async function open(cdp) {
    await evalOn(cdp, fireCommand('akari.voice.create'));
    await waitEval(cdp, `Boolean(document.querySelector(${q(D)}))`, { label: 'voice dialog' });
}
async function upload(cdp, file) {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `${D} input[type=file]` });
    assert(nodeId, 'file input missing');
    await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId });
    await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-next]')})?.disabled === false`, { label: 'file accepted' });
}
async function close(cdp) { await click(cdp, `${D} .closeButton`); await waitEval(cdp, `!document.querySelector(${q(D)})`, { label: 'close' }); }

try {
    iso = await mkdtemp(path.join(os.tmpdir(), 'akari-voice-clone-l1-'));
    const home = path.join(iso, 'home'), project = path.join(iso, 'project'), wav = path.join(iso, 'voicevox.wav');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'README.md'), '# L1 project\n');
    const avatarDir = path.join(home, '.akari', 'avatars', 'sample');
    await mkdir(avatarDir, { recursive: true });
    await writeFile(path.join(avatarDir, 'avatar.json'), JSON.stringify({ version: 0, id: 'sample', display_name: 'サンプル',
        variants: [], persona: { first_person: '私', tone: '静か', speech_style: '自然', verbal_tics: [], energy: 50,
            ng: [], default_role: 'narrator' }, voice: { lane: 'recorded', ref: 'profile:sample', credit: null },
        renditions: [], default_rendition: null,
        rights: { subject: 'person', consent: 'self', credit_required: false, distribution: 'private' } }));
    fixture = await makeVoicevoxFixture({ shell: SHELL, home, output: wav });
    out.voicevox = { ...out.voicevox, engine: fixture.engine, port: fixture.port,
        pid: fixture.pid, startedByScript: fixture.startedByScript };
    fake = await startFakeIrodori();
    const port = await choosePort();
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port,
        isoDir: path.join(iso, 'electron'), homeDir: home, fakeWav: wav });
    out.cdp = { port, launchedPid: session.pid, connectedPid: session.cdpOwnerPid, pidMatched: session.pidMatched };
    assert(session.pidMatched, 'CDP port owner differs from launched Electron');
    const cdp = session.cdp;
    await evalOn(cdp, fireCommand('akari.settings.open', 'narration'));
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-irodori-url]'))`, { label: 'settings' });
    await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-irodori-url]');e.value=${q(fake.url)};document.querySelector('[data-akari-narration-action="save-irodori-url"]').click();return true})()`);
    await sleep(1500);
    await evalOn(cdp, `document.querySelector('[data-akari-narration-action="check-irodori"]')?.click()`);
    await sleep(1500);
    await closeSettings(cdp);

    await check(1, cdp, async () => {
        await open(cdp);
        const disabled = await evalOn(cdp, `document.querySelector(${q(D + ' [data-voice-next]')})?.disabled`);
        const before = await evalOn(cdp, `document.querySelector(${q(D + ' [data-voice-consent-self]')})?.checked`);
        const avatar = await evalOn(cdp, `document.querySelector(${q(D)})?.dataset.voiceAvatar`);
        await click(cdp, `${D} [data-voice-consent-self]`);
        const after = await evalOn(cdp, `document.querySelector(${q(D + ' [data-voice-consent-self]')})?.checked`);
        assert(disabled === true && before === false && after === true && avatar === 'sample', 'self consent or avatar state');
        return { before, after, nextInitiallyDisabled: disabled, defaultAvatar: avatar };
    });
    await click(cdp, `${D} [data-voice-next]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-voice-record]')}))`, { label: 'record step' });
    await check(2, cdp, async () => {
        await click(cdp, `${D} [data-voice-record]`);
        await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-record]')})?.textContent.includes('止める')`, { label: 'record start' });
        let peak = 0;
        for (let i = 0; i < 17; i++) { await sleep(1000); peak = Math.max(peak, await evalOn(cdp, `Number(document.querySelector(${q(D + ' [data-voice-meter]')})?.value ?? 0)`)); }
        const elapsed = await evalOn(cdp, `document.querySelector(${q(D + ' [data-voice-elapsed]')})?.textContent`);
        await click(cdp, `${D} [data-voice-record]`);
        await waitEval(cdp, `!document.querySelector(${q(D + ' [data-voice-next]')})?.disabled`, { label: 'record saved' });
        assert(peak > 0 && Number(elapsed.split(':')[1]) >= 15, 'recording meter or seconds');
        return { elapsed, meterPeak: peak };
    });
    await click(cdp, `${D} [data-voice-next]`);
    await check(3, cdp, async () => {
        await waitEval(cdp, `document.querySelectorAll(${q(D + ' [data-voice-check]')}).length === 4`, { label: 'four checks', timeoutMs: 360_000 });
        const rows = await evalOn(cdp, `[...document.querySelectorAll(${q(D + ' [data-voice-check]')})].map(e=>e.textContent)`);
        const nextEnabled = await evalOn(cdp, `!document.querySelector(${q(D + ' [data-voice-next]')})?.disabled`);
        assert(rows.some(row => row.includes('原稿どおりか') && row.includes('✓')) && nextEnabled, 'SpeechAnalyzer did not pass');
        return { rows, nextEnabled };
    });
    await click(cdp, `${D} [data-voice-next]`);
    await check(4, cdp, async () => {
        await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-voice-engine="irodori"]')}))`, { label: 'copy cards' });
        const cards = await evalOn(cdp, `['irodori','fal-qwen3'].map(id=>{const e=document.querySelector(${q(D)}+' [data-voice-engine="'+id+'"] input');return{id,checked:e?.checked,disabled:e?.disabled}})`);
        assert(cards[0].checked === true && cards[1].disabled === true, 'copy defaults');
        return { cards, fakeUrl: 'loopback' };
    });
    await click(cdp, `${D} [data-voice-next]`);
    await check(5, cdp, async () => {
        await waitEval(cdp, `(()=>{const a=document.querySelector(${q(D + ' [data-voice-compare="irodori"] audio')});return Boolean(a?.src.startsWith('blob:')&&a.readyState>=1&&Number.isFinite(a.duration)&&a.duration>0)})()`,
            { label: 'B audio metadata', timeoutMs: 360_000 });
        const result = await evalOn(cdp, `(()=>{const a=document.querySelector(${q(D + ' [data-voice-compare="irodori"] audio')});return{src:a.src.slice(0,5),readyState:a.readyState,duration:a.duration,count:${fake.requests.length}}})()`);
        assert(fake.requests.some(request => request.kind === 'copy' && request.hasFile && request.hasVoiceId)
            && fake.requests.some(request => request.kind === 'try'), 'fake Irodori requests');
        return { ...result, requests: fake.requests.map(request => request.kind) };
    });
    await click(cdp, `${D} [data-voice-next]`);
    await check(6, cdp, async () => {
        await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' input[aria-label="名前"]')}))`, { label: 'save step' });
        const label = await evalOn(cdp, `document.querySelector(${q(D + ' input[aria-label="名前"]')})?.value`);
        const pathShown = await evalOn(cdp, `document.querySelector(${q(D + ' .dialogBlock')})?.textContent.includes('~/.akari/avatars/sample/voice/')`);
        assert(label === 'サンプル（ナレーション）' && pathShown, 'avatar display name or save path');
        await shot(cdp, 6);
        await click(cdp, `${D} [data-voice-next]`);
        await waitEval(cdp, `!document.querySelector(${q(D)})`, { label: 'saved' });
        const voiceRoot = path.join(home, '.akari', 'avatars', 'sample', 'voice');
        const dirs = (await readdir(voiceRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
        assert(dirs.length === 1, 'one profile expected');
        const dir = path.join(voiceRoot, dirs[0]);
        await access(path.join(dir, 'ref-recording.wav'));
        const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
        assert(meta.version === 2 && meta.avatar === 'sample' && meta.consent.self_voice === true && meta.engines.irodori?.voice_id, 'meta');
        return { profile: dirs[0], avatar: meta.avatar, initialLabel: label, pathShown, version: meta.version, selfVoice: meta.consent.self_voice,
            engines: Object.keys(meta.engines), recordingBytes: (await readFile(path.join(dir, 'ref-recording.wav'))).length };
    });
    await open(cdp); await click(cdp, `${D} [data-voice-consent-self]`); await click(cdp, `${D} [data-voice-next]`);
    await check(8, cdp, async () => {
        await upload(cdp, wav);
        await click(cdp, `${D} [data-voice-next]`);
        await waitEval(cdp, `document.querySelectorAll(${q(D + ' [data-voice-check]')}).length === 4`, { label: 'file check', timeoutMs: 360_000 });
        const rows = await evalOn(cdp, `[...document.querySelectorAll(${q(D + ' [data-voice-check]')})].map(e=>e.textContent)`);
        assert(rows.length === 4, 'file check rows');
        return { rows: rows.length, via: 'DOM.setFileInputFiles' };
    });
    await click(cdp, `${D} [data-voice-next]`); await click(cdp, `${D} [data-voice-next]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-voice-compare="irodori"]')}))`, { label: 'second copy', timeoutMs: 360_000 });
    await check(7, cdp, async () => {
        const voiceRoot = path.join(home, '.akari', 'avatars', 'sample', 'voice');
        const before = (await readdir(voiceRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
        assert(before.length === 2, 'temporary profile not created');
        await shot(cdp, 7);
        await close(cdp);
        for (let i = 0; i < 100; i++) {
            const remaining = (await readdir(voiceRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
            if (remaining.length === 1) return { before, after: remaining, deleteRequests: fake.requests.filter(item => item.kind === 'delete').length };
            await sleep(200);
        }
        throw new Error('temporary profile remains');
    });
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
} catch (error) { out.status = 'fail'; out.error = sanitize(error, REPO); }
finally {
    const cleanupErrors = [];
    try {
        const result = await stop(session);
        out.electron = { processGone: result.processGone, portClosed: result.portClosed };
        if (!result.processGone || !result.portClosed) out.status = 'fail';
    } catch (error) { cleanupErrors.push(`Electron: ${sanitize(error, REPO)}`); out.status = 'fail'; }
    try {
        if (fake) {
            const result = await fake.stop();
            out.fakeIrodori = { closed: result.closed, portClosed: listenerPids(fake.port).length === 0, inProcess: true };
            if (!out.fakeIrodori.closed || !out.fakeIrodori.portClosed) out.status = 'fail';
        }
    } catch (error) { cleanupErrors.push(`偽 Irodori: ${sanitize(error, REPO)}`); out.status = 'fail'; }
    try {
        if (fixture) {
            const result = await fixture.stop();
            out.voicevox = { ...out.voicevox, ...result,
                stoppedByScript: result.processGone && result.portClosedAtEnd };
            if (!result.processGone || !result.portClosedAtEnd) out.status = 'fail';
        }
    } catch (error) { cleanupErrors.push(`VOICEVOX: ${sanitize(error, REPO)}`); out.status = 'fail'; }
    if (cleanupErrors.length) out.cleanupErrors = cleanupErrors;
    await saveJson(RESULTS, out);
}
if (out.status !== 'pass') process.exitCode = 1;

async function closeSettings(cdp) {
    await click(cdp, '[data-akari-settings-dialog] .closeButton');
    await waitEval(cdp, `!document.querySelector('[data-akari-settings-dialog]')`, { label: 'settings close' });
}
