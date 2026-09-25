#!/usr/bin/env node
// L1: 開発版（未パッケージ）Electron の更新トースト / ブラウザでのダウンロードへの切り替えを実測する。
//   node l1-dev-build-update-toast.mjs <before|after-noenv|after-env>
// shell.openExternal は main プロセスの inspector から「URL を配列に積むだけのスタブ」へ差し替え、
// 差し替えが効いたことを確かめてからウィンドウを操作する（利用者のブラウザを開かない）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from '../../../akari-shell-strip/evidence/right-rail-regroup/scripts/cdp-lib.mjs';

const scenario = process.argv[2];
if (!['before', 'after-noenv', 'after-env'].includes(scenario)) throw new Error('usage: <before|after-noenv|after-env>');
const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '../../../..');
const temp = `/tmp/dev-build-update-toast-l1-${scenario}`;
const CDP_PORT = 9488;
const INSPECT_PORT = 9489;
const FEED_PORT = 48880;
const FEED_ORIGIN = `http://127.0.0.1:${FEED_PORT}`;
const result = { scenario, startedAt: new Date().toISOString(), checks: {}, feedRequests: [] };
const note = (key, value) => { result.checks[key] = value; console.log(key, JSON.stringify(value)); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const feed = {
    schema: 1, product: '99.0.0', channel: 'prerelease', released: '2026-09-25',
    notes_url: `${FEED_ORIGIN}/notes`,
    components: { shell: { version: '99.0.0', mac: { url: `${FEED_ORIGIN}/shell-mac.zip` }, win: { url: `${FEED_ORIGIN}/shell-win.exe` } } }
};

let child; let page; let main; let server;

async function mainEval(expression) {
    const r = await main.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
    if (r.exceptionDetails) throw new Error(`main eval failed: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result.value;
}
const openExternalCalls = () => mainEval('globalThis.__akariOpenExternalCalls ?? null');

async function installOpenExternalStub() {
    // Electron の main には process.mainModule が無い。inspector のコマンドライン API（includeCommandLineAPI）の require で electron を取る。
    await mainEval(`(() => {
        const electron = require('electron');
        globalThis.__akariOpenExternalCalls = globalThis.__akariOpenExternalCalls || [];
        const stub = async url => { globalThis.__akariOpenExternalCalls.push({ url: String(url), at: new Date().toISOString() }); };
        stub.__akariStub = true;
        electron.shell.openExternal = stub;
        return true;
    })()`);
    // 差し替えが効いたかを「スタブを実際に呼んで配列に積まれるか」で確かめる（プローブ URL は後で除外する）。
    const probe = await mainEval(`(async () => {
        // コマンドライン API の require は最初の await より前でしか見えないので先に掴む。
        const req = require; const electron = req('electron');
        await electron.shell.openExternal('stub-probe:dev-build-update-toast');
        return { isStub: electron.shell.openExternal.__akariStub === true, sameShell: req('electron').shell === electron.shell, calls: globalThis.__akariOpenExternalCalls.map(c => c.url), isPackaged: electron.app.isPackaged };
    })()`);
    assert(probe.isStub && probe.calls.includes('stub-probe:dev-build-update-toast'), `openExternal stub not effective: ${JSON.stringify(probe)}`);
    await mainEval(`globalThis.__akariOpenExternalCalls = globalThis.__akariOpenExternalCalls.filter(c => !c.url.startsWith('stub-probe:')); true`);
    return probe;
}

async function toastState() {
    return evalOn(page, `(() => {
        const t = document.querySelector('.akari-update-toast');
        const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && (e.checkVisibility ? e.checkVisibility() : true); };
        const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
        const card = t ? [...t.querySelectorAll('*')].find(e => e.querySelector?.('.akari-update-title')) : null;
        const buttons = t ? [...t.querySelectorAll('button')].filter(vis).map(b => ({ text: b.textContent.trim(), ...rect(b) })) : [];
        return { present: !!t, visible: vis(t) && buttons.length > 0, title: t?.querySelector('.akari-update-title')?.textContent ?? null, card: card && vis(card) ? rect(card) : null, buttons, viewport: { w: innerWidth, h: innerHeight } };
    })()`);
}

async function waitFor(fn, label, timeout = 240000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try { const v = await fn(); if (v) return v; } catch (error) { lastError = error; /* starting */ }
        await sleep(500);
    }
    throw new Error(`timed out: ${label}${lastError ? ` (last error: ${lastError.message ?? lastError})` : ''}`);
}

try {
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    const akariHome = path.join(temp, 'akari-home-dev-build-update-toast');
    await mkdir(akariHome, { recursive: true });
    const cachePath = path.join(akariHome, 'update-check.json');
    if (scenario !== 'after-env') {
        await writeFile(cachePath, `${JSON.stringify({ schema: 1, fetched_at: new Date().toISOString(), feed, dismissed: {} }, null, 2)}\n`);
        // env なしの経路では既定フィード（実リリース）のバックグラウンド取得がキャッシュを上書きしうるので、
        // 検証条件（キャッシュ 99.0.0）を保つため読み取り専用にする（書き込み失敗はアプリ側で沈黙する）。
        await chmod(cachePath, 0o444);
    }
    server = createServer((req, res) => {
        result.feedRequests.push({ url: req.url, at: new Date().toISOString() });
        if (req.url === '/latest.json') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(feed)); return; }
        res.writeHead(404); res.end('dummy');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(FEED_PORT, '127.0.0.1', resolve); });

    const env = { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: path.join(temp, 'theia-config-dev-build-update-toast') };
    delete env.AKARI_UPDATE_FEED_URL;
    delete env.AKARI_UPDATER_TEST_FEED_URL;
    if (scenario === 'after-env') env.AKARI_UPDATE_FEED_URL = `${FEED_ORIGIN}/latest.json`;
    result.env = { AKARI_UPDATE_FEED_URL: env.AKARI_UPDATE_FEED_URL ?? null, AKARI_UPDATER_TEST_FEED_URL: env.AKARI_UPDATER_TEST_FEED_URL ?? null };
    const logPath = path.join(temp, 'electron.log');
    const logFd = openSync(logPath, 'w');
    child = spawn(path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [
        `--inspect=${INSPECT_PORT}`, shell,
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(temp, 'user-data-dev-build-update-toast')}`,
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-sandbox'
    ], { cwd: shell, env, stdio: ['ignore', logFd, logFd] });
    closeSync(logFd);
    result.pid = child.pid;

    // 1) main の inspector へ繋ぎ、ウィンドウ操作の前に openExternal をスタブにする。
    const mainTarget = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`, { signal: AbortSignal.timeout(5000) })).json())[0], 'main inspector', 240000);
    main = new CDP(mainTarget.webSocketDebuggerUrl);
    await main.connect();
    const probe = await waitFor(() => installOpenExternalStub(), 'openExternal stub', 240000);
    note('openExternalStub', probe);

    // 2) レンダラーへ繋ぐ。
    const target = await waitFor(async () => (await listTargets(CDP_PORT)).find(t => t.type === 'page'), 'renderer target', 300000);
    page = new CDP(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Runtime.enable');
    await waitFor(() => evalOn(page, `!!window.theia?.container && !document.querySelector('.theia-preload') && !!document.querySelector('.akari-home, [id*="akari-home"]')`), 'home shown', 600000);
    const homeShownAt = Date.now();
    note('homeShownAt', new Date(homeShownAt).toISOString());
    note('capabilities', await evalOn(page, `(async () => { const api = window.electronAkariUpdater; if (!api) return 'no-api'; return typeof api.getCapabilities === 'function' ? await api.getCapabilities() : 'no-getCapabilities'; })()`));
    // 初回セットアップのダイアログが開いていれば閉じる（トーストは z-index でその上に出る）。
    await evalOn(page, `(() => { const d = document.querySelector('[role="dialog"]'); const c = d?.querySelector('[aria-label="閉じる"], .codicon-close'); if (c) c.click(); return true; })()`);

    if (scenario === 'before' || scenario === 'after-env') {
        const toast = await waitFor(async () => { const s = await toastState(); return s.visible ? s : null; }, 'update toast visible', 180000);
        note('toast', toast);
        await screenshot(page, path.join(here, `${scenario}-toast.png`));
        if (scenario === 'before') {
            const download = toast.buttons.find(b => b.text === 'ダウンロード');
            assert(download, `download button missing: ${JSON.stringify(toast.buttons)}`);
            // スタブが有効なことを直前にもう一度確かめてから押す。
            assert(await mainEval(`require('electron').shell.openExternal.__akariStub === true`), 'stub lost before click');
            await realClick(page, download.x + download.w / 2, download.y + download.h / 2);
            note('clickedDownloadAt', { x: download.x + download.w / 2, y: download.y + download.h / 2 });
            const calls = await waitFor(async () => { const c = await openExternalCalls(); return c && c.length > 0 ? c : null; }, 'openExternal after download click', 180000).catch(() => []);
            await sleep(5000);
            note('openExternalCalls', await openExternalCalls());
            note('toastAfterClick', await toastState());
            await screenshot(page, path.join(here, 'before-after-click.png'));
            result.status = calls.length > 0 ? 'REPRODUCED' : 'NOT_REPRODUCED';
        } else {
            note('openExternalCalls', await openExternalCalls());
            result.status = toast.visible ? 'PASS' : 'FAIL';
        }
    } else {
        // after-noenv: ホーム表示から 30 秒待ってもトーストが無く openExternal 0 回。
        const samples = [];
        while (Date.now() - homeShownAt < 30000) { samples.push(await toastState()); await sleep(2000); }
        const anyVisible = samples.some(s => s.visible);
        note('toastSamples', { count: samples.length, anyPresent: samples.some(s => s.present), anyVisible, last: samples.at(-1) });
        note('openExternalAfter30s', await openExternalCalls());
        await screenshot(page, path.join(here, 'after-noenv-home-30s.png'));
        // 設定画面の「このアプリについて」: ボタンの代わりに 1 行、押しても（押せるものがあっても）openExternal 0 回。
        await evalOn(page, `(() => { const b = window.theia.container._bindingDictionary; const k = [...b._map.keys()].find(k => typeof k === 'function' && typeof k.prototype?.executeCommand === 'function'); void window.theia.container.get(k).executeCommand('akari.settings.open', { section: 'about' }); return true; })()`);
        const about = await waitFor(() => evalOn(page, `(() => {
            const d = document.querySelector('[data-akari-settings-dialog]'); if (!d) return null;
            const text = d.innerText; if (!text.includes('受け取る版')) return null;
            const btn = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'アップデートを確認');
            const r = btn?.getBoundingClientRect();
            return { devNote: text.includes('開発版のため更新は確認できません'), checkButton: btn ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null };
        })()`), 'settings about', 120000);
        note('settingsAbout', about);
        await screenshot(page, path.join(here, 'after-noenv-settings-about.png'));
        if (about.checkButton) await realClick(page, about.checkButton.x, about.checkButton.y);
        // ボタンが無い場合も、利用者の明示操作と同じ要求を preload API から直接送って main 側の失敗経路を通す。
        note('directUserInitiatedCheck', await evalOn(page, `(async () => { try { await window.electronAkariUpdater?.checkForUpdatesNow({ userInitiated: true }); return 'sent'; } catch (e) { return 'rejected: ' + e; } })()`));
        await sleep(20000);
        note('lastUpdaterEvent', await evalOn(page, `window.electronAkariUpdater?.getLastEvent()`));
        const calls = await openExternalCalls();
        note('openExternalAfterSettings', calls);
        const toastEnd = await toastState();
        note('toastEnd', toastEnd);
        result.status = !anyVisible && !toastEnd.visible && calls.length === 0 && about.devNote && !about.checkButton ? 'PASS' : 'FAIL';
    }
    result.cacheAfter = await readFile(cachePath, 'utf8').then(t => JSON.parse(t).feed?.product ?? null).catch(() => null);
} catch (error) {
    result.status = 'ERROR';
    result.error = String(error?.stack ?? error);
    console.error(error);
} finally {
    try { if (main) result.finalOpenExternalCalls = await openExternalCalls(); } catch { /* gone */ }
    page?.close(); main?.close();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await sleep(3000); if (child.exitCode === null) child.kill('SIGKILL'); }
    server?.close();
    result.finishedAt = new Date().toISOString();
    await writeFile(path.join(here, `${scenario}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log('STATUS', result.status);
    process.exit(result.status === 'ERROR' ? 1 : 0);
}
