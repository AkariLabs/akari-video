#!/usr/bin/env node

// L1（実機 Electron + CDP + 実 DOM）: プレビューのペン / ピン / 範囲 → 「添付 N」 → AKARI チャット。
//
//   node apps/shell/extensions/akari-preview/evidence/akari-chat-review/run-l1.mjs
//
// 前提: apps/shell を production ビルド済み（npm run build）。Electron は
// apps/shell/node_modules/electron か、リポ root の node_modules/electron を使う（AKARI_L1_ELECTRON で上書き可）。
//
// 隔離: 一時ディレクトリ（ホームの外）に HOME / TMPDIR / プロファイル / Theia 設定 / プロジェクトを作る。
// プロジェクトはテンプレート + ffmpeg 合成素材 + 字幕付き edit.json + exports/draft-v1.mp4。
//
// akari.chat.attach の横取りは**このスクリプトの中だけ**で行う（チャット拡張の無い構成で
// 「AKARI チャットを開いてください」を確かめた後に、検証用コマンドを登録して引数を記録する）。
//
// 環境変数:
//   AKARI_L1_OUT        結果 JSON / スクリーンショットの出力先（既定: 隔離ディレクトリ内。リポに置かないこと）
//   AKARI_L1_ELECTRON   Electron 実行体のパス
//   AKARI_CDP_PORT      CDP ポート

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '..', '..', '..', '..', '..', '..');
const shellDir = path.join(worktree, 'apps', 'shell');

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function resolveElectron() {
    if (process.env.AKARI_L1_ELECTRON) return process.env.AKARI_L1_ELECTRON;
    const rel = process.platform === 'darwin'
        ? ['dist', 'Electron.app', 'Contents', 'MacOS', 'Electron']
        : process.platform === 'win32' ? ['dist', 'electron.exe'] : ['dist', 'electron'];
    for (const base of [path.join(shellDir, 'node_modules', 'electron'), path.join(worktree, 'node_modules', 'electron')]) {
        const candidate = path.join(base, ...rel);
        if (await exists(candidate)) return candidate;
    }
    throw new Error('Electron was not found');
}
const electronBinary = await resolveElectron();

const tmpBase = os.tmpdir().startsWith(os.homedir()) ? '/tmp' : os.tmpdir();
const isolatedRoot = await realpath(await mkdtemp(path.join(tmpBase, 'akari-chat-review-l1-')));
const workspaceDir = path.join(isolatedRoot, 'workspace');
const profileDir = path.join(isolatedRoot, 'profile');
const configDir = path.join(isolatedRoot, 'config');
const homeDir = path.join(isolatedRoot, 'home');
const tmpDir = path.join(isolatedRoot, 'tmp');
const outDir = process.env.AKARI_L1_OUT ? path.resolve(process.env.AKARI_L1_OUT) : path.join(isolatedRoot, 'out');
await Promise.all([profileDir, configDir, homeDir, tmpDir, outDir].map(dir => mkdir(dir, { recursive: true })));

function sanitizeText(value) {
    let text = String(value ?? '');
    for (const from of [worktree, isolatedRoot, outDir, os.homedir()]) {
        text = text.split(`file://${from}`).join('file://<REDACTED>');
        text = text.split(from).join('<REDACTED>');
    }
    return text.replace(/\/Users\/[^/"'\s]+/g, '<REDACTED>')
        .replace(/\/private\/tmp\/[^"'\s]+/g, '<REDACTED>')
        .replace(/\/var\/folders\/[^"'\s]+/g, '<REDACTED>');
}
const sanitizeValue = value => value === undefined ? undefined : JSON.parse(sanitizeText(JSON.stringify(value)));

// ---------------------------------------------------------------- fixture

const CAPTION_TEXT = 'え、こんなに軽いの？';
async function ffmpeg(args) {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`);
}
async function synthesizeProject(target) {
    await cp(path.join(worktree, 'templates', 'project-default'), target, { recursive: true });
    await mkdir(path.join(target, 'assets'), { recursive: true });
    await mkdir(path.join(target, 'exports'), { recursive: true });
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '10', '-an',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(target, 'assets', 'talk.mp4')]);
    await ffmpeg(['-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=30', '-t', '6', '-an',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(target, 'exports', 'draft-v1.mp4')]);
    const edit = {
        version: 2,
        output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'talk', path: 'assets/talk.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', items: [
                { id: 'talk-cut', at: 0, duration: 300, source: { kind: 'media', src: 'talk', in: 0, out: 10 } }
            ] },
            { id: 'captions', lane: 'visual', name: '字幕', content: { from: 'captions.json' } }
        ]
    };
    const captions = {
        default_text_style: {
            color: '#ffffff', size_px: 56,
            background: { color: '#000000', opacity: 0.72, mode: 'block' },
            zone: 'bottom'
        },
        captions: [{ id: 'c-0001', start: 0, end: 10, text: CAPTION_TEXT, speaker: null, sourceRef: null, edited: false }]
    };
    await writeFile(path.join(target, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await writeFile(path.join(target, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
}
await synthesizeProject(workspaceDir);
const originalEdit = await readFile(path.join(workspaceDir, 'edit.json'), 'utf8');
const originalCaptions = await readFile(path.join(workspaceDir, 'captions.json'), 'utf8');
const editUri = pathToFileURL(path.join(workspaceDir, 'edit.json')).href;
const pendingPath = path.join(workspaceDir, '.akari', 'review', 'pending.json');
async function readPending() {
    try { return JSON.parse(await readFile(pendingPath, 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- CDP

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
                const entry = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
                else entry.resolve(message.result);
                return;
            }
            for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
        });
    }
    send(method, params = {}, sessionId, timeoutMs = 30000) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
            this.pending.set(id, {
                resolve: value => { clearTimeout(timer); resolve(value); },
                reject: error => { clearTimeout(timer); reject(error); }
            });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
    close() { if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(); }
}

async function evalOn(cdp, expression, contextId, sessionId) {
    const params = { expression, returnByValue: true, awaitPromise: true, userGesture: true };
    if (contextId !== undefined) params.contextId = contextId;
    const result = await cdp.send('Runtime.evaluate', params, sessionId);
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${sanitizeText(JSON.stringify(result.exceptionDetails)).slice(0, 600)}`);
    return result.result.value;
}

async function waitForTargets(port, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            if (list.some(target => target.type === 'page')) return list;
        } catch { /* not up yet */ }
        await sleep(300);
    }
    throw new Error('CDP target was not ready');
}

// Theia の webview は二重 iframe。auto-attach + 明示 attach で内側の execution context を探す
class PreviewFinder {
    constructor(cdp) {
        this.cdp = cdp; this.sessions = new Map(); this.contexts = new Map();
        cdp.on('Runtime.executionContextCreated', (event, sessionId) => {
            if (!sessionId) return;
            const map = this.contexts.get(sessionId) ?? new Map();
            map.set(event.context.id, event.context);
            this.contexts.set(sessionId, map);
        });
        cdp.on('Runtime.executionContextDestroyed', (event, sessionId) => this.contexts.get(sessionId)?.delete(event.executionContextId));
        cdp.on('Target.detachedFromTarget', event => { this.sessions.delete(event.sessionId); this.contexts.delete(event.sessionId); });
        cdp.on('Target.attachedToTarget', event => { void this.register(event.sessionId, event.targetInfo); });
    }
    async initialize() {
        await this.cdp.send('Target.setDiscoverTargets', { discover: true });
        await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
        await this.refresh();
    }
    async register(sessionId, info) {
        if (String(info?.url ?? '').startsWith('devtools:')) return;
        this.sessions.set(sessionId, { info, sessionId });
        if (!this.contexts.has(sessionId)) this.contexts.set(sessionId, new Map());
        for (const [method, params] of [['Runtime.enable', {}], ['Page.enable', {}],
            ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }]]) {
            await this.cdp.send(method, params, sessionId).catch(() => undefined);
        }
    }
    async refresh() {
        const result = await this.cdp.send('Target.getTargets', {}).catch(() => undefined);
        const live = new Set([...this.sessions.values()].map(session => session.info?.targetId));
        for (const info of result?.targetInfos ?? []) {
            if (!['page', 'iframe', 'webview', 'other'].includes(info.type) || live.has(info.targetId)) continue;
            if (String(info.url ?? '').startsWith('devtools:')) continue;
            try {
                const attached = await this.cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
                await this.register(attached.sessionId, info);
            } catch { /* gone */ }
        }
    }
    // kind: 'output'（編集中のプレビュー）/ 'raw'（書き出し動画）
    async find(kind, timeoutMs = 60000) {
        const deadline = Date.now() + timeoutMs;
        const probe = `(() => { try { return { kind: window.__akariPreview?.kind ?? null,
            tools: document.querySelectorAll('[data-review-tool]').length,
            source: window.__akariPreview?.reviewSource ?? null,
            visible: document.visibilityState }; } catch (e) { return null; } })()`;
        while (Date.now() < deadline) {
            await this.refresh();
            for (const session of this.sessions.values()) {
                for (const context of this.contexts.get(session.sessionId)?.values() ?? []) {
                    const value = await evalOn(this.cdp, probe, context.id, session.sessionId).catch(() => null);
                    if (value?.kind === kind && value.tools >= 3) return { sessionId: session.sessionId, contextId: context.id, probe: value };
                }
            }
            await sleep(400);
        }
        throw new Error(`preview (${kind}) with review tools was not found`);
    }
    async findAll(kind) {
        await this.refresh();
        const found = [];
        for (const session of this.sessions.values()) {
            for (const context of this.contexts.get(session.sessionId)?.values() ?? []) {
                const value = await evalOn(this.cdp, `(() => { try { return { kind: window.__akariPreview?.kind ?? null,
                    tools: document.querySelectorAll('[data-review-tool]').length }; } catch (e) { return null; } })()`,
                context.id, session.sessionId).catch(() => null);
                if (value?.kind === kind && value.tools >= 3) found.push({ sessionId: session.sessionId, contextId: context.id });
            }
        }
        return found;
    }
}

const FIND_SERVICE = `(name, method) => {
  const dictionary = window.theia?.container?._bindingDictionary;
  const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
  const key = keys.find(candidate => typeof candidate === 'function' && candidate.prototype
    && method.every(m => typeof candidate.prototype[m] === 'function'));
  if (!key) throw new Error(name + ' binding was not found');
  return window.theia.container.get(key);
}`;

async function executeTheiaCommand(cdp, commandId, argument) {
    return evalOn(cdp, `(async () => { try {
      const registry = (${FIND_SERVICE})('CommandRegistry', ['executeCommand', 'registerCommand']);
      const value = await registry.executeCommand(${JSON.stringify(commandId)}, ${JSON.stringify(argument)});
      return { ok: true, value: value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value) ? value : undefined };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; } })()`);
}

async function dismissConsent(cdp) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const dismissed = await evalOn(cdp, `(() => {
      const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '開くだけ');
      if (!button) return false; button.click(); return true; })()`).catch(() => false);
        if (dismissed) return true;
        await sleep(300);
    }
    return false;
}

// ---------------------------------------------------------------- run state

const port = Number(process.env.AKARI_CDP_PORT) || 19000 + (process.pid % 20000);
const result = { steps: {}, checks: [], screenshots: [], errors: [] };
const check = (name, ok, detail) => {
    result.checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail: sanitizeValue(detail) }) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + sanitizeText(JSON.stringify(detail)).slice(0, 300)}`);
};

let child; let main; let browserCdp; let finder;

async function launch() {
    child = spawn(electronBinary, [
        shellDir, workspaceDir,
        `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-sandbox',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'
    ], {
        cwd: shellDir,
        env: { ...process.env, HOME: homeDir, TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir, THEIA_CONFIG_DIR: configDir,
            ELECTRON_RUN_AS_NODE: undefined },
        stdio: ['ignore', 'ignore', 'ignore']
    });
    const targets = await waitForTargets(port);
    const mainTarget = targets.find(target => target.type === 'page' && !target.url.startsWith('devtools:'));
    main = new CDP(mainTarget.webSocketDebuggerUrl);
    await main.connect();
    await main.send('Page.enable'); await main.send('Runtime.enable');
    browserCdp = new CDP((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
    await browserCdp.connect();
    finder = new PreviewFinder(browserCdp);
    await finder.initialize();
    await evalOn(main, '(() => { window.resizeTo(1600, 1100); return true; })()').catch(() => undefined);
    await sleep(700);
    await dismissConsent(main);
}

async function shutdown() {
    main?.close(); browserCdp?.close();
    if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        await Promise.race([exited, sleep(15000)]);
        if (child.exitCode === null) { child.kill('SIGKILL'); await Promise.race([exited, sleep(5000)]); }
    }
    child = undefined;
}

async function openEditPreview() {
    const deadline = Date.now() + 180000;
    let opened = { ok: false };
    while (Date.now() < deadline) {
        await dismissConsent(main).catch(() => undefined);
        opened = await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
        if (opened.ok && (opened.value === 'opened' || opened.value === 'revealed')) break;
        await sleep(1000);
    }
    if (!opened.ok) throw new Error(`ensureVisible failed: ${sanitizeText(JSON.stringify(opened))}`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await activateTab('出力プレビュー');
        const found = await finder.find('output', 3000).catch(() => undefined);
        if (found) return makeView(found, 'output');
    }
    return makeView(await finder.find('output', 30000), 'output');
}

async function openExportPreview() {
    const opened = await evalOn(main, `(async () => { try {
      const workspace = (${FIND_SERVICE})('WorkspaceService', ['tryGetRoots', 'containsSome']);
      const openerService = (${FIND_SERVICE})('OpenerService', ['getOpener', 'getOpeners']);
      const root = workspace.tryGetRoots()[0].resource;
      const uri = root.resolve('exports/draft-v1.mp4');
      const opener = await openerService.getOpener(uri, {});
      await opener.open(uri, {});
      return { ok: true, opener: opener.id };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; } })()`);
    result.steps.exportOpen = sanitizeValue(opened);
    if (!opened.ok) throw new Error(`export open failed: ${opened.error}`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await activateTab('draft-v1.mp4');
        const found = await finder.find('raw', 3000).catch(() => undefined);
        if (found) return makeView(found, 'raw');
    }
    return makeView(await finder.find('raw', 30000), 'raw');
}

async function activateTab(labelText) {
    const rect = await evalOn(main, `(() => {
      const label = Array.from(document.querySelectorAll('[class*="TabBar-tabLabel"]'))
        .find(element => element.textContent?.trim() === ${JSON.stringify(labelText)});
      if (!label) return null;
      const box = label.getBoundingClientRect();
      return box.width > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null; })()`).catch(() => null);
    if (rect) await mouseClick(rect.x, rect.y);
    await sleep(400);
}

async function mouseClick(x, y) {
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(30);
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(120);
}

// webview 内座標 → メインページ座標（2 点較正: 平行移動 + 倍率）
function makeView(found, kind) {
    let current = found;
    const view = {
        kind,
        async eval(expression) {
            try { return await evalOn(browserCdp, expression, current.contextId, current.sessionId); } catch (error) {
                result.errors.push({ evalRetry: sanitizeText(error.message).slice(0, 200) });
                current = await finder.find(kind, 20000);
                view.calibration = undefined;
                return evalOn(browserCdp, expression, current.contextId, current.sessionId);
            }
        },
        async calibrate() {
            // 同じ種類の webview の context が複数見えることがある（作り直し前の古いもの等）。ポインタが届くものを選ぶ
            const candidates = [current, ...(await finder.findAll(kind)).filter(c => c.contextId !== current.contextId || c.sessionId !== current.sessionId)];
            let lastError;
            for (const candidate of candidates) {
                current = candidate;
                try { return await view.calibrateCurrent(); } catch (error) { lastError = error; }
            }
            throw lastError;
        },
        async calibrateCurrent() {
            await view.eval(`(() => { window.__l1Pointer = null; if (!window.__l1PointerHooked) {
              window.__l1PointerHooked = true;
              document.addEventListener('mousemove', e => { window.__l1Pointer = { x: e.clientX, y: e.clientY }; }, true); }
              return true; })()`);
            // プレビューのタブが複数あると iframe も複数ある。実際にポインタが届く iframe を探す
            const frames = await evalOn(main, `(() => Array.from(document.querySelectorAll('iframe')).map(element => element.getBoundingClientRect())
                .filter(box => box.width > 200 && box.height > 150 && box.left >= 0 && box.top >= 0)
                .sort((a, b) => b.width * b.height - a.width * a.height)
                .map(box => ({ x: box.left, y: box.top, width: box.width, height: box.height })))()`);
            let frame; let samples = [];
            for (const candidate of frames) {
                samples = [];
                for (const [fx, fy] of [[0.3, 0.4], [0.7, 0.6]]) {
                    const x = candidate.x + candidate.width * fx; const y = candidate.y + candidate.height * fy;
                    await view.eval('(() => { window.__l1Pointer = null; return true; })()');
                    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
                    await sleep(250);
                    const inner = await view.eval('window.__l1Pointer');
                    if (!inner) break;
                    samples.push({ x, y, inner });
                }
                if (samples.length === 2) { frame = candidate; break; }
            }
            if (!frame) throw new Error('calibration pointer was not observed in the webview');
            const sx = (samples[1].x - samples[0].x) / (samples[1].inner.x - samples[0].inner.x);
            const sy = (samples[1].y - samples[0].y) / (samples[1].inner.y - samples[0].inner.y);
            view.calibration = { sx, sy, ox: samples[0].x - samples[0].inner.x * sx, oy: samples[0].y - samples[0].inner.y * sy, frame };
            return view.calibration;
        },
        toMain(point) {
            const c = view.calibration;
            return { x: c.ox + point.x * c.sx, y: c.oy + point.y * c.sy };
        },
        async rect(selector) {
            return view.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return null; const b = el.getBoundingClientRect();
              return b.width > 0 && b.height > 0 ? { left: b.left, top: b.top, width: b.width, height: b.height } : null; })()`);
        },
        async click(selector) {
            if (!view.calibration) await view.calibrate();
            const box = await view.rect(selector);
            if (!box) throw new Error(`not clickable: ${selector}`);
            const point = view.toMain({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
            await mouseClick(point.x, point.y);
        },
        async waitFor(expression, timeoutMs = 20000, label = expression) {
            const deadline = Date.now() + timeoutMs;
            let last;
            while (Date.now() < deadline) {
                last = await view.eval(expression).catch(error => ({ error: error.message }));
                if (last && !last.error) return last;
                await sleep(200);
            }
            throw new Error(`timeout waiting for ${label}: ${sanitizeText(JSON.stringify(last)).slice(0, 300)}`);
        }
    };
    return view;
}

const STATE = `(() => {
  const count = document.querySelector('[data-review-attach-count]');
  const layer = document.getElementById('review-chat-layer');
  const hint = document.querySelector('[data-review-hint]');
  const note = document.querySelector('[data-review-note]');
  const tray = document.getElementById('review-chat-tray');
  return {
    count: count ? Number(count.dataset.reviewAttachCount) : null,
    countText: count?.textContent ?? null,
    countHidden: count ? count.hidden : null,
    activeTool: document.querySelector('[data-review-tool][aria-pressed="true"]')?.dataset.reviewTool ?? null,
    layerCursor: layer ? getComputedStyle(layer).cursor : null,
    hint: hint && !hint.hidden ? hint.textContent : null,
    noteOpen: note ? !note.hidden : false,
    elements: Array.from(document.querySelectorAll('[data-review-elements] [data-review-element]')).map(e => e.textContent),
    elementsText: document.querySelector('[data-review-elements]')?.textContent ?? null,
    trayOpen: tray ? !tray.hidden : false,
    rows: Array.from(document.querySelectorAll('[data-review-row]')).map(row => ({
      text: row.querySelector('span')?.textContent ?? '',
      thumb: row.querySelector('img') ? { prefix: row.querySelector('img').src.slice(0, 23), width: row.querySelector('img').naturalWidth } : null })),
    seekDots: document.querySelectorAll('.review-seek-dot').length,
    marks: Array.from(document.querySelectorAll('[data-review-marks] .review-mark')).map(m => ({ tool: m.className, opacity: m.style.opacity })),
    seek: Number(document.getElementById('seek')?.value ?? NaN)
  }; })()`;

async function screenshot(name, view) {
    try {
        const rect = view?.calibration?.frame ?? await evalOn(main, `(() => {
      const frame = Array.from(document.querySelectorAll('iframe')).map(el => el.getBoundingClientRect())
        .filter(b => b.width > 200 && b.height > 150).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return frame ? { x: frame.left, y: frame.top, width: frame.width, height: frame.height } : null; })()`).catch(() => null);
        const shot = await main.send('Page.captureScreenshot', { format: 'png', ...(rect ? { clip: { ...rect, scale: 1 } } : {}) });
        await writeFile(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
        result.screenshots.push(`${name}.png`);
    } catch (error) {
        result.errors.push({ screenshot: name, error: sanitizeText(error.message) });
    }
}

async function seekEdit(view, time) {
    // 開いた直後はプレビューの準備が終わるまでシークが効かないことがあるので、効くまで繰り返す
    const deadline = Date.now() + 90000;
    for (;;) {
        await executeTheiaCommand(main, 'akari.preview.seekOutput', { editUri, time });
        const done = await view.waitFor(`Math.abs(Number(document.getElementById('seek').value) - ${time}) < 0.2 || null`, 5000, `seek ${time}`)
            .then(() => true, () => false);
        if (done) break;
        if (Date.now() > deadline) throw new Error(`seek ${time} did not take effect`);
    }
    await sleep(400);
}
async function seekRaw(view, time) {
    await view.eval(`(() => { const seek = document.getElementById('seek'); seek.value = String(${time});
      seek.dispatchEvent(new Event('input', { bubbles: true })); seek.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(500);
}

async function insertMemo(view, text) {
    await view.waitFor(`document.activeElement?.matches?.('[data-review-memo]') || null`, 5000, 'memo focus')
        .catch(async () => { await view.click('[data-review-memo]'); });
    await main.send('Input.insertText', { text });
    await sleep(150);
    const value = await view.eval(`document.querySelector('[data-review-memo]').value`);
    if (value !== text) throw new Error(`memo was not typed: ${value}`);
}

async function addAndWait(view, expectedCount) {
    await view.click('[data-review-add]');
    return view.waitFor(`(() => { const s = ${STATE}; return s.count === ${expectedCount} && !s.noteOpen ? s : null; })()`, 20000, `count ${expectedCount}`);
}

// 道具を選んで動画の上をドラッグ（丸）する。points は stage 内の 0〜1 座標
async function drawPen(view, points) {
    const stage = await view.rect('#preview-stage');
    const toMain = p => view.toMain({ x: stage.left + stage.width * p.x, y: stage.top + stage.height * p.y });
    const first = toMain(points[0]);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x, y: first.y, button: 'none' });
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', buttons: 1, clickCount: 1 });
    for (const point of points.slice(1)) {
        const next = toMain(point);
        await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: next.x, y: next.y, button: 'left', buttons: 1 });
        await sleep(16);
    }
    const last = toMain(points[points.length - 1]);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1 });
}

async function clickStage(view, point) {
    const stage = await view.rect('#preview-stage');
    const target = view.toMain({ x: stage.left + stage.width * point.x, y: stage.top + stage.height * point.y });
    await mouseClick(target.x, target.y);
}

// ---------------------------------------------------------------- scenario

let exitCode = 1;
try {
    await launch();

    // ===== 1. 編集中のプレビュー =====
    let edit = await openEditPreview();
    result.steps.editProbe = sanitizeValue((await edit.eval(`({ kind: window.__akariPreview.kind, source: window.__akariPreview.reviewSource })`)));
    await seekEdit(edit, 3);
    const plate = await edit.waitFor(`(() => { const el = Array.from(document.querySelectorAll('#caption-plate .caption-row-plate'))
      .find(e => e.textContent.includes(${JSON.stringify(CAPTION_TEXT)}));
      if (!el) return null; const b = el.getBoundingClientRect(); const s = document.getElementById('preview-stage').getBoundingClientRect();
      return b.width > 0 ? { x: (b.left + b.width / 2 - s.left) / s.width, y: (b.top + b.height / 2 - s.top) / s.height,
        w: b.width / s.width, h: b.height / s.height } : null; })()`, 60000, 'caption plate visible');
    result.steps.captionPlate = plate;
    await edit.calibrate();
    result.steps.calibration = edit.calibration;

    // Esc で解除
    await edit.click('[data-review-tool="pen"]');
    let state = await edit.eval(STATE);
    check('pen 選択で十字カーソルと案内', state.activeTool === 'pen' && state.layerCursor === 'crosshair' && Boolean(state.hint), { tool: state.activeTool, cursor: state.layerCursor, hint: state.hint });
    await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    state = await edit.eval(STATE);
    check('Esc で道具を解除', state.activeTool === null && state.hint === null, { tool: state.activeTool });

    // ペン: テロップを丸で囲む
    await edit.click('[data-review-tool="pen"]');
    await sleep(200);
    await screenshot('01-tool-selected-pen');
    const circle = [];
    // テロップの文字の行（.akari-caption__line）を囲む。行が取れなければプレート
    const lineBox = await edit.eval(`(() => { const plate = Array.from(document.querySelectorAll('#caption-plate .caption-row-plate'))
      .find(e => e.textContent.includes(${JSON.stringify(CAPTION_TEXT)}));
      const line = plate?.querySelector('.akari-caption__line'); if (!line) return null;
      const b = line.getBoundingClientRect(); const s = document.getElementById('preview-stage').getBoundingClientRect();
      return { x: (b.left + b.width / 2 - s.left) / s.width, y: (b.top + b.height / 2 - s.top) / s.height, w: b.width / s.width, h: b.height / s.height }; })()`);
    if (lineBox) Object.assign(plate, lineBox);
    result.steps.captionLine = lineBox;
    const rx = Math.min(0.45, plate.w / 2 + 0.04); const ry = Math.min(0.2, plate.h / 2 + 0.05);
    circle.push({ x: plate.x, y: plate.y });
    for (let i = 0; i <= 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        circle.push({ x: plate.x + rx * Math.cos(a), y: plate.y + ry * Math.sin(a) });
    }
    await drawPen(edit, circle);
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.noteOpen ? s : null; })()`, 10000, 'pen note');
    check('ペンの「ここにあるもの」にテロップの文字', state.elements.includes(`テロップ「${CAPTION_TEXT}」`), state.elements);
    check('「ここにあるもの」に CSS などの余計な文字が混ざらない', state.elements.every(e => !/[{};]/.test(e) && e.length <= 80), state.elements);
    const stageAfterPen = await edit.eval(`(() => { const plate = Array.from(document.querySelectorAll('#caption-plate .caption-row-plate'))
      .find(e => e.textContent.includes(${JSON.stringify(CAPTION_TEXT)}));
      const line = plate && (plate.querySelector('.akari-caption__line') || plate);
      return { captionVisible: Boolean(line) && line.getBoundingClientRect().width > 0 && getComputedStyle(line).visibility !== 'hidden' }; })()`);
    check('ペンを描いた後もプレビューにテロップが見えている', stageAfterPen.captionVisible, stageAfterPen);
    result.steps.penElements = state.elements;
    await insertMemo(edit, 'テロップを上に');
    await screenshot('02-note-with-elements');
    state = await addAndWait(edit, 1);
    check('ペン → 添付 1', state.count === 1 && state.countText === '添付 1', state.countText);
    // 保存した丸は描いた場所（shape の外接矩形）に重なって出る
    const penPlacement = await edit.eval(`(() => { const mark = document.querySelector('[data-review-marks] .review-mark.pen');
      if (!mark) return null; const m = mark.getBoundingClientRect(); const s = document.getElementById('preview-stage').getBoundingClientRect();
      return { cx: (m.left + m.width / 2 - s.left) / s.width, cy: (m.top + m.height / 2 - s.top) / s.height }; })()`);
    const savedPen = (await readPending())?.attachments?.[0]?.review?.shape;
    check('保存した丸は描いた位置に出る（中心のずれ 3% 以内）', penPlacement && savedPen
        && Math.abs(penPlacement.cx - (savedPen.x + savedPen.w / 2)) < 0.03 && Math.abs(penPlacement.cy - (savedPen.y + savedPen.h / 2)) < 0.03,
        { mark: penPlacement, shape: savedPen });

    // ピン
    await edit.click('[data-review-tool="pin"]');
    await clickStage(edit, { x: 0.3, y: 0.25 });
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.noteOpen ? s : null; })()`, 10000, 'pin note');
    result.steps.pinElements = state.elements;
    check('ピンの「ここにあるもの」に映像クリップ', state.elements.some(e => e.startsWith('映像')), state.elements);
    check('テロップから離れたピンにはテロップを出さない', !state.elements.some(e => e.startsWith('テロップ')), state.elements);
    await insertMemo(edit, 'ここの色を明るく');
    state = await addAndWait(edit, 2);
    check('ピン → 添付 2', state.count === 2, state.countText);

    // 範囲: 開始（3 秒）→ 5 秒へ → 終了
    await edit.click('[data-review-tool="range"]');
    await edit.click('[data-review-range-start]');
    await seekEdit(edit, 5);
    await edit.click('[data-review-range-end]');
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.noteOpen ? s : null; })()`, 10000, 'range note');
    await insertMemo(edit, 'この間のテンポを上げる');
    state = await addAndWait(edit, 3);
    check('範囲 → 帯が「添付 3」', state.count === 3 && state.countText === '添付 3' && state.countHidden === false, state.countText);
    check('シークバーに点が 3 つ', state.seekDots === 3, state.seekDots);
    check('時刻が離れた印は薄い（5 秒地点でペン 3 秒の印）', state.marks.some(m => m.tool.includes('pen') && Number(m.opacity) < 1), state.marks);
    await screenshot('03-band-attach-3');

    check('レビュー操作で edit.json / captions.json が書き換わらない',
        (await readFile(path.join(workspaceDir, 'edit.json'), 'utf8')) === originalEdit
        && (await readFile(path.join(workspaceDir, 'captions.json'), 'utf8')) === originalCaptions);
    const pending3 = await readPending();
    check('pending.json に 3 件', pending3?.attachments?.length === 3, pending3?.attachments?.map(a => a.review.tool));
    const range = pending3?.attachments?.find(a => a.review.tool === 'range')?.review;
    check('範囲は time < timeEnd', range && range.timeEnd > range.time, range && { time: range.time, timeEnd: range.timeEnd });

    // 帯を押すと膨らむ
    await edit.click('[data-review-attach-count]');
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.trayOpen ? s : null; })()`, 5000, 'tray open');
    check('膨らんだ一覧に 3 行', state.rows.length === 3, state.rows.map(r => r.text));
    check('一覧のコマの絵は JPEG・幅 160 以下', state.rows.filter(r => r.thumb).length >= 1
        && state.rows.every(r => !r.thumb || (r.thumb.prefix === 'data:image/jpeg;base64,' && r.thumb.width <= 160)), state.rows.map(r => r.thumb));
    await screenshot('04-tray-open');

    // × で 1 件外す（範囲）
    await edit.click('[data-review-remove="2"]');
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.rows.length === 2 ? s : null; })()`, 10000, 'remove one');
    const pending2 = await readPending();
    check('× で 1 件外れ pending.json も 2 件', state.count === 2 && pending2?.attachments?.length === 2, pending2?.attachments?.map(a => a.review.tool));

    // チャット拡張が無い構成: 通知を出して落ちない・pending はそのまま
    const hasChatCommand = await evalOn(main, `(() => { const r = (${FIND_SERVICE})('CommandRegistry', ['executeCommand', 'registerCommand']); return Boolean(r.getCommand('akari.chat.attach')); })()`);
    check('検証前提: akari.chat.attach は未登録', hasChatCommand === false, hasChatCommand);
    await edit.click('[data-review-send]');
    const notice = await (async () => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const text = await evalOn(main, `document.querySelector('.theia-notifications-container, .theia-notification-list, .theia-Notification')?.innerText
              ?? Array.from(document.querySelectorAll('[class*="notification"]')).map(e => e.innerText).join('\\n')`).catch(() => '');
            if (String(text).includes('AKARI チャットを開いてください')) return text;
            await sleep(250);
        }
        return null;
    })();
    check('チャット拡張なし → 「AKARI チャットを開いてください」', Boolean(notice));
    check('チャット拡張なしでは pending.json を消さない', (await readPending())?.attachments?.length === 2);

    // ===== 2. アプリを落として開き直す =====
    await shutdown();
    await sleep(1500);
    await launch();
    edit = await openEditPreview();
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.count === 2 ? s : null; })()`, 30000, 'restored count');
    await edit.calibrate();
    await edit.click('[data-review-attach-count]');
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.trayOpen ? s : null; })()`, 5000, 'tray open after restart');
    check('開き直しても添付待ち 2 件が残る', state.count === 2 && state.rows.length === 2, state.rows.map(r => r.text));

    // ===== 3. 検証用に akari.chat.attach を横取り（このスクリプトの中だけ） =====
    await evalOn(main, `(() => {
      const registry = (${FIND_SERVICE})('CommandRegistry', ['executeCommand', 'registerCommand']);
      window.__l1ChatAttachCalls = [];
      window.__l1ChatAttachDisposable = registry.registerCommand({ id: 'akari.chat.attach' }, {
        execute: arg => { window.__l1ChatAttachCalls.push(JSON.parse(JSON.stringify(arg))); return true; } });
      return true; })()`);
    await edit.click('[data-review-send]');
    const calls = await (async () => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const value = await evalOn(main, 'window.__l1ChatAttachCalls');
            if (value?.length) return value;
            await sleep(200);
        }
        return [];
    })();
    const arg = calls[0];
    const reviewShapeOk = mark => ['pen', 'pin', 'range'].includes(mark.tool) && typeof mark.source === 'string'
        && typeof mark.sourceLabel === 'string' && Number.isFinite(mark.time) && typeof mark.text === 'string'
        && (mark.timeEnd === undefined || Number.isFinite(mark.timeEnd))
        && (mark.shape === undefined || ['x', 'y', 'w', 'h'].every(k => mark.shape[k] === undefined || (mark.shape[k] >= 0 && mark.shape[k] <= 1)))
        && (mark.elements === undefined || (Array.isArray(mark.elements) && mark.elements.every(e => typeof e === 'string')))
        && (mark.thumbnail === undefined || mark.thumbnail.startsWith('data:image/'));
    check('akari.chat.attach が 1 回呼ばれる', calls.length === 1, calls.length);
    check('引数は { attachments: ChatAttachment[] }（契約 §3）', Boolean(arg) && Object.keys(arg).join() === 'attachments'
        && Array.isArray(arg.attachments) && arg.attachments.length === 2
        && arg.attachments.every(a => a.kind === 'review' && typeof a.label === 'string' && reviewShapeOk(a.review)),
        arg?.attachments?.map(a => ({ kind: a.kind, label: a.label, tool: a.review?.tool, source: a.review?.source,
            time: a.review?.time, shape: a.review?.shape, elements: a.review?.elements, text: a.review?.text,
            thumbnail: a.review?.thumbnail ? a.review.thumbnail.slice(0, 23) + '…' : undefined })));
    result.steps.attachArgument = sanitizeValue(arg && { attachments: arg.attachments.map(a => ({ ...a, review: { ...a.review,
        thumbnail: a.review.thumbnail ? `${a.review.thumbnail.slice(0, 23)}…(${a.review.thumbnail.length} chars)` : undefined } })) });
    state = await edit.waitFor(`(() => { const s = ${STATE}; return s.count === 0 ? s : null; })()`, 10000, 'emptied');
    const pending0 = await readPending();
    check('チャットに添付 → 一覧が空・pending.json も空', state.count === 0 && state.countHidden === true && !state.trayOpen
        && Array.isArray(pending0?.attachments) && pending0.attachments.length === 0, { count: state.count, pending: pending0 });

    // ===== 4. 書き出した動画（exports/*.mp4）のプレビュー =====
    const raw = await openExportPreview();
    result.steps.rawProbe = sanitizeValue(await raw.eval(`({ kind: window.__akariPreview.kind, source: window.__akariPreview.reviewSource,
      label: window.__akariPreview.reviewSourceLabel })`));
    await raw.calibrate();
    await seekRaw(raw, 2);
    await raw.click('[data-review-tool="pen"]');
    await sleep(200);
    await drawPen(raw, [{ x: 0.5, y: 0.5 }, ...Array.from({ length: 21 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2; return { x: 0.5 + 0.12 * Math.cos(a), y: 0.5 + 0.15 * Math.sin(a) };
    })]);
    state = await raw.waitFor(`(() => { const s = ${STATE}; return s.noteOpen ? s : null; })()`, 10000, 'raw pen note');
    result.steps.rawPenElementsText = state.elementsText;
    await insertMemo(raw, '色味を暖かく');
    state = await addAndWait(raw, 1);
    check('書き出し動画: ペン → 添付 1', state.count === 1, state.countText);
    await raw.click('[data-review-tool="pin"]');
    await screenshot('05-export-tool-selected', raw);
    await clickStage(raw, { x: 0.8, y: 0.2 });
    state = await raw.waitFor(`(() => { const s = ${STATE}; return s.noteOpen ? s : null; })()`, 10000, 'raw pin note');
    await insertMemo(raw, 'ロゴを小さく');
    state = await addAndWait(raw, 2);
    check('書き出し動画: ピン → 添付 2', state.count === 2, state.countText);
    const pendingRaw = await readPending();
    check('書き出し動画の印の source は exports/draft-v1.mp4', pendingRaw?.attachments?.every(a => a.review.source === 'exports/draft-v1.mp4'),
        pendingRaw?.attachments?.map(a => a.review.source));
    await raw.click('[data-review-attach-count]');
    await raw.waitFor(`(() => { const s = ${STATE}; return s.trayOpen ? s : null; })()`, 5000, 'raw tray');
    await screenshot('06-export-tray-open', raw);

    exitCode = result.checks.every(entry => entry.ok) ? 0 : 1;
} catch (error) {
    result.errors.push({ fatal: sanitizeText(error.stack || error.message) });
    console.error(sanitizeText(error.stack || error.message));
    await screenshot('99-failure').catch(() => undefined);
} finally {
    await shutdown().catch(() => undefined);
    result.pass = exitCode === 0;
    await writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(sanitizeValue(result), null, 2)}\n`);
    console.log(`checks: ${result.checks.filter(c => c.ok).length}/${result.checks.length} pass; screenshots: ${result.screenshots.length}`);
    if (!process.env.AKARI_L1_KEEP) await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(exitCode);
