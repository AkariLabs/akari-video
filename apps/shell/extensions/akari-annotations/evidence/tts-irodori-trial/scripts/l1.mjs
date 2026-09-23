#!/usr/bin/env node
// 実 Electron + CDP。彩の実モデルは使わず、同じプロセス内の偽 HTTP サーバーで検証する。
import { spawnSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, sanitize, saveJson, sleep, waitEval } from './l1-lib.mjs';
import { startFakeIrodori } from './fake-irodori.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.join(os.tmpdir(), 'tts-irodori-trial-l1', 'fixture');
const PROJECT = path.join(FIXTURE, 'spoken');
const RESULTS = path.join(ROOT, 'results-l1.json');
const UI_WAIT = 240_000;
const GENERATE_WAIT = 600_000;
const DIALOG = '[data-akari-read-aloud-dialog]';
const SETTINGS = '[data-akari-settings-dialog]';
const q = JSON.stringify;
const names = [
    '設定で彩が「お試し」・URL 保存・接続を確かめる',
    'ポップアップで彩を選択・お試しピル',
    '明るい若い女性で試聴し、送信 JSON を検査',
    '置いた narration の provenance を検査',
    '自分で書く声の指示は必須・入力後に送信',
    '偽サーバー停止後に接続不可・バッジで設定を開く'
];
const out = { status: 'running', checks: names.map(name => ({ name, pass: false, measured: null })) };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function until(label, fn, timeout = UI_WAIT) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(300); }
    throw new Error(`${label} timeout`);
}
function listenerPids(port) {
    const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (result.error || ![0, 1].includes(result.status)) throw new Error('lsof による CDP ポート確認ができません');
    return result.stdout.trim().split(/\s+/u).filter(Boolean);
}
async function freePort(port) {
    if (listenerPids(port).length) return false;
    try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }); return false; }
    catch (error) {
        if (error?.cause?.code === 'ECONNREFUSED') return true;
        return false; // 高負荷によるタイムアウトも「使用中」に倒す。
    }
}
async function choosePort() {
    const preferred = Number(process.env.AKARI_IRODORI_CDP_PORT ?? 19611);
    if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) throw new Error('CDP ポート指定が不正です');
    for (const port of [...new Set([preferred, ...Array.from({ length: 9 }, (_, index) => 19612 + index)])]) {
        if (await freePort(port)) return port;
    }
    throw new Error('CDP ポートに空きがありません');
}
async function shot(cdp, number) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 865, scale: 1 } });
    await writeFile(path.join(ROOT, `${String(number).padStart(2, '0')}.png`), Buffer.from(data, 'base64'));
}
async function check(number, cdp, fn) {
    const started = Date.now();
    try { out.checks[number - 1].measured = await fn(); out.checks[number - 1].pass = true; }
    catch (error) { out.checks[number - 1].measured = { error: sanitize(error, REPO) }; }
    try { await shot(cdp, number); }
    catch (error) { out.checks[number - 1].screenshotError = sanitize(error, REPO); out.checks[number - 1].pass = false; }
    out.checks[number - 1].seconds = Number(((Date.now() - started) / 1000).toFixed(2));
    await saveJson(RESULTS, out);
}
async function close(cdp, selector) {
    if (await evalOn(cdp, `Boolean(document.querySelector(${q(selector)}))`)) {
        await evalOn(cdp, `document.querySelector(${q(selector + ' .closeButton')})?.click()`);
        await waitEval(cdp, `!document.querySelector(${q(selector)})`, { label: 'ダイアログ終了', timeoutMs: UI_WAIT });
    }
}
async function openReadAloud(cdp) {
    await evalOn(cdp, fireCommand('akari.caption.readAloud', { captionIds: ['c-0001'] }));
    await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG)}))`, { label: '読み上げ', timeoutMs: UI_WAIT });
}
async function chooseVoice(cdp, voice) {
    await evalOn(cdp, `(()=>{const e=document.querySelector(${q(DIALOG + ' select[aria-label="声"]')});e.value=${q(voice)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function placeAndRead() {
    return (await JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'))).audio?.narration ?? [];
}

let fake;
let session;
try {
    const fixture = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs'), FIXTURE], { encoding: 'utf8', timeout: UI_WAIT });
    if (fixture.status !== 0) throw new Error(`fixture failed: ${sanitize(fixture.stderr, REPO)}`);
    await access(path.join(PROJECT, 'edit.json'));
    fake = await startFakeIrodori();
    await saveJson(RESULTS, out);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: await choosePort(),
        isoDir: path.join(os.tmpdir(), 'tts-irodori-trial-l1', 'run') });
    const cdp = session.cdp;
    await check(1, cdp, async () => {
        await evalOn(cdp, fireCommand('akari.settings.open', 'narration'));
        await waitEval(cdp, `Boolean(document.querySelector(${q(SETTINGS + ' [data-akari-irodori-url]')}))`, { label: '読み上げ設定', timeoutMs: UI_WAIT });
        const before = await evalOn(cdp, `document.querySelector(${q(SETTINGS + ' [data-akari-narration-engine="irodori"]')})?.textContent`);
        assert(before.includes('お試し'), '彩の「お試し」がありません');
        assert(await evalOn(cdp, `Boolean(document.querySelector(${q(SETTINGS + ' [data-akari-narration-engine="irodori"] [data-akari-experimental]')}))`), '常設のお試しピルがありません');
        await evalOn(cdp, `(()=>{const e=document.querySelector(${q('[data-akari-irodori-url]')});e.value=${q(fake.url)};document.querySelector('[data-akari-narration-action="save-irodori-url"]').click();return true})()`);
        await waitEval(cdp, `document.querySelector(${q('[data-akari-narration-engine="irodori"]')})?.textContent.includes('お試し · 接続済み')`, { label: 'URL 保存と接続', timeoutMs: UI_WAIT });
        await evalOn(cdp, `document.querySelector('[data-akari-narration-action="check-irodori"]').click()`);
        await waitEval(cdp, `document.querySelector(${q('[data-akari-narration-engine="irodori"]')})?.textContent.includes('お試し · 接続済み')`, { label: '彩 接続済み', timeoutMs: UI_WAIT });
        return { savedUrl: fake.url.replace('127.0.0.1', 'loopback'), pill: 'お試し · 接続済み' };
    });
    await check(2, cdp, async () => {
        await close(cdp, SETTINGS); await openReadAloud(cdp);
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] input:not(:disabled)')}))`, { label: '彩カード', timeoutMs: UI_WAIT });
        await evalOn(cdp, `document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] input')}).click()`);
        await waitEval(cdp, `document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] input')})?.checked`, { label: '彩選択', timeoutMs: UI_WAIT });
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' select[aria-label="声"] option[value="bright-female"]')}))`, { label: '彩の声一覧', timeoutMs: UI_WAIT });
        const pill = await evalOn(cdp, `document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] [data-akari-experimental]')})?.textContent`);
        assert(pill === 'お試し', 'お試しピルがありません');
        return { selected: true, pill };
    });
    await check(3, cdp, async () => {
        await chooseVoice(cdp, 'bright-female');
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: '試聴可能', timeoutMs: UI_WAIT });
        await evalOn(cdp, `document.querySelector(${q(DIALOG + ' [data-read-aloud-action="preview"]')}).click()`);
        const body = await until('彩の生成', () => fake.requests[0], GENERATE_WAIT);
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' audio[src]')}))`, { label: '試聴音声', timeoutMs: GENERATE_WAIT });
        assert(body.voice === 'none' && body.model === 'irodori-tts' && body.irodori?.caption === '明るく元気な若い女性の声。はきはきと楽しそうに話す。', '送信 JSON が声レシピと違います');
        return { model: body.model, voice: body.voice, caption: body.irodori.caption, requestCount: fake.requests.length };
    });
    await check(4, cdp, async () => {
        await evalOn(cdp, `document.querySelector(${q(DIALOG + ' [data-read-aloud-action="place"]')}).click()`);
        const rows = await until('narration 配置', async () => { const value = await placeAndRead(); return value.length && value; });
        const provenance = rows.at(-1).provenance;
        assert(provenance?.provider === 'irodori' && provenance?.experimental === true, 'provenance が違います');
        return { count: rows.length, provider: provenance.provider, experimental: provenance.experimental };
    });
    await check(5, cdp, async () => {
        await close(cdp, DIALOG); await openReadAloud(cdp);
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] input:not(:disabled)')}))`, { label: '彩カード（再度）', timeoutMs: UI_WAIT });
        await evalOn(cdp, `document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] input')}).click()`);
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' select[aria-label="声"] option[value="custom"]')}))`, { label: '自分で書く声', timeoutMs: UI_WAIT });
        await chooseVoice(cdp, 'custom');
        const disabled = await evalOn(cdp, `document.querySelector(${q(DIALOG + ' [data-read-aloud-action="preview"]')})?.disabled`);
        assert(disabled, '声の指示が空でも試聴できます');
        await evalOn(cdp, `(()=>{const e=document.querySelector(${q(DIALOG + ' input[aria-label="声の指示（必須）"]')});e.value='低く、ゆっくり話す。';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await waitEval(cdp, `!document.querySelector(${q(DIALOG + ' [data-read-aloud-action="preview"]')})?.disabled`, { label: '声の指示入力', timeoutMs: UI_WAIT });
        await evalOn(cdp, `document.querySelector(${q(DIALOG + ' [data-read-aloud-action="preview"]')}).click()`);
        const body = await until('自由 caption 送信', () => fake.requests[1], GENERATE_WAIT);
        assert(body.irodori?.caption === '低く、ゆっくり話す。', '自由 caption が送られていません');
        return { emptyDisabled: disabled, caption: body.irodori.caption, requestCount: fake.requests.length };
    });
    await check(6, cdp, async () => {
        await close(cdp, DIALOG); await fake.stop(); fake = undefined;
        await openReadAloud(cdp);
        await waitEval(cdp, `Boolean(document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] button[data-availability="unconfigured"]')}))`, { label: '接続不可バッジ', timeoutMs: UI_WAIT });
        const badge = await evalOn(cdp, `document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] button[data-availability="unconfigured"]')})?.textContent`);
        assert(badge.includes('つながりません'), '接続不可の表示がありません');
        await evalOn(cdp, `document.querySelector(${q(DIALOG + ' section[data-engine="irodori"] button[data-availability="unconfigured"]')}).click()`);
        await waitEval(cdp, `Boolean(document.querySelector('[data-akari-settings-section="narration"]:not([hidden])'))`, { label: '設定 読み上げ', timeoutMs: UI_WAIT });
        return { badge, openedSection: 'narration' };
    });
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
} catch (error) { out.status = 'fail'; out.error = sanitize(error, REPO); }
finally {
    if (fake) await fake.stop().catch(() => {});
    await stop(session);
    await saveJson(RESULTS, out);
}
if (out.status !== 'pass') process.exitCode = 1;
