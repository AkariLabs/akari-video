#!/usr/bin/env node

// L1（実機 Electron + CDP + 実 DOM / preview-server + puppeteer-core）:
// 「text_style も words も持たない無装飾字幕が、シェルのプレビューでも
//   Web UI（preview-server）・焼き込み（render-cut）と同じ splitCaptionLines で
//   2〜3 行に折り返される」ことを実測する。
//
//   node apps/shell/extensions/akari-preview/evidence/plain-caption-wrap/run-l1.mjs
//
// 計測パス:
//   (a) shell / 1920x1080 / 無装飾字幕 1 件 → .akari-caption__line 数 >= 2 + SS
//   (c) shell / 1080x1920 / 同じ字幕        → .akari-caption__line 数 >= 3 + SS
//   (d) preview-server / 1920x1080 / 同じ字幕 → shell と同数
//   (e) shell / text_style 付き + karaoke 付きを足す → DOM assert + SS 各 1 枚
//   (f) 字幕なし区間で #caption-plate が :empty（display: none）
//
// Electron は 1 回の計測につき 1 本だけ起動し、PID 指名で kill し、profile パスで
// 残存 0 件を確認してから次のパスへ進む。証跡に作業機の絶対パスを残さない。

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(evidenceDir, '..', '..', '..', '..', '..', '..');
const shellDir = path.join(worktree, 'apps', 'shell');
const outDir = process.env.AKARI_L1_OUT ? path.resolve(process.env.AKARI_L1_OUT) : evidenceDir;

const electronCandidates = [shellDir, worktree].map(root =>
    path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
let electronBinary = electronCandidates[0];
for (const candidate of electronCandidates) {
    if (await stat(candidate).then(() => true, () => false)) { electronBinary = candidate; break; }
}
const ffmpegBinary = path.join(worktree, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');
const isolatedRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-plaincap-l1-')));
await mkdir(outDir, { recursive: true });

const CAPTION_TEXT = 'きょうはプレビューの字幕がシェルでも二行三行に折り返されるかを確かめます';
const { splitCaptionLines } = await import(pathToFileURL(
    path.join(worktree, 'packages', 'render-cut', 'src', 'captions.mjs')).href);

function sanitizeText(value) {
    let text = String(value ?? '');
    for (const from of [worktree, isolatedRoot, outDir, os.homedir()]) {
        if (!from) continue;
        text = text.split(`file://${from}`).join('file://<WORKTREE>');
        text = text.split(from).join('<WORKTREE>');
    }
    text = text.replace(/\/Users\/[^/"'\s]+/g, '<HOME>');
    text = text.replace(/\/private\/(tmp|var)\/[^"'\s]+/g, '<TMP>');
    text = text.replace(/\/var\/folders\/[^"'\s]+/g, '<TMP>');
    return text;
}
const sanitizeValue = value => value === undefined ? undefined : JSON.parse(sanitizeText(JSON.stringify(value)));

async function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

// ------------------------------------------------------------------ fixture

const PLAIN_CAPTION = { id: 'c1', start: 0.5, end: 5.0, text: CAPTION_TEXT };
const STYLED_CAPTION = {
    id: 'c2', start: 5.5, end: 7.5, text: '装飾付きの字幕は見た目を変えない',
    text_style: { color: '#ffd94a' }
};
const KARAOKE_CAPTION = {
    id: 'c3', start: 8.0, end: 10.0, text: 'カラオケもそのまま',
    style: 'karaoke',
    words: [
        { start: 8.0, end: 8.6, text: 'カラオケ' },
        { start: 8.6, end: 9.2, text: 'も' },
        { start: 9.2, end: 10.0, text: 'そのまま' }
    ]
};

async function buildWorkspace({ name, width, height, durationSeconds, captions }) {
    const workspaceDir = path.join(isolatedRoot, name);
    await cp(path.join(worktree, 'templates', 'project-default'), workspaceDir, { recursive: true });
    await mkdir(path.join(workspaceDir, 'assets'), { recursive: true });
    const mediaPath = path.join(workspaceDir, 'assets', 'main.mp4');
    const ffmpeg = spawnSync(ffmpegBinary, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=0x1b2a3a:size=${width}x${height}:rate=30`,
        '-t', String(durationSeconds), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaPath
    ], { encoding: 'utf8' });
    if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout}`);
    const fps = 30;
    const edit = {
        version: 2,
        output: { width, height, fps },
        sources: [{ id: 'main', path: 'assets/main.mp4' }],
        tracks: [{
            id: 'v-main', lane: 'visual', items: [{
                id: 'cut-a', at: 0, duration: durationSeconds * fps,
                source: { kind: 'media', src: 'main', in: 0, out: durationSeconds }
            }]
        }]
    };
    const editPath = path.join(workspaceDir, 'edit.json');
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, 'utf8');
    // 配列ルートの captions.json（契約どおり）
    await writeFile(path.join(workspaceDir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`, 'utf8');
    return { workspaceDir, editPath, editUri: pathToFileURL(editPath).href };
}

// ------------------------------------------------------------------ CDP

class CDP {
    constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
    async connect() {
        this.socket = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id && this.pending.has(message.id)) {
                const pending = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
                else pending.resolve(message.result);
                return;
            }
            if (!message.method) return;
            for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
        });
    }
    send(method, params = {}, sessionId, timeoutMs = 30000) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!this.pending.has(id)) return;
                this.pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: value => { clearTimeout(timer); resolve(value); },
                reject: error => { clearTimeout(timer); reject(error); }
            });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    on(method, listener) {
        const current = this.listeners.get(method) ?? [];
        current.push(listener);
        this.listeners.set(method, current);
    }
    close() { if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(); }
}

async function evalOn(cdp, expression, contextId, sessionId, userGesture = false) {
    const params = { expression, returnByValue: true, awaitPromise: true, userGesture };
    if (contextId !== undefined) params.contextId = contextId;
    const result = await cdp.send('Runtime.evaluate', params, sessionId);
    if (result.exceptionDetails) {
        throw new Error(`Runtime.evaluate failed: ${sanitizeText(JSON.stringify(result.exceptionDetails))}`);
    }
    return result.result.value;
}

async function waitForTargets(port, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const latest = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            if (latest.some(target => target.type === 'page')) return latest;
        } catch { /* debugger endpoint is not up yet */ }
        await sleep(250);
    }
    throw new Error('CDP target was not ready');
}

class PreviewFinder {
    constructor(cdp) {
        this.cdp = cdp;
        this.sessions = new Map();
        this.contexts = new Map();
        this.consoleLog = [];
        cdp.on('Runtime.executionContextCreated', (event, sessionId) => {
            if (!sessionId) return;
            const contexts = this.contexts.get(sessionId) ?? new Map();
            contexts.set(event.context.id, event.context);
            this.contexts.set(sessionId, contexts);
        });
        cdp.on('Runtime.executionContextDestroyed', (event, sessionId) => {
            this.contexts.get(sessionId)?.delete(event.executionContextId);
        });
        cdp.on('Target.detachedFromTarget', event => {
            this.sessions.delete(event.sessionId);
            this.contexts.delete(event.sessionId);
        });
        cdp.on('Runtime.consoleAPICalled', (event, sessionId) => {
            if (!sessionId) return;
            this.consoleLog.push({
                type: event.type,
                args: (event.args ?? []).map(arg => sanitizeText(arg.value ?? arg.description ?? '')).slice(0, 4)
            });
        });
    }
    async initialize() {
        this.cdp.on('Target.attachedToTarget', event => { void this.register(event.sessionId, event.targetInfo); });
        await this.cdp.send('Target.setDiscoverTargets', { discover: true });
        await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
        await this.refresh();
    }
    async register(sessionId, info) {
        if (String(info?.url ?? '').startsWith('devtools:')) return;
        this.sessions.set(sessionId, { info, sessionId });
        this.contexts.set(sessionId, new Map());
        for (const [method, params] of [
            ['Runtime.enable', {}], ['Page.enable', {}],
            ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }]
        ]) {
            await this.cdp.send(method, params, sessionId).catch(() => undefined);
        }
    }
    async refresh() {
        const result = await this.cdp.send('Target.getTargets', {}).catch(() => undefined);
        const live = new Set([...this.sessions.values()].map(session => session.info?.targetId));
        for (const info of result?.targetInfos ?? []) {
            if (!['page', 'iframe', 'webview', 'other'].includes(info.type)) continue;
            if (String(info.url ?? '').startsWith('devtools:')) continue;
            if (live.has(info.targetId)) continue;
            try {
                const attached = await this.cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
                await this.register(attached.sessionId, info);
            } catch { /* target went away or is already attached */ }
        }
    }
    async find(timeoutMs = 60000) {
        const deadline = Date.now() + timeoutMs;
        const probe = `(() => { try {
            return { hit: Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle')) };
        } catch (error) { return { error: String(error) }; } })()`;
        while (Date.now() < deadline) {
            await this.refresh();
            for (const session of this.sessions.values()) {
                for (const context of this.contexts.get(session.sessionId)?.values() ?? []) {
                    try {
                        const value = await evalOn(this.cdp, probe, context.id, session.sessionId);
                        if (value?.hit) return { sessionId: session.sessionId, contextId: context.id };
                    } catch { /* context died mid-probe */ }
                }
            }
            await sleep(250);
        }
        throw new Error('preview webview context was not found');
    }
}

async function executeTheiaCommand(cdp, commandId, argument) {
    return evalOn(cdp, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function'
        && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry binding was not found' };
      const registry = window.theia.container.get(CommandClass);
      const value = await registry.executeCommand(${JSON.stringify(commandId)}, ${JSON.stringify(argument)});
      const primitive = value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
      return { ok: true, value: primitive ? value : undefined };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function activatePreviewTab(cdp) {
    const rect = await evalOn(cdp, `(() => {
      const label = Array.from(document.querySelectorAll('[class*="TabBar-tabLabel"]'))
        .find(element => element.textContent?.trim() === '出力プレビュー');
      if (!label) return null;
      const box = label.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    if (!rect) return false;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' });
    await sleep(40);
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1
    });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(500);
    return (await evalOn(cdp, 'document.querySelectorAll(\'iframe\').length')) > 0;
}

async function dismissConsent(cdp) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const dismissed = await evalOn(cdp, `(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find(candidate => candidate.textContent?.trim() === '開くだけ');
      if (!button) return false;
      button.click();
      return true;
    })()`);
        if (dismissed) return true;
        await sleep(300);
    }
    return false;
}

// #caption-plate の観測（無装飾の行分割・装飾変数・カラオケ token・空状態）
const PROBE = `(() => {
  const plate = document.getElementById('caption-plate');
  if (!plate) return { plateExists: false };
  const style = getComputedStyle(plate);
  const lines = Array.from(plate.querySelectorAll('.akari-caption__line'));
  return {
    plateExists: true,
    lineCount: lines.length,
    lineTexts: lines.map(line => line.textContent),
    karaokeTokenCount: plate.querySelectorAll('.akari-caption__tok--karaoke').length,
    captionColorVar: plate.style.getPropertyValue('--caption-color').trim() || null,
    styledHostClass: plate.classList.contains('akari-caption-host--styled'),
    childCount: plate.children.length,
    innerHTMLLength: plate.innerHTML.length,
    display: style.display,
    plateText: plate.textContent.replace(/\\s+/gu, ' ').trim().slice(0, 160),
    seek: Number(document.getElementById('seek')?.value ?? -1),
    engineReady: document.getElementById('frame-engine-preview')?.dataset?.frameEngineReady ?? null
  };
})()`;

const seekExpression = seconds => `(() => {
  const seek = document.getElementById('seek');
  if (!seek) return { ok: false, error: 'seek input not found' };
  seek.value = String(${seconds});
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  seek.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: Number(seek.value), max: Number(seek.max) };
})()`;

// 期待状態へ到達するまで待つ。到達しないまま空の初期状態で「安定した」と読むのを避ける
// （実測: preview-server はランタイム生成完了まで数秒かかり、その間の seek は描画に乗らない）。
const probeSettled = (probe, expect) => expect === 'empty'
    ? probe?.childCount === 0 && probe?.display === 'none'
    : (probe?.lineCount ?? 0) > 0;

async function probeUntil({ evaluate, seconds, expect, timeoutMs = 30000 }) {
    let observed = null;
    const deadline = Date.now() + timeoutMs;
    let lastSeek = 0;
    while (Date.now() < deadline) {
        if (Date.now() - lastSeek > 3000) {
            await evaluate(seekExpression(seconds));
            lastSeek = Date.now();
        }
        await sleep(500);
        observed = await evaluate(PROBE);
        if (probeSettled(observed, expect)) {
            // 1 tick 置いて同じ結果が続くことを確認してから確定する
            await sleep(600);
            const confirmed = await evaluate(PROBE);
            if (probeSettled(confirmed, expect)) return confirmed;
            observed = confirmed;
        }
    }
    return observed;
}

// ------------------------------------------------------------------ shell pass

async function runShellPass({ name, width, height, durationSeconds, captions, probes }) {
    const pass = { name, width, height, durationSeconds, probes: {}, screenshots: [], errors: [] };
    const { workspaceDir, editUri } = await buildWorkspace({
        name: `ws-${name}`, width, height, durationSeconds, captions
    });
    const profileDir = path.join(isolatedRoot, `profile-${name}`);
    const configDir = path.join(isolatedRoot, `config-${name}`);
    const akariHome = path.join(isolatedRoot, `akari-home-${name}`);
    await Promise.all([profileDir, configDir, akariHome].map(dir => mkdir(dir, { recursive: true })));
    const port = await freePort();
    let child;
    let main;
    let browserCdp;
    let shotRect = null;

    const screenshot = async fileName => {
        try {
            if (!shotRect) {
                shotRect = await evalOn(main, `(() => {
          const frame = Array.from(document.querySelectorAll('iframe'))
            .map(element => ({ element, box: element.getBoundingClientRect() }))
            .filter(value => value.box.width > 200 && value.box.height > 150)
            .sort((left, right) => (right.box.width * right.box.height) - (left.box.width * left.box.height))[0];
          if (!frame) return null;
          const box = frame.box;
          // 先頭のパンくず（作業機の一時ディレクトリ絶対パスが出る）を証跡に残さないため上端を落とす
          return { x: Math.round(box.left), y: Math.round(box.top + 110),
                   width: Math.round(box.width), height: Math.max(160, Math.round(box.height - 110)) };
        })()`).catch(() => null);
            }
            const shot = await main.send('Page.captureScreenshot', {
                format: 'png', ...(shotRect ? { clip: { ...shotRect, scale: 1 } } : {})
            });
            await writeFile(path.join(outDir, fileName), Buffer.from(shot.data, 'base64'));
            pass.screenshots.push(fileName);
        } catch (error) {
            pass.errors.push({ screenshot: fileName, error: sanitizeText(error.message) });
        }
    };

    try {
        child = spawn(electronBinary, [
            shellDir, workspaceDir,
            `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-sandbox'
        ], {
            cwd: shellDir,
            env: { ...process.env, THEIA_CONFIG_DIR: configDir, AKARI_HOME: akariHome },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        pass.electronPid = child.pid;
        const stderrChunks = [];
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => stderrChunks.push(chunk));

        const targets = await waitForTargets(port);
        const mainTarget = targets.find(target => target.type === 'page' && !target.url.startsWith('devtools:'));
        if (!mainTarget) throw new Error('main page target was not found');
        main = new CDP(mainTarget.webSocketDebuggerUrl);
        await main.connect();
        await main.send('Page.enable');
        await main.send('Runtime.enable');

        browserCdp = new CDP((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
        await browserCdp.connect();
        const finder = new PreviewFinder(browserCdp);
        await finder.initialize();

        await evalOn(main, '(() => { window.resizeTo(1600, 1100); return true; })()');
        await sleep(700);
        pass.consentDismissed = await dismissConsent(main);

        let openCommand = { ok: false, error: 'not attempted' };
        const openDeadline = Date.now() + 120000;
        while (Date.now() < openDeadline) {
            await dismissConsent(main).catch(() => undefined);
            openCommand = await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
            if (openCommand.ok && (openCommand.value === 'opened' || openCommand.value === 'revealed')) break;
            await sleep(1000);
        }
        pass.openCommand = sanitizeValue(openCommand);

        let preview;
        for (let attempt = 0; attempt < 45 && !preview; attempt += 1) {
            await activatePreviewTab(main);
            await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
            preview = await finder.find(2000).catch(() => undefined);
        }
        if (!preview) preview = await finder.find(20000);
        const view = {
            eval: async expression => {
                try {
                    return await evalOn(browserCdp, expression, preview.contextId, preview.sessionId);
                } catch (error) {
                    pass.errors.push({ evalRetry: sanitizeText(error.message).slice(0, 160) });
                    preview = await finder.find(20000);
                    return evalOn(browserCdp, expression, preview.contextId, preview.sessionId);
                }
            }
        };

        const settleDeadline = Date.now() + 60000;
        while (Date.now() < settleDeadline) {
            const probe = await view.eval(PROBE);
            if (probe.plateExists && probe.engineReady === 'true') break;
            await sleep(400);
        }
        await sleep(1500);

        for (const { key, seconds, expect, screenshot: shotName } of probes) {
            pass.probes[`${key}_seek`] = sanitizeValue(await view.eval(seekExpression(seconds)));
            pass.probes[key] = sanitizeValue(await probeUntil({
                evaluate: expression => view.eval(expression), seconds, expect
            }));
            if (shotName) await screenshot(shotName);
        }

        pass.consoleWarnings = finder.consoleLog.filter(entry => ['warning', 'error'].includes(entry.type)).slice(0, 10);
        pass.electronStderr = sanitizeText(stderrChunks.join('')).split('\n')
            .filter(line => /error|fail/i.test(line)).slice(0, 10);
    } catch (error) {
        pass.errors.push({ fatal: sanitizeText(error?.stack ?? error?.message ?? String(error)) });
    } finally {
        try { main?.close(); } catch { /* already closed */ }
        try { browserCdp?.close(); } catch { /* already closed */ }
        if (child?.pid) {
            try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
            await sleep(2000);
            try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
        }
        await sleep(2500);
        const survivors = spawnSync('ps', ['-eo', 'pid,ppid,args'], { encoding: 'utf8' }).stdout ?? '';
        pass.survivingProcesses = survivors.split('\n')
            .filter(line => line.includes(profileDir) || line.includes(path.join(shellDir, 'lib', 'backend', 'main.js')))
            .map(line => sanitizeText(line.trim())).filter(Boolean);
        await rm(workspaceDir, { recursive: true, force: true });
        await rm(profileDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
        await rm(akariHome, { recursive: true, force: true });
    }
    return pass;
}

// ------------------------------------------------------------------ preview-server pass

async function runPreviewServerPass({ width, height, durationSeconds, captions, seconds }) {
    const pass = { name: 'preview-server', width, height, errors: [] };
    const { workspaceDir } = await buildWorkspace({
        name: 'ws-preview-server', width, height, durationSeconds, captions
    });
    const port = await freePort();
    let server;
    let browser;
    try {
        server = spawn(process.execPath, [
            path.join(worktree, 'packages', 'preview-server', 'src', 'server.mjs'),
            '--port', String(port), '--host', '127.0.0.1', workspaceDir
        ], { cwd: worktree, stdio: ['ignore', 'pipe', 'pipe'] });
        pass.serverPid = server.pid;
        const serverLog = [];
        for (const stream of [server.stdout, server.stderr]) {
            stream.setEncoding('utf8');
            stream.on('data', chunk => serverLog.push(chunk));
        }
        const deadline = Date.now() + 60000;
        let up = false;
        while (Date.now() < deadline && !up) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/`);
                up = response.ok;
            } catch { await sleep(300); }
        }
        if (!up) throw new Error(`preview-server did not come up: ${sanitizeText(serverLog.join(''))}`);

        // root node_modules の puppeteer-core（この評価スクリプト自身がリポ内にあるので通常解決で届く）
        const { default: puppeteer } = await import('puppeteer-core');
        const chromeCandidates = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(os.homedir(), '.cache', 'puppeteer', 'chrome')
        ];
        let executablePath = chromeCandidates[0];
        if (!await stat(executablePath).then(() => true, () => false)) {
            const listing = spawnSync('sh', ['-c',
                `ls -d ${chromeCandidates[1]}/*/chrome-mac*/Google\\ Chrome*.app/Contents/MacOS/* 2>/dev/null | head -1`],
            { encoding: 'utf8' });
            executablePath = (listing.stdout ?? '').trim();
        }
        pass.chromeExecutable = sanitizeText(executablePath);
        browser = await puppeteer.launch({
            executablePath, headless: true,
            args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
                `--window-size=${Math.min(width, 1600)},${Math.min(height, 1000)}`],
            userDataDir: path.join(isolatedRoot, 'chrome-profile')
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        const consoleLog = [];
        page.on('console', message => consoleLog.push({ type: message.type(), text: sanitizeText(message.text()).slice(0, 200) }));
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction('Boolean(document.getElementById("caption-plate"))', { timeout: 60000 });
        await page.waitForFunction('Number(document.getElementById("seek")?.max) > 0', { timeout: 60000 })
            .catch(() => undefined);
        // 字幕フォントの実体ロードとランタイム生成が終わるまで seek は描画に乗らない
        await page.waitForFunction('document.fonts.check(\'600 82px "AKARI Noto Sans JP"\')', { timeout: 60000 })
            .catch(() => undefined);
        await page.waitForFunction('Boolean(window.akariFrameEngine)', { timeout: 60000 }).catch(() => undefined);
        pass.runtimeReady = await page.evaluate(`({
          fontOk: document.fonts.check('600 82px "AKARI Noto Sans JP"'),
          frameEngine: Boolean(window.akariFrameEngine)
        })`);
        pass.seek = await page.evaluate(seekExpression(seconds));
        pass.probe = sanitizeValue(await probeUntil({
            evaluate: expression => page.evaluate(expression), seconds, expect: 'lines'
        }));
        await writeFile(path.join(outDir, 'preview-server-landscape.png'),
            await page.screenshot({ type: 'png' }));
        pass.screenshots = ['preview-server-landscape.png'];
        pass.consoleWarnings = consoleLog.filter(entry => ['warning', 'error'].includes(entry.type)).slice(0, 10);
        pass.serverLog = sanitizeText(serverLog.join('')).split('\n').filter(line => /error|fail/i.test(line)).slice(0, 10);
    } catch (error) {
        pass.errors.push({ fatal: sanitizeText(error?.stack ?? error?.message ?? String(error)) });
    } finally {
        try { await browser?.close(); } catch { /* already closed */ }
        if (server?.pid) {
            try { process.kill(server.pid, 'SIGTERM'); } catch { /* already exited */ }
            await sleep(800);
            try { process.kill(server.pid, 'SIGKILL'); } catch { /* already exited */ }
        }
        await sleep(1000);
        const survivors = spawnSync('ps', ['-eo', 'pid,ppid,args'], { encoding: 'utf8' }).stdout ?? '';
        pass.survivingProcesses = survivors.split('\n')
            .filter(line => line.includes(path.join('preview-server', 'src', 'server.mjs'))
                && line.includes(isolatedRoot))
            .map(line => sanitizeText(line.trim())).filter(Boolean);
        await rm(workspaceDir, { recursive: true, force: true });
    }
    return pass;
}

// ------------------------------------------------------------------ run

const result = {
    captionText: CAPTION_TEXT,
    expected: {
        landscapeLines: splitCaptionLines(CAPTION_TEXT, 20),
        portraitLines: splitCaptionLines(CAPTION_TEXT, 10)
    },
    passes: {}
};

result.passes.landscape = await runShellPass({
    name: 'landscape', width: 1920, height: 1080, durationSeconds: 6,
    captions: [PLAIN_CAPTION],
    probes: [
        { key: 'plain', seconds: 2.0, expect: 'lines', screenshot: 'landscape-2lines.png' },
        { key: 'empty', seconds: 5.6, expect: 'empty', screenshot: null }
    ]
});

result.passes.portrait = await runShellPass({
    name: 'portrait', width: 1080, height: 1920, durationSeconds: 6,
    captions: [PLAIN_CAPTION],
    probes: [{ key: 'plain', seconds: 2.0, expect: 'lines', screenshot: 'portrait-3lines.png' }]
});

result.passes.regression = await runShellPass({
    name: 'regression', width: 1920, height: 1080, durationSeconds: 12,
    captions: [PLAIN_CAPTION, STYLED_CAPTION, KARAOKE_CAPTION],
    probes: [
        { key: 'plain', seconds: 2.0, expect: 'lines', screenshot: null },
        { key: 'styled', seconds: 6.5, expect: 'lines', screenshot: 'styled.png' },
        { key: 'karaoke', seconds: 9.0, expect: 'lines', screenshot: 'karaoke.png' }
    ]
});

result.passes.previewServer = await runPreviewServerPass({
    width: 1920, height: 1080, durationSeconds: 6, captions: [PLAIN_CAPTION], seconds: 2.0
});

// ---- 判定 ----
const landscape = result.passes.landscape.probes?.plain ?? {};
const landscapeEmpty = result.passes.landscape.probes?.empty ?? {};
const portrait = result.passes.portrait.probes?.plain ?? {};
const styled = result.passes.regression.probes?.styled ?? {};
const karaoke = result.passes.regression.probes?.karaoke ?? {};
const server = result.passes.previewServer.probe ?? {};

result.verdict = {
    a_landscapeLineCount: landscape.lineCount ?? null,
    a_landscapeMatchesSplit: landscape.lineCount === result.expected.landscapeLines.length,
    a_landscapeTextsMatch: JSON.stringify(landscape.lineTexts ?? null) === JSON.stringify(result.expected.landscapeLines),
    c_portraitLineCount: portrait.lineCount ?? null,
    c_portraitMatchesSplit: portrait.lineCount === result.expected.portraitLines.length,
    c_portraitTextsMatch: JSON.stringify(portrait.lineTexts ?? null) === JSON.stringify(result.expected.portraitLines),
    d_previewServerLineCount: server.lineCount ?? null,
    d_shellEqualsPreviewServer: landscape.lineCount === server.lineCount,
    e_styledCaptionColorVar: styled.captionColorVar ?? null,
    e_styledColorApplied: styled.captionColorVar === '#ffd94a',
    e_karaokeTokenCount: karaoke.karaokeTokenCount ?? null,
    e_karaokeTokensPresent: (karaoke.karaokeTokenCount ?? 0) > 0,
    f_emptyChildCount: landscapeEmpty.childCount ?? null,
    f_emptyDisplay: landscapeEmpty.display ?? null,
    f_emptyHidden: landscapeEmpty.childCount === 0 && landscapeEmpty.display === 'none'
        && landscapeEmpty.styledHostClass === false,
    survivingProcessCount: Object.values(result.passes)
        .reduce((total, pass) => total + (pass.survivingProcesses?.length ?? 0), 0)
};
result.fatalErrors = Object.entries(result.passes).flatMap(([name, pass]) =>
    (pass.errors ?? []).filter(entry => entry.fatal || entry.screenshot).map(entry => ({ pass: name, ...entry })));
result.pass = (landscape.lineCount ?? 0) >= 2
    && result.verdict.a_landscapeMatchesSplit && result.verdict.a_landscapeTextsMatch
    && (portrait.lineCount ?? 0) >= 3
    && result.verdict.c_portraitMatchesSplit && result.verdict.c_portraitTextsMatch
    && result.verdict.d_shellEqualsPreviewServer
    && result.verdict.e_styledColorApplied && result.verdict.e_karaokeTokensPresent
    && result.verdict.f_emptyHidden
    && result.verdict.survivingProcessCount === 0
    && result.fatalErrors.length === 0;

await writeFile(path.join(outDir, 'l1-result.json'), `${JSON.stringify(sanitizeValue(result), null, 2)}\n`, 'utf8');
console.log(JSON.stringify(sanitizeValue(result), null, 2));
await rm(isolatedRoot, { recursive: true, force: true });
if (!result.pass) process.exitCode = 1;
