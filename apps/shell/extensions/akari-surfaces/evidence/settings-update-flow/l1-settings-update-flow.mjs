#!/usr/bin/env node
// L1: 設定 → このアプリについて の「アップデートを確認」の反応を、開発版 Electron + テスト用フィードで実測する。
//   node l1-settings-update-flow.mjs <before|after-available|after-latest|after-error> [--restart]
// - AKARI_UPDATER_TEST_FEED_URL（generic provider）でローカルの latest-mac.yml を配る。新版 99.0.0 の zip は
//   実行中の開発用 Electron.app 自身を固めたもの（アドホック署名の designated requirement = cdhash を満たすため）。
//   zip は帯域を絞って配り、「ダウンロード中」を目で見える長さにする。
// - 起動時の自動確認は update-preferences.json の autoCheck=false で止め、確認はボタン押下だけにする。
// - AKARI_HOME・THEIA_CONFIG_DIR・--user-data-dir は一時ディレクトリ。main の shell.openExternal は
//   inspector から「URL を積むだけのスタブ」へ差し替える（利用者のブラウザを開かない）。
// - スクリーンショットは設定ダイアログの矩形だけを切り出す（背景のローカルパスを写さない）。
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, closeSync, existsSync, openSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from '../../../akari-shell-strip/evidence/right-rail-regroup/scripts/cdp-lib.mjs';

const scenario = process.argv[2];
const withRestart = process.argv.includes('--restart');
if (!['before', 'after-available', 'after-latest', 'after-error'].includes(scenario)) throw new Error('usage: <before|after-available|after-latest|after-error> [--restart]');
const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '../../../..');
const electronApp = path.join(shell, 'node_modules/electron/dist/Electron.app');
const electronBin = path.join(electronApp, 'Contents/MacOS/Electron');
const temp = `/tmp/settings-update-flow-l1-${scenario}`;
const zipCache = '/tmp/settings-update-flow-l1-zip';
const CDP_PORT = 9611;
const INSPECT_PORT = 9612;
const FEED_PORT = 48911;
const FEED_ORIGIN = `http://127.0.0.1:${FEED_PORT}`;
const NEW_VERSION = '99.0.0';
const ZIP_NAME = `AKARI-Video-${NEW_VERSION}-mac.zip`;
const BYTES_PER_SECOND = 24 * 1024 * 1024;
const YML_DELAY_MS = 2000;
const result = { scenario, withRestart, startedAt: new Date().toISOString(), checks: {}, feedRequests: [], exceptions: [], consoleErrors: [] };
const note = (key, value) => { result.checks[key] = value; console.log(key, JSON.stringify(value)); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
let child; let page; let main; let server; let shot = 0; let preexisting = new Set();

async function mainEval(expression) {
    const r = await main.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
    if (r.exceptionDetails) throw new Error(`main eval failed: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result.value;
}

async function installOpenExternalStub() {
    const probe = await mainEval(`(async () => {
        const req = require; const electron = req('electron');
        globalThis.__akariOpenExternalCalls = globalThis.__akariOpenExternalCalls || [];
        const stub = async url => { globalThis.__akariOpenExternalCalls.push({ url: String(url), at: new Date().toISOString() }); };
        stub.__akariStub = true;
        electron.shell.openExternal = stub;
        await electron.shell.openExternal('stub-probe:settings-update-flow');
        const ok = electron.shell.openExternal.__akariStub === true && globalThis.__akariOpenExternalCalls.some(c => c.url === 'stub-probe:settings-update-flow');
        globalThis.__akariOpenExternalCalls = globalThis.__akariOpenExternalCalls.filter(c => !c.url.startsWith('stub-probe:'));
        return { ok, isPackaged: electron.app.isPackaged, version: electron.app.getVersion() };
    })()`);
    assert(probe.ok, `openExternal stub not effective: ${JSON.stringify(probe)}`);
    return probe;
}

async function waitFor(fn, label, timeout = 240000, interval = 250) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try { const v = await fn(); if (v) return v; } catch (error) { lastError = error; }
        await sleep(interval);
    }
    throw new Error(`timed out: ${label}${lastError ? ` (last error: ${lastError.message ?? lastError})` : ''}`);
}

/** about セクションの更新の行（「受け取る版」より上）を読む。ボタンは表示中のものだけ・無効状態つき。 */
const readAbout = () => evalOn(page, `(() => {
    const d = document.querySelector('[data-akari-settings-dialog]'); if (!d) return null;
    const section = [...d.querySelectorAll('section, [id]')].find(e => e.id && e.id.includes('about') && e.offsetParent !== null && e.innerText.includes('受け取る版'));
    if (!section) return null;
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const all = section.innerText;
    const cut = all.indexOf('受け取る版');
    const updateText = (cut >= 0 ? all.slice(0, cut) : all).split('\\n').map(s => s.trim()).filter(Boolean);
    const channelRow = [...section.querySelectorAll('*')].find(e => e.textContent.trim() === '受け取る版');
    const limitY = channelRow ? channelRow.getBoundingClientRect().top : Infinity;
    const buttons = [...section.querySelectorAll('button')].filter(vis).filter(b => b.getBoundingClientRect().top < limitY).map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim(), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    return { updateText, buttons };
})()`);

async function dialogShot(name) {
    const clip = await evalOn(page, `(() => { const d = document.querySelector('[data-akari-settings-dialog] .dialogBlock') || document.querySelector('[data-akari-settings-dialog]'); const r = d.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height, scale: 1 }; })()`);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip });
    const file = `${scenario}-${String(++shot).padStart(2, '0')}-${name}.png`;
    await writeFile(path.join(here, file), Buffer.from(data, 'base64'));
    return file;
}

async function snapshot(name) {
    const about = await readAbout();
    const file = await dialogShot(name);
    note(`about:${name}`, { ...about, screenshot: file });
    return about;
}

const updaterLogLines = akariHome => { try { return readFileSync(path.join(akariHome, 'logs', 'updater.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const sanitize = lines => lines.map(line => line.replace(/\/(?:Users|private|tmp|var)\/[^\s:'"]+/g, '<path>'));

async function ensureZip() {
    const zip = path.join(zipCache, ZIP_NAME);
    const stamp = path.join(zipCache, 'source-mtime');
    const sourceMtime = String(statSync(path.join(electronApp, 'Contents/MacOS/Electron')).mtimeMs);
    if (!existsSync(zip) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== sourceMtime) {
        await rm(zipCache, { recursive: true, force: true });
        await mkdir(zipCache, { recursive: true });
        execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', electronApp, zip]);
        await writeFile(stamp, sourceMtime);
    }
    const sha512 = createHash('sha512').update(readFileSync(zip)).digest('base64');
    return { zip, size: statSync(zip).size, sha512 };
}

function startFeedServer(zipInfo, feedVersion) {
    const yml = [
        `version: ${feedVersion}`,
        'files:',
        `  - url: ${ZIP_NAME}`,
        `    sha512: ${zipInfo?.sha512 ?? 'none'}`,
        `    size: ${zipInfo?.size ?? 0}`,
        `path: ${ZIP_NAME}`,
        `sha512: ${zipInfo?.sha512 ?? 'none'}`,
        `releaseDate: '2026-09-26T00:00:00.000Z'`,
        ''
    ].join('\n');
    const latestJson = {
        schema: 1, product: feedVersion, channel: 'prerelease', released: '2026-09-26', notes_url: `${FEED_ORIGIN}/notes`,
        components: { shell: { version: feedVersion, mac: { url: `${FEED_ORIGIN}/shell-mac.dmg` }, win: { url: `${FEED_ORIGIN}/shell-win.exe` } } }
    };
    server = createServer((req, res) => {
        const url = req.url.split('?')[0];
        result.feedRequests.push({ url, at: new Date().toISOString() });
        // 実ネットワーク相当の応答待ちを 2 秒入れる（押した直後の「確認しています…」を観測できる長さにする）。
        if (url.endsWith('-mac.yml')) { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/yaml' }); res.end(yml); }, YML_DELAY_MS); return; }
        if (url === '/latest.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(latestJson)); return; }
        if (url === `/${ZIP_NAME}` && zipInfo) {
            res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zipInfo.size });
            // 帯域を絞って送る（「ダウンロード中」を観測できる長さにする）。
            const stream = createReadStream(zipInfo.zip, { highWaterMark: 1024 * 1024 });
            let sent = 0; const began = Date.now();
            stream.on('data', chunk => {
                sent += chunk.length;
                const ahead = sent / BYTES_PER_SECOND * 1000 - (Date.now() - began);
                if (!res.write(chunk) || ahead > 0) { stream.pause(); setTimeout(() => stream.resume(), Math.max(0, ahead)); }
            });
            stream.on('end', () => res.end());
            req.on('close', () => stream.destroy());
            return;
        }
        res.writeHead(404); res.end('not found');
    });
    return new Promise((resolve, reject) => { server.once('error', reject); server.listen(FEED_PORT, '127.0.0.1', resolve); });
}

const mainElectronPids = () => execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n')
    .map(line => line.trim()).filter(line => line.split(/\s+/).slice(1).join(' ').startsWith(electronBin))
    .map(line => Number(line.split(/\s+/)[0])).filter(Number.isFinite);
const electronPids = () => execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n')
    .map(line => line.trim()).filter(line => line.includes(electronBin) || line.includes(path.join(electronApp, 'Contents/Frameworks')))
    .map(line => Number(line.split(/\s+/)[0])).filter(Number.isFinite);

try {
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    const akariHome = path.join(temp, 'akari-home-settings-update-flow');
    await mkdir(akariHome, { recursive: true });
    await writeFile(path.join(akariHome, 'update-preferences.json'), `${JSON.stringify({ channel: 'prerelease', autoCheck: false }, null, 2)}\n`);

    const zipInfo = scenario === 'before' || scenario === 'after-available' ? await ensureZip() : undefined;
    if (zipInfo) note('zip', { name: ZIP_NAME, size: zipInfo.size });
    const feedVersion = scenario === 'after-latest' ? '0.0.1' : NEW_VERSION;
    if (scenario !== 'after-error') await startFeedServer(zipInfo, feedVersion);

    preexisting = new Set(electronPids());
    const env = {
        ...process.env,
        AKARI_HOME: akariHome,
        THEIA_CONFIG_DIR: path.join(temp, 'theia-config-settings-update-flow'),
        // 失敗シナリオはどちらのフィードも到達不能（LISTEN していない 48912 番）にする。
        AKARI_UPDATER_TEST_FEED_URL: scenario === 'after-error' ? 'http://127.0.0.1:48912/' : `${FEED_ORIGIN}/`,
        AKARI_UPDATE_FEED_URL: scenario === 'after-error' ? 'http://127.0.0.1:48912/latest.json' : `${FEED_ORIGIN}/latest.json`
    };
    result.env = { AKARI_UPDATER_TEST_FEED_URL: env.AKARI_UPDATER_TEST_FEED_URL, AKARI_UPDATE_FEED_URL: env.AKARI_UPDATE_FEED_URL };
    const logFd = openSync(path.join(temp, 'electron.log'), 'w');
    child = spawn(electronBin, [
        `--inspect=${INSPECT_PORT}`, shell,
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(temp, 'user-data-settings-update-flow')}`,
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-sandbox'
    ], { cwd: shell, env, stdio: ['ignore', logFd, logFd] });
    closeSync(logFd);
    result.pid = child.pid;
    console.log('electron pid', child.pid);

    const mainTarget = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`, { signal: AbortSignal.timeout(5000) })).json())[0], 'main inspector', 240000);
    main = new CDP(mainTarget.webSocketDebuggerUrl);
    await main.connect();

    const target = await waitFor(async () => (await listTargets(CDP_PORT)).find(t => t.type === 'page'), 'renderer target', 300000);
    page = new CDP(target.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Runtime.enable');
    page.on('Runtime.exceptionThrown', p => result.exceptions.push({ at: new Date().toISOString(), text: p.exceptionDetails?.exception?.description?.split('\n')[0] ?? p.exceptionDetails?.text }));
    page.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') result.consoleErrors.push({ at: new Date().toISOString(), text: p.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) }); });
    await waitFor(() => evalOn(page, `!!window.theia?.container && !document.querySelector('.theia-preload') && !!document.querySelector('.akari-home, [id*="akari-home"]')`), 'home shown', 600000);
    // 外部ブラウザは利用者の操作の後にしか開かないので、スタブはアプリが立ち上がってから入れる
    // （起動直後に main へ繋ぐと electron モジュールの差し替え前に当たることがある）。
    note('mainProbe', await waitFor(() => installOpenExternalStub(), 'openExternal stub', 240000, 1000));
    note('capabilities', await evalOn(page, `window.electronAkariUpdater?.getCapabilities()`));
    note('lastEventAtStart', await evalOn(page, `window.electronAkariUpdater?.getLastEvent()`) ?? null);
    await evalOn(page, `(() => { const d = document.querySelector('[role="dialog"]'); const c = d?.querySelector('[aria-label="閉じる"], .codicon-close'); if (c) c.click(); return true; })()`);
    await sleep(1000);
    await evalOn(page, `(() => { const b = window.theia.container._bindingDictionary; const k = [...b._map.keys()].find(k => typeof k === 'function' && typeof k.prototype?.executeCommand === 'function'); void window.theia.container.get(k).executeCommand('akari.settings.open', { section: 'about' }); return true; })()`);
    const initial = await waitFor(async () => { const a = await readAbout(); return a && a.buttons.length > 0 ? a : null; }, 'settings about with update row', 120000);
    await snapshot('opened');
    const logBefore = updaterLogLines(akariHome).length;

    const checkButton = initial.buttons.find(b => /アップデートを確認|もう一度確かめる/.test(b.text));
    assert(checkButton, `check button missing: ${JSON.stringify(initial.buttons)}`);
    await realClick(page, checkButton.x, checkButton.y);
    // 押した直後（次の描画）の状態。main からのイベントを待たずに読む。
    const immediate = await evalOn(page, `new Promise(r => requestAnimationFrame(() => r(true)))`).then(() => readAbout());
    note('immediatelyAfterClick', immediate);
    await dialogShot('after-click');
    note('immediatelyAfterClickMainLastEvent', await evalOn(page, `window.electronAkariUpdater?.getLastEvent()`) ?? null);

    if (scenario === 'before') {
        // 基点: 押しても表示は変わらない。ダウンロードが最後まで進んでも（main の lastEvent が update-downloaded になっても）同じまま。
        await sleep(3000);
        await snapshot('after-3s');
        const downloaded = await waitFor(async () => { const e = await evalOn(page, `window.electronAkariUpdater?.getLastEvent()`); return e && (e.kind === 'update-downloaded' || e.kind === 'error') ? e : null; }, 'main lastEvent downloaded', 300000).catch(error => ({ timeout: String(error) }));
        note('mainLastEvent', downloaded);
        const final = await snapshot('after-download');
        const same = JSON.stringify(final.updateText) === JSON.stringify(initial.updateText) && JSON.stringify(final.buttons.map(b => [b.text, b.disabled])) === JSON.stringify(initial.buttons.map(b => [b.text, b.disabled]));
        note('unchanged', { initial: initial.updateText, final: final.updateText, same });
        result.status = same ? 'REPRODUCED' : 'NOT_REPRODUCED';
    } else if (scenario === 'after-available') {
        const checking = immediate.updateText.some(t => t.includes('確認しています')) && immediate.buttons.some(b => b.disabled);
        const downloading = await waitFor(async () => { const a = await readAbout(); return a?.updateText.some(t => t.includes('ダウンロードしています')) ? a : null; }, 'downloading shown', 120000, 100);
        await snapshot('downloading');
        const ready = await waitFor(async () => { const a = await readAbout(); return a?.buttons.some(b => b.text === '再起動して更新') ? a : null; }, 'ready shown', 600000);
        await snapshot('ready');
        note('readyText', ready.updateText);
        // ダウンロード済みのあとに「アップデートを確認」を押しても、再チェック・再ダウンロードは起きない。
        const logAtReady = updaterLogLines(akariHome);
        const feedAtReady = result.feedRequests.length;
        const recheck = ready.buttons.find(b => b.text === 'アップデートを確認');
        note('recheckButtonAtReady', recheck ?? null);
        let recheckSent = 'button';
        if (recheck && !recheck.disabled) await realClick(page, recheck.x, recheck.y);
        else recheckSent = await evalOn(page, `(async () => { await window.electronAkariUpdater.checkForUpdatesNow({ userInitiated: true }); return 'preload'; })()`);
        await sleep(10000);
        const afterRecheck = await snapshot('ready-after-recheck');
        const logAfterRecheck = updaterLogLines(akariHome);
        note('recheckAfterDownloaded', {
            sentVia: recheckSent,
            updaterLogLinesAtReady: logAtReady.length, updaterLogLinesAfter: logAfterRecheck.length,
            newLogLines: sanitize(logAfterRecheck.slice(logAtReady.length)),
            feedRequestsAtReady: feedAtReady, feedRequestsAfter: result.feedRequests.length,
            stillReady: afterRecheck.buttons.some(b => b.text === '再起動して更新'),
            mainLastEvent: await evalOn(page, `window.electronAkariUpdater?.getLastEvent()`)
        });
        // ダイアログを閉じてから更新イベントを送っても例外にならない（購読が解除されている）。
        const exceptionsBeforeClose = result.exceptions.length;
        await evalOn(page, `(() => { const d = document.querySelector('[data-akari-settings-dialog]'); const c = d?.querySelector('.dialogTitle i, [aria-label="閉じる"], .codicon-close'); if (c) { c.click(); return 'clicked'; } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'escape'; })()`);
        await waitFor(async () => !(await evalOn(page, `!!document.querySelector('[data-akari-settings-dialog]') && document.querySelector('[data-akari-settings-dialog]').offsetParent !== null`)), 'dialog closed', 20000);
        for (const event of [{ kind: 'checking-for-update' }, { kind: 'update-available', version: '99.0.1' }, { kind: 'error', message: 'l1 probe', reason: 'l1 probe' }, { kind: 'update-downloaded', version: '99.0.0' }]) {
            await mainEval(`(() => { for (const w of require('electron').BrowserWindow.getAllWindows()) w.webContents.send('AkariShellUpdaterEvent', ${JSON.stringify(event)}); return true; })()`);
            await sleep(300);
        }
        await sleep(1500);
        note('eventsAfterClose', { exceptionsBefore: exceptionsBeforeClose, exceptionsAfter: result.exceptions.length, newExceptions: result.exceptions.slice(exceptionsBeforeClose) });
        const pass = checking && !!downloading && !!ready
            && result.checks.recheckAfterDownloaded.updaterLogLinesAfter === result.checks.recheckAfterDownloaded.updaterLogLinesAtReady
            && result.checks.recheckAfterDownloaded.stillReady
            && result.exceptions.length === exceptionsBeforeClose;
        note('summary', { checking, downloading: !!downloading, ready: !!ready });
        result.status = pass ? 'PASS' : 'FAIL';
        if (withRestart) {
            // 再度開いて「再起動して更新」を押す → アプリが終了し ShipIt が入れ替える。
            await evalOn(page, `(() => { const b = window.theia.container._bindingDictionary; const k = [...b._map.keys()].find(k => typeof k === 'function' && typeof k.prototype?.executeCommand === 'function'); void window.theia.container.get(k).executeCommand('akari.settings.open', { section: 'about' }); return true; })()`);
            const reopened = await waitFor(async () => { const a = await readAbout(); return a?.buttons.some(b => b.text === '再起動して更新') ? a : null; }, 'ready after reopen', 60000);
            await snapshot('reopened-ready');
            const restart = reopened.buttons.find(b => b.text === '再起動して更新');
            // main の inspector を掴んだままだと Node が「debugger の切断待ち」で終了しないので、押す前に切り離す。
            main.close(); main = undefined;
            const clickedAt = Date.now();
            await realClick(page, restart.x, restart.y).catch(() => undefined);
            const exited = await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'app exit after restart', 120000).then(() => true).catch(() => false);
            note('restartClicked', { exited, exitCode: child.exitCode, signal: child.signalCode, secondsToExit: (Date.now() - clickedAt) / 1000 });
            // ShipIt は終了を待って入れ替え → 再起動する。再起動した main プロセスが現れるまで待つ（最大 120 秒）。
            const relaunchedMain = await waitFor(() => { const pids = mainElectronPids().filter(pid => !preexisting.has(pid) && pid !== child.pid); return pids.length ? pids : null; }, 'relaunch by ShipIt', 120000, 1000).catch(() => []);
            note('afterRestart', { relaunchedMainProcesses: relaunchedMain.length, updaterLogTail: sanitize(updaterLogLines(akariHome).slice(-5)) });
        }
    } else if (scenario === 'after-latest') {
        const latest = await waitFor(async () => { const a = await readAbout(); return a?.updateText.some(t => t.includes('最新です')) ? a : null; }, 'latest shown', 120000);
        await snapshot('latest');
        const version = result.checks.mainProbe.version;
        note('summary', { checking: immediate.updateText.some(t => t.includes('確認しています')), latestText: latest.updateText, expected: `最新です（v${version}）` });
        result.status = latest.updateText.some(t => t.includes(`最新です（v${version}）`)) && immediate.buttons.some(b => b.disabled) ? 'PASS' : 'FAIL';
    } else {
        const failed = await waitFor(async () => { const a = await readAbout(); return a?.buttons.some(b => b.text === 'もう一度確かめる') ? a : null; }, 'failure shown', 120000);
        await snapshot('failed');
        const browser = failed.buttons.find(b => b.text !== 'もう一度確かめる' && !b.disabled);
        note('browserButton', browser ?? null);
        if (browser) { await realClick(page, browser.x, browser.y); await sleep(1500); }
        const calls = await mainEval('globalThis.__akariOpenExternalCalls ?? []');
        note('openExternalCalls', calls);
        // もう一度確かめる → 確認中に戻り、再び失敗表示へ。
        const retry = (await readAbout()).buttons.find(b => b.text === 'もう一度確かめる');
        await realClick(page, retry.x, retry.y);
        const retryImmediate = await evalOn(page, `new Promise(r => requestAnimationFrame(() => r(true)))`).then(() => readAbout());
        note('retryImmediate', retryImmediate);
        const failedAgain = await waitFor(async () => { const a = await readAbout(); return a?.buttons.some(b => b.text === 'もう一度確かめる') ? a : null; }, 'failure shown again', 120000);
        await snapshot('failed-again');
        note('summary', { checking: immediate.updateText.some(t => t.includes('確認しています')), failedText: failed.updateText, retryChecking: retryImmediate.updateText.some(t => t.includes('確認しています')) });
        result.status = !!failedAgain && calls.length > 0 && !!browser ? 'PASS' : 'FAIL';
    }
    note('updaterLogTail', sanitize(updaterLogLines(akariHome).slice(logBefore)));
} catch (error) {
    result.status = 'ERROR';
    result.error = String(error?.stack ?? error).replace(/\/(?:Users|private|tmp|var)\/[^\s:'"]+/g, '<path>');
    console.error(error);
    try { if (page) await dialogShot('error'); } catch { /* ignore */ }
} finally {
    page?.close(); main?.close();
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await sleep(3000); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    server?.close();
    // この worktree の Electron（ShipIt が再起動した分・取り残されたヘルパーを含む）だけを PID 指定で止める。
    { await sleep(2000); for (const pid of electronPids().filter(pid => !preexisting.has(pid))) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
    result.finishedAt = new Date().toISOString();
    await writeFile(path.join(here, `${scenario}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log('STATUS', result.status);
    process.exit(result.status === 'ERROR' ? 1 : 0);
}
