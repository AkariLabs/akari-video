#!/usr/bin/env node

// L1（実機 Electron + CDP + 実 DOM・実マウス・実キー）: プレビューのペン / ピン / 範囲 / 添付。
// 道具は再生バーの 2 行目、入力と一覧はバーの下の置き場（#review-dock）に 1 つだけ出る。
//
//   node apps/shell/extensions/akari-preview/evidence/akari-chat-review/run-l1.mjs
//
// 前提: apps/shell を production ビルド済み（npm run build）。Electron は
// apps/shell/node_modules/electron か、リポ root の node_modules/electron を使う（AKARI_L1_ELECTRON で上書き可）。
//
// 隔離: 一時ディレクトリ（ホームの外）に HOME / TMPDIR / プロファイル / Theia 設定 / プロジェクトを作る。
// プロジェクトはテンプレート + ffmpeg 合成素材 + 字幕付き edit.json + exports/draft-v1.mp4。
// 自分で起動した Electron だけを使い、終わったらその PID だけを止める。CDP のポートは空いている番号を OS から取る。
//
// 渡す先はクリップボードで確かめる（パートナーの CLI は起動しない）。attach の節はシステムのクリップボードを
// 書き換えるので、始める前の文字を取っておき、終わったら戻す。
//
// 環境変数:
//   AKARI_L1_OUT        結果 JSON / スクリーンショットの出力先（既定: 隔離ディレクトリ内。リポに置かないこと）
//   AKARI_L1_ELECTRON   Electron 実行体のパス
//   AKARI_CDP_PORT      CDP ポート（既定: 空いている番号）
//   AKARI_L1_SECTIONS   流す節（カンマ区切り。既定は全部。節の一覧は scenario の頭）
//   AKARI_L1_KEEP       1 で隔離ディレクトリを残す

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, access } from 'node:fs/promises';
import net from 'node:net';
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

async function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { const { port: free } = server.address(); server.close(() => resolve(free)); });
    });
}
const port = Number(process.env.AKARI_CDP_PORT) || await freePort();
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
        // 押す前に、その点で当たる要素が目当ての要素（かその中身）であることを確かめる。スクロールで隠れた行などを座標だけで押すと、
        // 同じ場所にある別のボタンを押してしまうため。わざと当たらない要素を押す検査だけ force を付ける
        async click(selector, { force = false } = {}) {
            if (!view.calibration) await view.calibrate();
            const box = await view.rect(selector);
            if (!box) throw new Error(`not clickable: ${selector}`);
            if (!force) {
                const hit = await view.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
                  const at = document.elementFromPoint(${box.left + box.width / 2}, ${box.top + box.height / 2});
                  return at && el.contains(at) ? true : { hit: at ? at.tagName + (at.id ? '#' + at.id : '') + (typeof at.className === 'string' && at.className ? '.' + at.className : '') : null }; })()`);
                if (hit !== true) throw new Error(`covered or out of view: ${selector}: ${JSON.stringify(hit)}`);
            }
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

// ---------------------------------------------------------------- probes

// webview の中で使う小道具。式ごとに埋め込む（webview が作り直されても動くように）
const H = `(() => {
  if (window.__l1h) return window.__l1h;
  const rectOf = el => { if (!el || el.hidden || !el.getClientRects().length) return null; const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height } : null; };
  const overlap = (a, b) => !a || !b ? 0
    : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  // 絵（映像の枠）= frame-engine の canvas、無ければ video。枠の中に contain で収まった絵の矩形
  const picture = () => {
    const canvas = document.getElementById('frame-engine-canvas');
    const video = document.getElementById('preview-video');
    const shown = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const pick = shown(canvas) && canvas.width > 0 ? { el: canvas, w: canvas.width, h: canvas.height, id: 'frame-engine-canvas' }
      : shown(video) && video.videoWidth > 0 ? { el: video, w: video.videoWidth, h: video.videoHeight, id: 'preview-video' } : null;
    if (!pick) return null;
    const b = pick.el.getBoundingClientRect();
    const scale = Math.min(b.width / pick.w, b.height / pick.h);
    const w = pick.w * scale; const h = pick.h * scale;
    return { id: pick.id, left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, width: w, height: h };
  };
  const luminance = color => { const m = /rgba?\\(([^)]+)\\)/.exec(color); if (!m) return null;
    const [r, g, b] = m[1].split(',').slice(0, 3).map(v => { const c = Number(v) / 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); });
    return .2126 * r + .7152 * g + .0722 * b; };
  const contrast = (fg, bg) => { const a = luminance(fg); const b = luminance(bg); if (a === null || b === null) return null;
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  // 入力と一覧が同時に見えた瞬間を数える（hidden の書き換えのたび + 描画のたび）
  const both = () => Boolean(rectOf(document.querySelector('[data-review-note]')) && rectOf(document.getElementById('review-chat-tray')));
  const sampler = { both: 0, frames: 0, mutations: 0 };
  new MutationObserver(() => { sampler.mutations += 1; if (both()) sampler.both += 1; })
    .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  const tick = () => { sampler.frames += 1; if (both()) sampler.both += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__l1h = { rectOf, overlap, picture, contrast, sampler, q: s => document.querySelector(s) };
  return window.__l1h;
})()`;

const STATE = `(() => {
  const H = ${H};
  const count = H.q('[data-review-attach-count]');
  const dock = H.q('#review-dock');
  const note = H.q('[data-review-note]');
  const tray = H.q('#review-chat-tray');
  const memo = H.q('[data-review-memo]');
  const hint = H.q('[data-review-hint]');
  const layer = H.q('#review-chat-layer');
  const noteIndex = note?.dataset.reviewNoteIndex;
  return {
    count: count ? Number(count.dataset.reviewAttachCount) : null,
    countText: count?.textContent.trim() ?? null,
    countHidden: count ? count.hidden : null,
    countTitle: count?.title ?? null,
    activeTool: H.q('[data-review-tool][aria-pressed="true"]')?.dataset.reviewTool ?? null,
    layerCursor: layer ? getComputedStyle(layer).cursor : null,
    hint: H.rectOf(hint) ? hint.textContent : null,
    dockOpen: Boolean(H.rectOf(dock)),
    dockHeight: dock ? dock.getBoundingClientRect().height : null,
    noteOpen: Boolean(H.rectOf(note)),
    noteIndex: noteIndex === undefined || noteIndex === '' ? null : Number(noteIndex),
    noteBadge: H.q('[data-review-note-badge]')?.textContent.trim() ?? null,
    noteTime: H.q('[data-review-note-time]')?.textContent.trim() ?? null,
    noteTool: H.q('[data-review-note-tool]')?.dataset.reviewNoteTool ?? null,
    memoFocused: Boolean(memo) && document.activeElement === memo,
    memoValue: memo?.value ?? null,
    elements: Array.from(document.querySelectorAll('[data-review-elements] [data-review-element]')).map(e => e.textContent),
    elementsText: H.q('[data-review-elements]')?.textContent ?? null,
    trayOpen: Boolean(H.rectOf(tray)),
    rows: Array.from(document.querySelectorAll('[data-review-row]')).map(row => ({
      index: Number(row.dataset.reviewRow),
      badge: row.querySelector('.review-row-badge')?.textContent.trim() ?? null,
      text: row.querySelector('.review-row-text')?.textContent ?? '',
      thumb: row.querySelector('img') ? { prefix: row.querySelector('img').src.slice(0, 23), width: row.querySelector('img').naturalWidth,
        shownHeight: row.querySelector('img').getBoundingClientRect().height } : null })),
    sendText: H.q('[data-review-send]')?.textContent.trim() ?? null,
    seekDots: document.querySelectorAll('.review-seek-dot').length,
    marks: Array.from(document.querySelectorAll('[data-review-marks] .review-mark')).map(m => ({ index: Number(m.dataset.reviewIndex),
      text: m.textContent.trim(), tool: m.className.replace('review-mark', '').trim(), opacity: m.style.opacity,
      boxPointerEvents: getComputedStyle(m).pointerEvents,
      pointerEvents: (b => b ? getComputedStyle(b).pointerEvents : null)(m.matches('[data-review-badge]') ? m : m.querySelector('[data-review-badge]')) })),
    seek: Number(H.q('#seek')?.value ?? NaN),
    playLabel: H.q('#play-toggle')?.getAttribute('aria-label') ?? null,
    sampler: { ...H.sampler }
  }; })()`;

// 置き場（入力 / 一覧）とステージの重なり・最前面
const DOCK_GEOMETRY = `(() => {
  const H = ${H};
  const stage = H.rectOf(H.q('#preview-stage'));
  const dockEl = H.q('#review-dock');
  const dock = H.rectOf(dockEl);
  const note = H.rectOf(H.q('[data-review-note]'));
  const tray = H.rectOf(H.q('#review-chat-tray'));
  const toolbar = H.rectOf(H.q('.review-toolbar'));
  const center = dock ? document.elementFromPoint(dock.left + dock.width / 2, dock.top + dock.height / 2) : null;
  const style = dockEl ? getComputedStyle(dockEl) : null;
  return { stage, dock, note, tray, toolbar,
    dockStageOverlap: H.overlap(dock, stage), noteStageOverlap: H.overlap(note, stage), trayStageOverlap: H.overlap(tray, stage),
    centerInsideDock: Boolean(center && dockEl.contains(center)),
    centerElement: center ? (center.tagName + (center.id ? '#' + center.id : '') + (center.className && typeof center.className === 'string' ? '.' + center.className : '')) : null,
    noteInStage: Boolean(H.q('#preview-stage [data-review-note]')),
    noteInDock: Boolean(H.q('#review-dock [data-review-note]')),
    trayInDock: Boolean(H.q('#review-dock #review-chat-tray')),
    dockBelowToolbar: dock && toolbar ? dock.top - toolbar.bottom : null,
    dockPosition: style?.position ?? null,
    dockMaxHeight: style?.maxHeight ?? null,
    dockPadding: style ? [style.paddingTop, style.paddingBottom] : null,
    dockScroll: dockEl ? { scrollHeight: dockEl.scrollHeight, clientHeight: dockEl.clientHeight, overflowY: style.overflowY } : null,
    limit: Math.min(window.innerHeight * .4, 220),
    viewport: { w: window.innerWidth, h: window.innerHeight }
  }; })()`;

// 一覧の渡すボタンの行（.review-tray-actions）が、置き場の見えている矩形のどこにあるか。行がその下を流れていないか
const SEND_ROW = `(() => {
  const H = ${H};
  const dockEl = H.q('#review-dock'); const trayEl = H.q('#review-chat-tray'); const rowsEl = H.q('#review-chat-tray [data-review-rows]');
  const actionsEl = H.q('#review-chat-tray .review-tray-actions'); const sendEl = H.q('#review-chat-tray [data-review-send]');
  const dock = H.rectOf(dockEl); const actions = H.rectOf(actionsEl); const send = H.rectOf(sendEl);
  if (!dock || !actions || !send) return null;
  const cut = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const box = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top });
  const inner = el => { const b = el.getBoundingClientRect();
    return { left: b.left + el.clientLeft, top: b.top + el.clientTop, right: b.left + el.clientLeft + el.clientWidth, bottom: b.top + el.clientTop + el.clientHeight }; };
  // 置き場の見えている矩形 = 枠の内側（border を除く）を画面で切ったもの
  const visible = cut(inner(dockEl), { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
  const inside = (r, outer) => r.left >= outer.left - .5 && r.right <= outer.right + .5 && r.top >= outer.top - .5 && r.bottom <= outer.bottom + .5;
  const scrollable = el => Boolean(el) && el.scrollHeight - el.clientHeight > 1 && /auto|scroll/.test(getComputedStyle(el).overflowY);
  const scrollerName = scrollable(rowsEl) ? 'rows' : scrollable(trayEl) ? 'tray' : scrollable(dockEl) ? 'dock' : null;
  const scrollerEl = { rows: rowsEl, tray: trayEl, dock: dockEl }[scrollerName] ?? null;
  // 行が見える範囲 = スクロールする箱の内側（スクロールしていないときは置き場の内側）
  const rowClip = scrollerEl ? cut(inner(scrollerEl), visible) : visible;
  const rows = Array.from(document.querySelectorAll('#review-chat-tray [data-review-row]')).map(row => {
    const b = row.getBoundingClientRect(); const shown = cut(b, rowClip);
    const shownRect = shown.right > shown.left && shown.bottom > shown.top ? box(shown) : null;
    const text = row.querySelector('.review-row-text'); const t = text?.getBoundingClientRect();
    const at = t ? document.elementFromPoint(t.left + Math.min(t.width / 2, 40), t.top + t.height / 2) : null;
    return { index: Number(row.dataset.reviewRow), badge: row.querySelector('.review-row-badge')?.textContent.trim() ?? null,
      text: text?.textContent ?? '', top: b.top, bottom: b.bottom, height: b.height,
      fullyShown: inside(b, rowClip), aboveActions: b.bottom <= actions.top + .5,
      underActions: shownRect ? H.overlap(shownRect, actions) > .5 : false, hit: Boolean(at && row.contains(at)) }; });
  const points = [[send.left + send.width / 2, send.top + send.height / 2], [send.left + 2, send.top + 2], [send.right - 2, send.top + 2],
    [send.left + 2, send.bottom - 2], [send.right - 2, send.bottom - 2]];
  const sendHits = points.map(([x, y]) => { const el = document.elementFromPoint(x, y); return Boolean(el && sendEl.contains(el)); });
  const opaque = color => { const m = /rgba?\\(([^)]+)\\)/.exec(color); if (!m) return false; const parts = m[1].split(',').map(Number); return parts.length < 4 || parts[3] === 1; };
  let bgEl = actionsEl; while (bgEl !== dockEl && !opaque(getComputedStyle(bgEl).backgroundColor)) bgEl = bgEl.parentElement;
  const actionsHits = [.08, .3, .5].map(f => { const el = document.elementFromPoint(actions.left + actions.width * f, actions.top + actions.height / 2);
    return { inActions: Boolean(el && actionsEl.contains(el)), inRow: Boolean(el?.closest?.('[data-review-row]')), inDock: Boolean(el && dockEl.contains(el)) }; });
  const ds = getComputedStyle(dockEl);
  const fixed = dockEl.clientTop + parseFloat(ds.paddingTop) + parseFloat(ds.paddingBottom) + actions.height;
  const last = rows[rows.length - 1] ?? null;
  const listBottom = Math.min(actions.top, visible.bottom);
  return { count: rows.length, dock: box(dock), visible: box(visible), actions: box(actions), send: box(send),
    sendInside: inside(send, visible), sendHits, sendHitAll: sendHits.every(Boolean),
    actionsInside: inside(actions, visible),
    scroller: scrollerEl ? { which: scrollerName, scrollTop: scrollerEl.scrollTop, scrollHeight: scrollerEl.scrollHeight, clientHeight: scrollerEl.clientHeight,
      max: scrollerEl.scrollHeight - scrollerEl.clientHeight } : null,
    overflow: { dock: ds.overflowY, tray: getComputedStyle(trayEl).overflowY, rows: getComputedStyle(rowsEl).overflowY, actionsPosition: getComputedStyle(actionsEl).position },
    rowClip: box(rowClip), rows, last, rowsUnderActions: rows.filter(row => row.underActions).map(row => row.index),
    actionsBg: getComputedStyle(actionsEl).backgroundColor, effectiveBg: getComputedStyle(bgEl).backgroundColor,
    effectiveBgFrom: bgEl === actionsEl ? 'actions' : bgEl === dockEl ? 'dock' : (bgEl.id || bgEl.className), dockBg: ds.backgroundColor, actionsHits,
    // 行の高さの合計 + ボタンの行 + 置き場の padding / border と、置き場の高さの差（スクロールしていないときは 0 = 余分な隙間なし）
    slack: dock.height - (fixed + rows.reduce((sum, row) => sum + row.height, 0)),
    gapLastRowToActions: last ? actions.top - last.bottom : null,
    padding: [ds.paddingTop, ds.paddingBottom], borderTop: dockEl.clientTop, limit: Math.min(window.innerHeight * .4, 220), maxHeight: ds.maxHeight,
    listPoint: { x: visible.left + (visible.right - visible.left) / 2, y: (rowClip.top + Math.max(rowClip.top + 8, listBottom)) / 2 }
  }; })()`;
// 行が透けない = 行がボタンの行の下を流れない。流れる作り（sticky）なら、ボタンの行の地が不透明で、行より前面にあること
const sendRowSolid = probe => Boolean(probe) && probe.effectiveBg === probe.dockBg
    && (probe.rowsUnderActions.length === 0
        || (probe.effectiveBgFrom === 'actions' && probe.actionsHits.every(hit => hit.inActions && !hit.inRow)));

// 印（index）の中心が、絵（映像の枠）のどこにあるか（0〜1）
const markOnPicture = index => `(() => {
  const H = ${H};
  const mark = H.q('[data-review-marks] .review-mark[data-review-index="${index}"]');
  const picture = H.picture();
  const stage = H.rectOf(H.q('#preview-stage'));
  if (!mark || !picture || !stage) return null;
  const m = mark.getBoundingClientRect();
  const cx = m.left + m.width / 2; const cy = m.top + m.height / 2;
  return { picture: picture.id, x: (cx - picture.left) / picture.width, y: (cy - picture.top) / picture.height,
    stageX: (cx - stage.left) / stage.width, stageY: (cy - stage.top) / stage.height,
    pictureSize: { w: picture.width, h: picture.height }, stageSize: { w: stage.width, h: stage.height } }; })()`;

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

// 実キー（CDP の Input.dispatchKeyEvent）
async function pressKey(key, code, vk, { text, modifiers = 0 } = {}) {
    await main.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, modifiers,
        windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text, unmodifiedText: text } : {}) });
    await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(150);
}
const pressEscape = () => pressKey('Escape', 'Escape', 27);
const pressEnter = (modifiers = 0) => pressKey('Enter', 'Enter', 13, { text: '\r', modifiers });
const SHIFT = 8;

async function typeMemo(view, text) {
    await view.waitFor(`document.activeElement?.matches?.('[data-review-memo]') || null`, 5000, 'memo focus');
    await main.send('Input.insertText', { text });
    await sleep(150);
}

const pendingList = async () => (await readPending())?.attachments ?? [];
async function waitPending(predicate, label, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let list = [];
    while (Date.now() < deadline) {
        list = await pendingList();
        if (predicate(list)) return list;
        await sleep(200);
    }
    throw new Error(`timeout waiting for pending.json: ${label}: ${sanitizeText(JSON.stringify(list.map(a => ({ tool: a.review?.tool, text: a.review?.text })))).slice(0, 300)}`);
}
const waitState = (view, predicate, label, timeoutMs = 10000) =>
    view.waitFor(`(() => { const s = ${STATE}; return (${predicate}) ? s : null; })()`, timeoutMs, label);

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
    await sleep(150);
}

async function clickStage(view, point) {
    const stage = await view.rect('#preview-stage');
    const target = view.toMain({ x: stage.left + stage.width * point.x, y: stage.top + stage.height * point.y });
    await mouseClick(target.x, target.y);
}
// 押して、期待の状態にならなければもう 1 回だけ押す。やり直した事実は result.retries に残し、最後に 0 件であることを確かめる
async function clickUntil(view, selector, predicate, label) {
    await view.click(selector);
    const first = await waitState(view, predicate, label, 3000).catch(() => null);
    if (first) return first;
    result.retries.push(label);
    await view.click(selector);
    return waitState(view, predicate, `${label} (retry)`);
}
async function clickBadge(view, index, options) {
    await view.click(`[data-review-marks] [data-review-badge="${index}"]`, options);
}
// 2 行目の左の何も無いところ（入力からフォーカスを外すため）
async function clickToolbarBlank(view) {
    const box = await view.rect('.review-toolbar');
    const point = view.toMain({ x: box.left + 24, y: box.top + box.height / 2 });
    await mouseClick(point.x, point.y);
}

// 実マウスのホイール（webview の中の点）
async function wheelAt(view, point, deltaY) {
    const target = view.toMain(point);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none' });
    await main.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY });
    await sleep(350);
}
// 一覧をいちばん下（toEnd）/ いちばん上までホイールで送る。ホイールで届かなければ scrollTop を直に書き、その事実を返す
async function scrollList(view, toEnd) {
    const reached = probe => !probe?.scroller || (toEnd ? probe.scroller.scrollTop >= probe.scroller.max - .5 : probe.scroller.scrollTop <= .5);
    const used = { wheel: 0, forced: false };
    let probe = await view.eval(SEND_ROW);
    for (let turn = 0; turn < 10 && !reached(probe); turn += 1) {
        await wheelAt(view, probe.listPoint, toEnd ? 300 : -300);
        used.wheel += 1;
        probe = await view.eval(SEND_ROW);
    }
    if (!reached(probe)) {
        used.forced = true;
        const selector = { rows: '#review-chat-tray [data-review-rows]', tray: '#review-chat-tray', dock: '#review-dock' }[probe.scroller.which];
        await view.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollTop = ${toEnd ? 'el.scrollHeight' : '0'}; return true; })()`);
        await sleep(200);
        probe = await view.eval(SEND_ROW);
    }
    await sleep(150);
    return { probe: await view.eval(SEND_ROW), used };
}

// 一覧の行（index）が全部見える所までホイールで送る（スクロールするのは行の領域だけなので、下の行は送らないと押せない）
async function revealRow(view, index) {
    let probe = await view.eval(SEND_ROW);
    for (let turn = 0; turn < 12; turn += 1) {
        const row = probe?.rows.find(entry => entry.index === index);
        if (!row) throw new Error(`no tray row ${index}`);
        if (row.fullyShown && row.aboveActions) return probe;
        await wheelAt(view, probe.listPoint, row.bottom > probe.rowClip.bottom ? Math.max(20, row.bottom - probe.rowClip.bottom + 2) : Math.min(-20, row.top - probe.rowClip.top - 2));
        probe = await view.eval(SEND_ROW);
    }
    throw new Error(`tray row ${index} did not scroll into view`);
}

async function setTheme(id, view) {
    const applied = await evalOn(main, `(() => { try {
      const service = (${FIND_SERVICE})('ThemeService', ['setCurrentTheme', 'getCurrentTheme']);
      service.setCurrentTheme(${JSON.stringify(id)});
      return { ok: true, id: service.getCurrentTheme().id, type: service.getCurrentTheme().type };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; } })()`);
    const wanted = id.includes('light') ? 'vscode-light' : 'vscode-dark';
    await view.waitFor(`document.body.classList.contains(${JSON.stringify(wanted)}) || null`, 15000, `theme ${id}`);
    await sleep(500);
    return applied;
}

const THEME_COLORS = `(() => {
  const H = ${H};
  const style = el => el ? getComputedStyle(el) : null;
  const transport = H.q('.transport'); const dock = H.q('#review-dock'); const memo = H.q('[data-review-memo]');
  const hint = H.q('[data-review-hint]'); const rowText = H.q('.review-row-text'); const tool = H.q('[data-review-tool]:not([aria-pressed="true"])');
  const pressed = H.q('[data-review-tool][aria-pressed="true"]');
  const bg = style(transport).backgroundColor;
  const dockBg = dock && H.rectOf(dock) ? style(dock).backgroundColor : null;
  const memoBg = memo && H.rectOf(memo) ? style(memo).backgroundColor : null;
  const solid = color => color && !/rgba\\([^)]*,\\s*0\\)$/.test(color) && color !== 'transparent' ? color : null;
  const under = solid(dockBg) || bg;
  return { bodyClass: document.body.className, transportBg: bg, dockBg, memoBg,
    toolColor: tool ? style(tool).color : null, toolContrast: tool ? H.contrast(style(tool).color, bg) : null,
    pressedColor: pressed ? style(pressed).color : null, pressedBg: pressed ? style(pressed).backgroundColor : null,
    hintContrast: H.rectOf(hint) ? H.contrast(style(hint).color, bg) : null,
    memoContrast: memo && H.rectOf(memo) ? H.contrast(style(memo).color, solid(memoBg) || under) : null,
    rowContrast: rowText && H.rectOf(rowText) ? H.contrast(style(rowText).color, under) : null
  }; })()`;

// ---------------------------------------------------------------- scenario
//
// 節（AKARI_L1_SECTIONS で絞れる。既定は全部。後ろの節は前の節が作った印を使う）:
//   layout   … 2 行目の並び・アイコン・余白（受け入れ 1・2）
//   pin      … ピン → 番号・置き場の入力・続けて打つ・番号で直す・Esc・キーの漏れ（3・4・5・9・10）
//   pen      … ペン → 番号 + 置き場の入力（6）
//   range    … 範囲 → 印・時刻の表示・薄い印は押せない
//   tray     … 添付の一覧・同時に出ない・行から直す・×（7・8）
//   geometry … 置き場の開閉・窓の大きさで印が絵の同じ場所にある（11）
//   chrome   … 置き場の開閉に、選んだ要素の枠が追従する
//   longlist … 印を 6 件にして、一覧が長くても渡すボタンが置き場の下端に見えている（スクロールするのは行だけ）
//   themes   … 明るい / 暗いテーマの画像（2 行目・入力・一覧・一覧のいちばん下）+ 文字と地のコントラスト（14）+ 渡すボタンの行の地
//   restart  … アプリを落として開き直す（13）
//   attach   … 「クリップボードにコピー」で渡す中身（12。システムのクリップボードを書き換え、終わったら元の文字へ戻す）
//   export   … 書き出した動画のプレビュー（15）+ 印が 1 件のときの一覧（行とボタンの行の間に余分な隙間が無い）

const ALL_SECTIONS = ['layout', 'pin', 'pen', 'range', 'tray', 'geometry', 'chrome', 'longlist', 'themes', 'restart', 'attach', 'export'];
const sections = new Set((process.env.AKARI_L1_SECTIONS || ALL_SECTIONS.join(',')).split(',').map(s => s.trim()).filter(Boolean));
const on = name => sections.has(name);
result.sections = [...sections];
result.retries = [];

const MEMO_PIN_1A = 'ここの色を';
const MEMO_PIN_1B = '明るく';
const MEMO_PEN = 'テロップを上に';
const MEMO_RANGE = 'この間のテンポを上げる';

// システムのクリップボードの文字。attach の節のほか、押し間違いで渡すボタンに当たった場合にも書き換わるので、
// 走行の頭で取っておき、終わりに（変わっていれば）戻す
const clipboardAtStart = spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout ?? '';

let exitCode = 1;
try {
    await launch();
    let edit = await openEditPreview();
    result.steps.editProbe = sanitizeValue((await edit.eval(`({ kind: window.__akariPreview.kind, source: window.__akariPreview.reviewSource })`)));
    await seekEdit(edit, 3);
    const plate = await edit.waitFor(`(() => { const el = Array.from(document.querySelectorAll('#caption-plate .caption-row-plate'))
      .find(e => e.textContent.includes(${JSON.stringify(CAPTION_TEXT)}));
      if (!el) return null; const b = el.getBoundingClientRect(); const s = document.getElementById('preview-stage').getBoundingClientRect();
      return b.width > 0 ? { x: (b.left + b.width / 2 - s.left) / s.width, y: (b.top + b.height / 2 - s.top) / s.height,
        w: b.width / s.width, h: b.height / s.height } : null; })()`, 60000, 'caption plate visible');
    await edit.calibrate();
    let state = await edit.eval(STATE);

    // ===== layout: 2 行目（受け入れ 1・2） =====
    if (on('layout')) {
        const LAYOUT = `(() => {
          const H = ${H};
          const transport = H.q('.transport'); const controls = H.q('.transport-controls'); const toolbar = H.q('.review-toolbar');
          const dock = H.q('#review-dock'); const right = H.q('.transport-right'); const play = H.q('#akari-gen-capture-frame');
          const tools = Array.from(document.querySelectorAll('[data-review-tool]'));
          const attach = H.q('[data-review-attach-count]');
          const box = el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
          const shown = el => el.getClientRects().length > 0 && !el.hidden;
          const tb = toolbar ? getComputedStyle(toolbar) : null;
          return {
            toolbarParentIsTransport: Boolean(toolbar) && toolbar.parentElement === transport,
            toolbarFollowsControls: Boolean(toolbar) && toolbar.previousElementSibling === controls,
            dockFollowsToolbar: Boolean(toolbar) && toolbar.nextElementSibling === dock,
            toolsInToolbar: tools.length === 3 && tools.every(b => toolbar?.contains(b)) && Boolean(toolbar?.contains(attach)),
            reviewNodesInRight: right.querySelectorAll('[data-review-tool],[data-review-attach-count],.review-tools,[data-review-range-start],[data-review-range-end],[class*="review-"]').length,
            rightChildren: Array.from(right.children).map(c => c.id || c.className),
            row1Bottom: Math.max(...Array.from(controls.querySelectorAll('.icon-button')).filter(shown).map(b => b.getBoundingClientRect().bottom)),
            toolTops: tools.map(b => b.getBoundingClientRect().top),
            tools: tools.map(b => ({ tool: b.dataset.reviewTool, text: b.textContent.trim(), title: b.title, aria: b.getAttribute('aria-label'),
              pressed: b.getAttribute('aria-pressed'), svg: b.querySelectorAll('svg').length, iconButton: b.classList.contains('icon-button'),
              w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, bg: getComputedStyle(b).backgroundColor,
              color: getComputedStyle(b).color })),
            attach: attach ? { hidden: attach.hidden, text: attach.textContent.trim(), title: attach.title, aria: attach.getAttribute('aria-label'),
              svg: attach.querySelectorAll('svg').length } : null,
            playSize: { id: play.id, w: play.getBoundingClientRect().width, h: play.getBoundingClientRect().height, bg: getComputedStyle(play).backgroundColor },
            controls: box(controls), toolbar: toolbar ? box(toolbar) : null,
            toolbarPadding: tb ? [tb.paddingTop, tb.paddingBottom] : null,
            toolbarMargin: tb ? [tb.marginTop, tb.marginBottom] : null,
            gap: toolbar ? toolbar.getBoundingClientRect().top - controls.getBoundingClientRect().bottom : null,
            dock: dock ? { hidden: dock.hidden, height: dock.getBoundingClientRect().height, display: getComputedStyle(dock).display } : null,
            transportHeight: transport.getBoundingClientRect().height,
            transportRows: Array.from(transport.children).filter(shown).map(c => ({ name: c.id || c.className, height: c.getBoundingClientRect().height })),
            hintOnStage: Boolean(H.q('#preview-stage [data-review-hint]')),
            rangeControlsShown: Array.from(document.querySelectorAll('[data-review-range-start],[data-review-range-end]')).filter(shown).length,
            rangeControlsInToolbar: Array.from(document.querySelectorAll('[data-review-range-start],[data-review-range-end]')).every(b => toolbar?.contains(b)),
            rangeControlTops: Array.from(document.querySelectorAll('[data-review-range-start],[data-review-range-end]')).filter(shown).map(b => [b.getBoundingClientRect().top, b.getBoundingClientRect().bottom])
          }; })()`;
        const layout = await edit.eval(LAYOUT);
        result.steps.layout = layout;
        check('1: 道具は 2 行目（.transport 直下・1 行目のすぐ下）にあり、1 行目のボタンより下',
            layout.toolbarParentIsTransport && layout.toolbarFollowsControls && layout.toolsInToolbar
            && layout.toolTops.every(top => top >= layout.row1Bottom - 0.5),
            { row1Bottom: layout.row1Bottom, toolTops: layout.toolTops });
        check('1: 1 行目の .transport-right に道具を足していない', layout.reviewNodesInRight === 0, layout.rightChildren);
        check('1: 道具のボタンは文字のラベルなし（SVG だけ）・title / aria-label に名前',
            layout.tools.length === 3 && layout.tools.every(t => t.text === '' && t.svg === 1
                && t.title === ({ pen: 'ペン', pin: 'ピン', range: '範囲' })[t.tool] && t.aria === t.title),
            layout.tools.map(t => ({ tool: t.tool, text: t.text, title: t.title, aria: t.aria })));
        check('A-3: 道具のボタンは 1 行目のアイコンのボタンと同じ大きさ・地の塗りなし',
            layout.tools.every(t => t.iconButton && Math.abs(t.w - layout.playSize.w) < 0.5 && Math.abs(t.h - layout.playSize.h) < 0.5
                && /rgba\(0, 0, 0, 0\)|transparent/.test(t.bg)),
            { play: layout.playSize, tools: layout.tools.map(t => ({ w: t.w, h: t.h, bg: t.bg })) });
        check('2: 2 行目の高さはボタンの高さだけ（上下の padding 0〜2px）・1 行目との隙間なし',
            layout.toolbar && layout.toolbarPadding.every(v => parseFloat(v) <= 2)
            && layout.toolbar.height <= layout.playSize.h + 4.5 && Math.abs(layout.gap) <= 0.5,
            { toolbarHeight: layout.toolbar?.height, padding: layout.toolbarPadding, margin: layout.toolbarMargin, gap: layout.gap });
        check('2: 置き場は閉じているとき高さ 0（隙間も線も無い）', layout.dockFollowsToolbar && layout.dock?.height === 0, layout.dock);
        check('A-5: 添付のボタンは 0 件のとき隠れている', layout.attach?.hidden === true, layout.attach);
        check('A-7: ステージの上に案内を出さない', layout.hintOnStage === false && state.hint === null);

        await edit.click('[data-review-tool="pen"]');
        await sleep(250);
        state = await edit.eval(STATE);
        const penLook = await edit.eval(`(() => { const H = ${H}; const b = H.q('[data-review-tool="pen"]'); const hint = H.q('[data-review-hint]');
          const toolbar = H.rectOf(H.q('.review-toolbar')); const hr = H.rectOf(hint); const s = getComputedStyle(b);
          return { color: s.color, bg: s.backgroundColor, hintInToolbar: Boolean(hr && toolbar && hr.top >= toolbar.top - 0.5 && hr.bottom <= toolbar.bottom + 0.5),
            hintInsideToolbarNode: Boolean(H.q('.review-toolbar [data-review-hint]')), hintFontSize: hint ? getComputedStyle(hint).fontSize : null }; })()`);
        result.steps.penSelected = { state: { tool: state.activeTool, hint: state.hint, cursor: state.layerCursor }, look: penLook };
        await screenshot('layout-pen-selected', edit);
        check('A-2: 道具を選ぶと 2 行目の左に案内・ステージは十字カーソル',
            state.activeTool === 'pen' && state.layerCursor === 'crosshair' && Boolean(state.hint) && penLook.hintInToolbar && penLook.hintInsideToolbarNode,
            { hint: state.hint, cursor: state.layerCursor, look: penLook });
        check('A-3: 選んでいる道具は aria-pressed + オレンジ・地の塗りなし',
            /rgb\(249, 115, 22\)|rgb\(251, 146, 60\)/.test(penLook.color) && /rgba\(0, 0, 0, 0\)|transparent/.test(penLook.bg), penLook);
        await pressEscape();
        state = await edit.eval(STATE);
        check('Esc で道具を外す（道具だけのとき）', state.activeTool === null && state.hint === null, { tool: state.activeTool });

        await edit.click('[data-review-tool="range"]');
        await sleep(250);
        const rangeLayout = await edit.eval(LAYOUT);
        result.steps.rangeLayout = { rows: rangeLayout.transportRows, tops: rangeLayout.rangeControlTops, toolbar: rangeLayout.toolbar };
        check('A-4: 範囲の「開始」「終了」は 2 行目の中（3 行目を作らない）',
            rangeLayout.rangeControlsShown === 2 && rangeLayout.rangeControlsInToolbar
            && rangeLayout.rangeControlTops.every(([top, bottom]) => top >= rangeLayout.toolbar.top - 0.5 && bottom <= rangeLayout.toolbar.bottom + 0.5)
            && rangeLayout.transportRows.length === layout.transportRows.length
            && Math.abs(rangeLayout.transportHeight - layout.transportHeight) < 0.5,
            { rowsBefore: layout.transportRows.map(r => r.name), rowsRange: rangeLayout.transportRows.map(r => r.name),
                heightBefore: layout.transportHeight, heightRange: rangeLayout.transportHeight });
        await pressEscape();
        state = await edit.eval(STATE);
        check('範囲を外すと「開始」「終了」が消える', state.activeTool === null
            && (await edit.eval(LAYOUT)).rangeControlsShown === 0);
    }

    // ===== pin: 付けた瞬間に印・置き場の入力・番号で直す・Esc・キーの漏れ（3・4・5・9・10） =====
    if (on('pin')) {
        await edit.click('[data-review-tool="pin"]');
        await sleep(200);
        const pin1 = { x: 0.3, y: 0.25 };
        await clickStage(edit, pin1);
        state = await waitState(edit, 's.noteOpen && s.marks.some(m => m.index === 0)', 'pin 1 note');
        let pending = await waitPending(list => list.length === 1, 'pin 1 saved');
        let geometry = await edit.eval(DOCK_GEOMETRY);
        const pin1Mark = await edit.eval(markOnPicture(0));
        result.steps.pin1 = { state: { noteIndex: state.noteIndex, noteBadge: state.noteBadge, noteTime: state.noteTime, noteTool: state.noteTool,
            memoFocused: state.memoFocused, marks: state.marks, elements: state.elements }, geometry, mark: pin1Mark,
            pending: pending.map(a => ({ tool: a.review.tool, text: a.review.text, shape: a.review.shape })) };
        check('3: ピンを打つと、その場に番号 1 のバッジ', state.marks.length === 1 && state.marks[0].text === '1'
            && Math.abs(pin1Mark.stageX - pin1.x) < 0.02 && Math.abs(pin1Mark.stageY - pin1.y) < 0.02, { marks: state.marks, at: pin1Mark });
        check('C-1: 付けた瞬間に印ができる（メモは空のまま pending.json に 1 件）',
            pending.length === 1 && pending[0].review.tool === 'pin' && pending[0].review.text === '', pending.map(a => a.review.text));
        check('3: 置き場に入力が開き、フォーカスが入力にある', state.noteOpen && state.dockOpen && state.memoFocused && state.noteIndex === 0 && !state.trayOpen,
            { noteOpen: state.noteOpen, memoFocused: state.memoFocused, noteIndex: state.noteIndex });
        check('3: 入力の領域はステージと重ならない（交差 0）・ステージの中に入力の箱が無い',
            geometry.noteStageOverlap === 0 && geometry.dockStageOverlap === 0 && geometry.noteInStage === false && geometry.noteInDock === true,
            { noteStageOverlap: geometry.noteStageOverlap, dockStageOverlap: geometry.dockStageOverlap, note: geometry.note, stage: geometry.stage });
        check('B-1: 置き場は 2 行目のすぐ下・通常の流れ（absolute で重ねない）', Math.abs(geometry.dockBelowToolbar) <= 0.5
            && geometry.dockPosition !== 'absolute' && geometry.dockPosition !== 'fixed', { below: geometry.dockBelowToolbar, position: geometry.dockPosition });
        check('B-3 / B-6: 置き場の高さは上限 min(40vh, 220px) 以内・上下の padding 4〜6px',
            geometry.dock.height <= geometry.limit + 0.5 && geometry.dockPadding.every(v => parseFloat(v) >= 4 && parseFloat(v) <= 6),
            { height: geometry.dock.height, limit: geometry.limit, padding: geometry.dockPadding, maxHeight: geometry.dockMaxHeight });
        check('B-4: 置き場の中央の elementFromPoint が置き場の中の要素', geometry.centerInsideDock, geometry.centerElement);
        check('C-2: 入力の頭に番号 1・道具・時刻', state.noteBadge === '1' && state.noteTool === 'pin' && state.noteTime === '0:03',
            { badge: state.noteBadge, tool: state.noteTool, time: state.noteTime });
        check('C-2: 「ここにあるもの」はチップで出る（映像のクリップ。「この時刻のコマ」の文は出さない）',
            state.elements.some(e => e.startsWith('映像')) && !String(state.elementsText).includes('この時刻のコマ'), state.elements);

        // 10: 入力の中のキーが外へ漏れない（スペース・←・1・⌘Z）。
        // webview の keydown は host へ転送され（Theia が合成した keydown を webview の要素へ送る）、host のキーバインドが動く。
        // host の document で合成された keydown（isTrusted = false）を数えて、転送そのものが無いことも確かめる
        await evalOn(main, `(() => { window.__l1HostKeys = [];
          if (!window.__l1HostKeyHook) { window.__l1HostKeyHook = true;
            document.addEventListener('keydown', event => { if (!event.isTrusted) window.__l1HostKeys.push((event.metaKey ? 'Meta+' : '') + event.key); }, true); }
          return true; })()`);
        const before = await edit.eval(STATE);
        await pressKey(' ', 'Space', 32, { text: ' ' });
        await pressKey('ArrowLeft', 'ArrowLeft', 37);
        await pressKey('1', 'Digit1', 49, { text: '1' });
        await pressKey('z', 'KeyZ', 90, { modifiers: 4 });
        await sleep(900);
        const after = await edit.eval(STATE);
        const hostKeys = await evalOn(main, 'window.__l1HostKeys.slice()');
        result.steps.keyLeak = { before: { seek: before.seek, play: before.playLabel, tool: before.activeTool, memo: before.memoValue },
            after: { seek: after.seek, play: after.playLabel, tool: after.activeTool, memo: after.memoValue, memoFocused: after.memoFocused },
            hostKeysFromMemo: hostKeys };
        check('10: 入力の中のスペース・←・1 で、再生が始まらない・コマが動かない・道具が変わらない（文字は入力に入る）',
            after.memoValue === '1 ' && after.seek === before.seek && after.playLabel === before.playLabel
            && after.activeTool === 'pin' && after.memoFocused && after.noteOpen,
            result.steps.keyLeak);
        check('C-8: 入力の中のキー（スペース・←・1・⌘Z）が host のキーバインドへ転送されない', hostKeys.length === 0, hostKeys);
        await edit.eval(`(() => { const memo = document.querySelector('[data-review-memo]'); memo.value = '';
          memo.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

        // 4: 続けて 2 個目・3 個目（入力が開いたまま、道具は外れない）
        const pin2 = { x: 0.6, y: 0.3 }; const pin3 = { x: 0.75, y: 0.6 };
        await clickStage(edit, pin2);
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 1 && s.marks.length === 2', 'pin 2 note');
        const toolAfter2 = state.activeTool;
        await clickStage(edit, pin3);
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 2 && s.marks.length === 3', 'pin 3 note');
        pending = await waitPending(list => list.length === 3, 'three pins');
        check('4: 道具が外れず、2 個目・3 個目を続けて打てる（バッジ 1・2・3）',
            toolAfter2 === 'pin' && state.activeTool === 'pin' && state.marks.map(m => m.text).join() === '1,2,3' && state.memoFocused,
            { tool: state.activeTool, marks: state.marks.map(m => m.text), noteIndex: state.noteIndex });
        check('4: pending.json に 3 件（メモが空のものを含む）', pending.length === 3 && pending.every(a => a.review.tool === 'pin' && a.review.text === ''),
            pending.map(a => ({ tool: a.review.tool, text: a.review.text })));
        check('A-5: 添付のボタンが件数つきで出る（文字は数字だけ・title に名前）',
            state.countHidden === false && state.countText === '3' && state.countTitle === '添付 3 件', { text: state.countText, title: state.countTitle });

        // 5: バッジ 1 を押す → 1 番の入力へ。Shift+Enter = 改行 / Enter = 保存して閉じる
        await clickBadge(edit, 0);
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 0', 'badge 1 note');
        await sleep(700);
        pending = await pendingList();
        check('5: バッジ 1 を押すと入力が 1 番に切り替わり、印は増えない（3 件のまま）',
            state.noteIndex === 0 && state.noteBadge === '1' && state.memoFocused && pending.length === 3 && state.marks.length === 3,
            { noteIndex: state.noteIndex, pending: pending.length, marks: state.marks.length });
        await typeMemo(edit, MEMO_PIN_1A);
        await pressEnter(SHIFT);
        state = await edit.eval(STATE);
        check('C-5: Shift+Enter は改行（保存して閉じない）', state.noteOpen && state.memoValue === `${MEMO_PIN_1A}\n`, { memo: state.memoValue, noteOpen: state.noteOpen });
        // 日本語入力の変換を確定する Enter では保存しない
        await main.send('Input.imeSetComposition', { text: 'あかるく', selectionStart: 4, selectionEnd: 4 });
        await sleep(150);
        await pressKey('Enter', 'Enter', 13);
        await sleep(600);
        state = await edit.eval(STATE);
        const duringComposition = { noteOpen: state.noteOpen, pendingText: (await pendingList())[0]?.review.text };
        await main.send('Input.insertText', { text: MEMO_PIN_1B });
        await sleep(200);
        state = await edit.eval(STATE);
        result.steps.composition = { duringComposition, memoAfterCommit: state.memoValue };
        check('C-5: 変換中の Enter では保存しない（入力は開いたまま・pending は空のまま）',
            duringComposition.noteOpen === true && duringComposition.pendingText === '' && state.memoValue === `${MEMO_PIN_1A}\n${MEMO_PIN_1B}`,
            result.steps.composition);
        await pressEnter();
        pending = await waitPending(list => list[0]?.review.text === `${MEMO_PIN_1A}\n${MEMO_PIN_1B}`, 'memo 1 saved');
        state = await waitState(edit, '!s.noteOpen && !s.dockOpen', 'note closed by Enter');
        check('5: 文字を打って Enter → pending.json の 1 件目のメモが変わる・件数は 3 のまま・入力は閉じる',
            pending.length === 3 && pending[1].review.text === '' && pending[2].review.text === '' && state.dockHeight === 0,
            pending.map(a => a.review.text));
        check('C-3: 保存のあとも道具は選んだまま', state.activeTool === 'pin', state.activeTool);

        // 9: Esc の順番。付けたばかりで空の印は消える / メモのある印は残る / 前からある空の印は残る
        await clickStage(edit, { x: 0.5, y: 0.8 });
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 3 && s.marks.length === 4', 'pin 4 note');
        await waitPending(list => list.length === 4, 'pin 4 saved');
        await pressEscape();
        pending = await waitPending(list => list.length === 3, 'fresh empty mark removed by Esc');
        state = await waitState(edit, '!s.noteOpen && s.marks.length === 3', 'note closed by Esc');
        check('9: Esc 1 回目 = 入力を閉じる。付けたばかりで空の印は消える（道具は残る）',
            pending.length === 3 && state.activeTool === 'pin' && !state.noteOpen, { pending: pending.length, tool: state.activeTool });
        await clickBadge(edit, 0);
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 0', 'badge 1 note again');
        check('C-4: 番号を押すと、保存したメモが入力に入っている', state.memoValue === `${MEMO_PIN_1A}\n${MEMO_PIN_1B}`, state.memoValue);
        await pressEscape();
        state = await waitState(edit, '!s.noteOpen', 'note closed by Esc (kept)');
        await sleep(600);
        pending = await pendingList();
        check('9: メモのある印は Esc で残る', pending.length === 3 && pending[0].review.text === `${MEMO_PIN_1A}\n${MEMO_PIN_1B}` && state.activeTool === 'pin',
            pending.map(a => a.review.text));
        await clickBadge(edit, 1);
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 1', 'badge 2 note');
        await pressEscape();
        state = await waitState(edit, '!s.noteOpen', 'note closed by Esc (older empty)');
        await sleep(600);
        pending = await pendingList();
        check('C-3: 前からある空の印は Esc で消えない（あとで書ける）', pending.length === 3 && pending[1].review.text === '', pending.map(a => a.review.text));
        await pressEscape();
        state = await edit.eval(STATE);
        check('9: Esc 2 回目 = 道具を外す', state.activeTool === null && !state.noteOpen, state.activeTool);
        await evalOn(main, '(() => { window.__l1HostKeys = []; return true; })()');
        await pressKey('Shift', 'ShiftLeft', 16);
        await sleep(400);
        const controlKeys = await evalOn(main, 'window.__l1HostKeys.slice()');
        result.steps.keyLeak.hostKeysOutsideMemo = controlKeys;
        check('C-8 の対照: 入力の外で押したキーは host へ転送される（数え方が効いている）', controlKeys.includes('Shift'), controlKeys);

        // 番号を押した直後の最初のクリックが効く（バッジを押したときに握りつぶすクリックが次の操作へ残らない）
        await clickBadge(edit, 1);
        await waitState(edit, 's.noteOpen && s.noteIndex === 1', 'badge 2 note for done');
        await edit.click('[data-review-done]');
        state = await waitState(edit, '!s.noteOpen', 'done right after badge', 4000).catch(() => null);
        check('C-4: 番号を押した直後の「完了」が 1 回で効く', Boolean(state));
        if (!state) { await edit.click('[data-review-done]'); await waitState(edit, '!s.noteOpen', 'done second click'); }

        // 変換中の Esc は変換の取り消しだけ（入力を閉じない・打ちかけを保存しない）
        await clickBadge(edit, 1);
        await waitState(edit, 's.noteOpen && s.noteIndex === 1 && s.memoFocused', 'badge 2 note for IME Esc');
        await main.send('Input.imeSetComposition', { text: 'てすと', selectionStart: 3, selectionEnd: 3 });
        await sleep(150);
        await pressEscape();
        await sleep(600);
        state = await edit.eval(STATE);
        const escComposition = { noteOpen: state.noteOpen, pendingText: (await pendingList())[1]?.review.text };
        await main.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
        await sleep(200);
        result.steps.escComposition = escComposition;
        check('C-7 補: 変換中の Esc では入力を閉じない（打ちかけを保存しない）', escComposition.noteOpen === true && escComposition.pendingText === '', escComposition);
        if ((await edit.eval(STATE)).noteOpen) {
            await edit.eval(`(() => { const memo = document.querySelector('[data-review-memo]'); memo.value = '';
              memo.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
            await pressEscape();
            await waitState(edit, '!s.noteOpen', 'note closed after IME Esc');
        }
        if ((await pendingList())[1]?.review.text !== '') {
            await clickUntil(edit, '[data-review-marks] [data-review-badge="1"]', 's.noteOpen && s.noteIndex === 1', 'reopen mark 2 to clear');
            await edit.eval(`(() => { const memo = document.querySelector('[data-review-memo]'); memo.value = '';
              memo.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
            await pressEnter();
            await waitState(edit, '!s.noteOpen', 'mark 2 cleared');
        }
        await waitPending(list => list.length === 3 && list[1].review.text === '', 'mark 2 stays empty', 8000);

        // フォーカスが外れたら保存（入力は道具なしでも番号から開ける）
        await clickBadge(edit, 2);
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 2', 'badge 3 note without tool');
        await sleep(500);
        check('C-4: 道具を選んでいなくても番号から入力を開ける・印は増えない', (await pendingList()).length === 3 && state.noteBadge === '3');
        await typeMemo(edit, 'ロゴを小さく');
        await clickToolbarBlank(edit);
        pending = await waitPending(list => list[2]?.review.text === 'ロゴを小さく', 'memo 3 saved on blur');
        check('C-5: 入力からフォーカスが外れたら保存する', pending.length === 3, pending.map(a => a.review.text));
        state = await edit.eval(STATE);
        if (state.noteOpen) { await edit.click('[data-review-done]'); await waitState(edit, '!s.noteOpen', 'done after blur'); }
        check('レビュー操作で edit.json / captions.json が書き換わらない（ポインタ・キーが既存の操作へ漏れない）',
            (await readFile(path.join(workspaceDir, 'edit.json'), 'utf8')) === originalEdit
            && (await readFile(path.join(workspaceDir, 'captions.json'), 'utf8')) === originalCaptions);
    }

    // ===== pen: 囲む → 番号 + 置き場の入力（6） =====
    if (on('pen')) {
        await seekEdit(edit, 3);
        const baseCount = (await pendingList()).length;
        await edit.click('[data-review-tool="pen"]');
        await sleep(200);
        const lineBox = await edit.eval(`(() => { const plate = Array.from(document.querySelectorAll('#caption-plate .caption-row-plate'))
          .find(e => e.textContent.includes(${JSON.stringify(CAPTION_TEXT)}));
          const line = plate?.querySelector('.akari-caption__line'); if (!line) return null;
          const b = line.getBoundingClientRect(); const s = document.getElementById('preview-stage').getBoundingClientRect();
          return { x: (b.left + b.width / 2 - s.left) / s.width, y: (b.top + b.height / 2 - s.top) / s.height, w: b.width / s.width, h: b.height / s.height }; })()`);
        const target = lineBox ?? plate;
        const rx = Math.min(0.45, target.w / 2 + 0.04); const ry = Math.min(0.2, target.h / 2 + 0.05);
        const circle = [{ x: target.x + rx, y: target.y }];
        for (let i = 1; i <= 24; i += 1) {
            const a = (i / 24) * Math.PI * 2;
            circle.push({ x: target.x + rx * Math.cos(a), y: target.y + ry * Math.sin(a) });
        }
        await drawPen(edit, circle);
        state = await waitState(edit, `s.noteOpen && s.noteIndex === ${baseCount}`, 'pen note');
        let pending = await waitPending(list => list.length === baseCount + 1, 'pen saved');
        const geometry = await edit.eval(DOCK_GEOMETRY);
        const penMark = await edit.eval(markOnPicture(baseCount));
        const savedPen = pending[baseCount].review.shape;
        result.steps.pen = { elements: state.elements, noteBadge: state.noteBadge, noteTool: state.noteTool, geometry: { noteStageOverlap: geometry.noteStageOverlap,
            noteInStage: geometry.noteInStage }, mark: penMark, shape: savedPen };
        check('6: ペンで囲むと番号のバッジ + 置き場に入力（囲んだ場所には出ない）',
            state.marks.some(m => m.index === baseCount && m.tool === 'pen' && m.text === String(baseCount + 1))
            && state.memoFocused && state.noteBadge === String(baseCount + 1) && state.noteTool === 'pen'
            && geometry.noteStageOverlap === 0 && geometry.noteInStage === false && pending[baseCount].review.text === '',
            { marks: state.marks, badge: state.noteBadge, overlap: geometry.noteStageOverlap });
        check('E: ペンの「ここにあるもの」にテロップの文字（CSS などが混ざらない）',
            state.elements.includes(`テロップ「${CAPTION_TEXT}」`) && state.elements.every(e => !/[{};]/.test(e) && e.length <= 100), state.elements);
        check('E: 保存した丸は描いた位置に出る（中心のずれ 3% 以内）', penMark && savedPen
            && Math.abs(penMark.stageX - (savedPen.x + savedPen.w / 2)) < 0.03 && Math.abs(penMark.stageY - (savedPen.y + savedPen.h / 2)) < 0.03,
            { mark: penMark && { x: penMark.stageX, y: penMark.stageY }, shape: savedPen });
        await typeMemo(edit, MEMO_PEN);
        const doneButton = await edit.eval(`(() => { const d = document.querySelector('[data-review-done]'); const x = document.querySelector('[data-review-delete]');
          const note = document.querySelector('[data-review-note]');
          return { done: d && { title: d.title, aria: d.getAttribute('aria-label'), text: d.textContent.trim(), svg: d.querySelectorAll('svg').length },
            del: x && { title: x.title, aria: x.getAttribute('aria-label'), text: x.textContent.trim(), svg: x.querySelectorAll('svg').length },
            oldButtons: note.querySelectorAll('[data-review-later],[data-review-add]').length,
            buttonTexts: Array.from(note.querySelectorAll('button')).map(b => b.textContent.trim()) }; })()`);
        check('C-6: 入力の右端はアイコンのボタン 2 つ（削除 / 完了）。「あとで」「追加」は無い',
            doneButton.done?.title === '完了' && doneButton.done.aria === '完了' && doneButton.done.text === '' && doneButton.done.svg === 1
            && doneButton.del?.title === '削除' && doneButton.del.aria === '削除' && doneButton.del.text === '' && doneButton.del.svg === 1
            && doneButton.oldButtons === 0 && doneButton.buttonTexts.every(text => text === ''), doneButton);
        const noteRow = await edit.eval(`(() => { const H = ${H}; const r = s => H.rectOf(H.q(s));
          const memo = r('[data-review-memo]'); const done = r('[data-review-done]'); const del = r('[data-review-delete]');
          const badge = r('[data-review-note-badge]'); const time = r('[data-review-note-time]'); const note = r('[data-review-note]');
          const chips = r('[data-review-elements]');
          const sameRow = (a, b) => Boolean(a && b) && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
          return { memo, done, del, badge, time, chips, noteHeight: note?.height ?? null,
            headOnMemoRow: sameRow(badge, memo) && sameRow(time, memo) && badge.right <= memo.left + 1 && time.right <= memo.left + 1,
            buttonsOnMemoRow: sameRow(done, memo) && sameRow(del, memo) && del.left >= memo.right - 1 && done.left >= del.right - 1,
            memoWidth: memo?.width ?? null, dockWidth: H.rectOf(H.q('#review-dock'))?.width ?? null }; })()`);
        result.steps.noteRow = noteRow;
        check('C-2 / C-6 / B-6: 入力は 1 行（頭に番号・道具・時刻 → 入力 → 右端に削除・完了）で、箱の高さが詰まっている',
            noteRow.headOnMemoRow && noteRow.buttonsOnMemoRow && noteRow.noteHeight <= 72 && noteRow.memoWidth >= noteRow.dockWidth * 0.4,
            { head: noteRow.headOnMemoRow, buttons: noteRow.buttonsOnMemoRow, noteHeight: noteRow.noteHeight, memoWidth: noteRow.memoWidth, dockWidth: noteRow.dockWidth });
        await edit.click('[data-review-done]');
        pending = await waitPending(list => list[baseCount]?.review.text === MEMO_PEN, 'pen memo saved');
        state = await waitState(edit, '!s.noteOpen', 'pen note closed');
        check('C-6: チェックで保存して閉じる（道具は選んだまま）', state.activeTool === 'pen' && pending.length === baseCount + 1, pending.map(a => a.review.text));

        // ゴミ箱: その印を消す
        await clickStage(edit, { x: 0.15, y: 0.15 });
        state = await waitState(edit, `s.noteOpen && s.noteIndex === ${baseCount + 1}`, 'pen click note');
        await waitPending(list => list.length === baseCount + 2, 'pen click saved');
        await typeMemo(edit, '消す印');
        await edit.click('[data-review-delete]');
        pending = await waitPending(list => list.length === baseCount + 1, 'deleted by trash');
        state = await waitState(edit, `!s.noteOpen && s.marks.length === ${baseCount + 1}`, 'note closed by trash');
        check('C-6: ゴミ箱でその印を消す（ほかの印とメモは残る）', pending[baseCount].review.text === MEMO_PEN && !pending.some(a => a.review.text === '消す印'),
            pending.map(a => a.review.text));
        await pressEscape();
        state = await edit.eval(STATE);
        check('道具だけのとき Esc で道具を外す（ペン）', state.activeTool === null);
    }

    // ===== range: 範囲 → 印・時刻・薄い印 =====
    if (on('range')) {
        await seekEdit(edit, 3);
        const baseCount = (await pendingList()).length;
        await edit.click('[data-review-tool="range"]');
        await edit.click('[data-review-range-start]');
        await seekEdit(edit, 5);
        await edit.click('[data-review-range-end]');
        state = await waitState(edit, `s.noteOpen && s.noteIndex === ${baseCount}`, 'range note');
        let pending = await waitPending(list => list.length === baseCount + 1, 'range saved');
        check('範囲を決めると印ができ、入力の頭に 0:03〜0:05', pending[baseCount].review.tool === 'range' && pending[baseCount].review.text === ''
            && pending[baseCount].review.timeEnd > pending[baseCount].review.time && state.noteTime === '0:03〜0:05' && state.noteTool === 'range' && state.memoFocused,
            { time: state.noteTime, review: { time: pending[baseCount].review.time, timeEnd: pending[baseCount].review.timeEnd } });
        check('範囲を決めた直後に再生位置が動かない（終了の 5 秒のまま）', Math.abs(state.seek - 5) < 0.2, { seek: state.seek });
        await typeMemo(edit, MEMO_RANGE);
        await pressEnter();
        pending = await waitPending(list => list[baseCount]?.review.text === MEMO_RANGE, 'range memo saved');
        state = await waitState(edit, '!s.noteOpen', 'range note closed');
        await pressEscape();
        await seekEdit(edit, 8);
        state = await edit.eval(STATE);
        const sourceMarks = pending.filter(a => a.review.source === 'edit.json').length;
        check('E: シークバーの点は印の数だけ', state.seekDots === sourceMarks, { dots: state.seekDots, marks: sourceMarks });
        const faded = state.marks.filter(m => Number(m.opacity) < 1);
        check('E / C-4: 時刻が離れた印は薄く、押せない（pointer-events: none）',
            faded.length >= 1 && faded.every(m => m.pointerEvents === 'none'), state.marks);
        if (faded.length) {
            await clickBadge(edit, faded[0].index, { force: true });
            await sleep(700);
            state = await edit.eval(STATE);
            check('C-4: 薄いバッジを押しても入力は開かず、印も増えない', !state.noteOpen && (await pendingList()).length === pending.length);
            // 薄いバッジは素通しなので、下の絵の要素が選ばれる（今までどおり）。あとの画像のために選択を外しておく
            const box = await edit.rect('#preview-stage');
            const blank = edit.toMain({ x: Math.max(8, box.left / 2), y: box.top + box.height / 2 });
            await mouseClick(blank.x, blank.y);
            await sleep(400);
        }
        await seekEdit(edit, 3);
        state = await edit.eval(STATE);
        check('C-4: 今の時刻に近い印は濃く、押せる（pointer-events: auto）',
            state.marks.filter(m => Number(m.opacity) === 1).length >= 1 && state.marks.filter(m => Number(m.opacity) === 1).every(m => m.pointerEvents === 'auto'),
            state.marks);
    }

    // ===== tray: 添付の一覧（7・8） =====
    if (on('tray')) {
        await seekEdit(edit, 3);
        let pending = await pendingList();
        const total = pending.length;
        state = await edit.eval(STATE);
        const samplerStart = state.sampler;
        await edit.click('[data-review-attach-count]');
        state = await waitState(edit, 's.trayOpen', 'tray open');
        let geometry = await edit.eval(DOCK_GEOMETRY);
        const trayLook = await edit.eval(`(() => { const tray = document.getElementById('review-chat-tray');
          const actions = tray.querySelector('.review-tray-actions'); const send = tray.querySelector('[data-review-send]');
          const a = actions?.getBoundingClientRect(); const s = send?.getBoundingClientRect();
          return { heading: tray.querySelectorAll('.review-tray-heading,[data-review-tray-count]').length,
            later: tray.querySelectorAll('[data-review-tray-later]').length,
            buttons: Array.from(tray.querySelectorAll('button')).map(b => b.textContent.trim() || b.getAttribute('aria-label')),
            sendRightAligned: Boolean(a && s) && Math.abs(a.right - s.right) < 14,
            rowHeights: Array.from(tray.querySelectorAll('[data-review-row]')).map(r => r.getBoundingClientRect().height) }; })()`);
        result.steps.tray = { rows: state.rows, geometry: { dock: geometry.dock, trayStageOverlap: geometry.trayStageOverlap, center: geometry.centerElement,
            scroll: geometry.dockScroll, limit: geometry.limit }, look: trayLook, send: state.sendText };
        check('7: 添付のボタン → 置き場に一覧。入力は閉じている', state.trayOpen && !state.noteOpen && state.rows.length === total && geometry.trayInDock,
            { rows: state.rows.length, noteOpen: state.noteOpen });
        check('7: 一覧の中央の elementFromPoint が一覧（置き場）の中の要素', geometry.centerInsideDock, geometry.centerElement);
        check('7: 一覧の領域はステージと重ならない', geometry.trayStageOverlap === 0 && geometry.dockStageOverlap === 0,
            { tray: geometry.tray, stage: geometry.stage });
        check('B-3: 一覧が長くても置き場は上限 min(40vh, 220px) 以内（超えるぶんは中でスクロール）',
            geometry.dock.height <= geometry.limit + 0.5 && (geometry.dockScroll.scrollHeight <= geometry.dockScroll.clientHeight + 1
                || /auto|scroll/.test(geometry.dockScroll.overflowY)), { height: geometry.dock.height, limit: geometry.limit, scroll: geometry.dockScroll });
        check('D-2: 行は 番号 / コマの絵（高さ 36px ほど）/ 時刻・道具・メモ / ×',
            state.rows.every((row, index) => row.badge === String(index + 1))
            && state.rows.filter(row => row.thumb).length >= 1
            && state.rows.every(row => !row.thumb || (row.thumb.prefix === 'data:image/jpeg;base64,' && row.thumb.width <= 160
                && row.thumb.shownHeight >= 30 && row.thumb.shownHeight <= 42)),
            state.rows.map(row => ({ badge: row.badge, text: row.text, thumb: row.thumb })));
        check('C-10: メモが空の印は「メモなし」と出る', pending.some(a => a.review.text === '')
            && pending.every((a, index) => a.review.text !== '' || state.rows[index].text.includes('メモなし')),
            state.rows.map(row => row.text));
        check('D-3: 見出しと「あとで」は無い。下に右寄せで渡すボタン 1 つ（文字のまま）',
            trayLook.heading === 0 && trayLook.later === 0 && trayLook.sendRightAligned && state.sendText === 'クリップボードにコピー', trayLook);
        await edit.click('[data-review-attach-count]');
        state = await waitState(edit, '!s.trayOpen && !s.dockOpen', 'tray closed by button');
        check('7: もう一度押すと閉じる（置き場の高さ 0）', state.dockHeight === 0);

        // 8: 入力 ⇄ 一覧の切り替え。同時に見えている瞬間が無い
        await edit.click('[data-review-attach-count]');
        await waitState(edit, 's.trayOpen', 'tray open again');
        const rowText = pending[2].review.text;
        await revealRow(edit, 2);
        await edit.click('[data-review-row="2"] .review-row-text');
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 2', 'row → note');
        check('C-4 / D-2: 一覧の行を押すとその印の入力に切り替わる（一覧は閉じる・保存したメモが入っている）',
            !state.trayOpen && state.noteBadge === '3' && state.memoFocused && state.memoValue === rowText,
            { trayOpen: state.trayOpen, badge: state.noteBadge, memo: state.memoValue });
        await typeMemo(edit, '（一覧から）');
        await edit.click('[data-review-attach-count]');
        state = await waitState(edit, 's.trayOpen && !s.noteOpen', 'note → tray');
        pending = await waitPending(list => list[2]?.review.text === `${rowText}（一覧から）`, 'memo saved when tray opens');
        check('D-1: 入力が開いているときに添付を押すと、保存して閉じてから一覧が開く', state.rows[2].text.includes(`${rowText}（一覧から）`), state.rows[2].text);
        await pressEscape();
        state = await waitState(edit, '!s.trayOpen', 'tray closed by Esc');
        check('9: 一覧が開いていれば Esc で一覧を閉じる', !state.dockOpen);
        check('8: 入力と一覧が同時に見えている瞬間が無い（hidden の書き換えと描画のたびに確かめた）',
            state.sampler.both === 0 && state.sampler.frames > samplerStart.frames + 10 && state.sampler.mutations > samplerStart.mutations,
            { start: samplerStart, end: state.sampler });

        // 行から直す（時刻が離れている印は、その時刻へシークしてから開く）
        await seekEdit(edit, 8);
        await edit.click('[data-review-attach-count]');
        await waitState(edit, 's.trayOpen', 'tray open at 8s');
        await revealRow(edit, 0);
        await edit.click('[data-review-row="0"] .review-row-text');
        state = await waitState(edit, 's.noteOpen && s.noteIndex === 0 && Math.abs(s.seek - 3) < 0.3', 'row → seek + note', 20000);
        check('C-4: 時刻が離れている印は、その時刻へシークしてから入力が開く', Math.abs(state.seek - 3) < 0.3 && state.memoFocused, { seek: state.seek });
        await pressEscape();
        await waitState(edit, '!s.noteOpen', 'note closed');

        // × で外す
        await edit.click('[data-review-attach-count]');
        await waitState(edit, 's.trayOpen', 'tray open for remove');
        result.steps.trayRemoveReveal = (await revealRow(edit, total - 1)).scroller;
        await edit.click(`[data-review-remove="${total - 1}"]`);
        state = await waitState(edit, `s.rows.length === ${total - 1}`, 'remove one');
        pending = await waitPending(list => list.length === total - 1, 'removed in pending');
        check('D-2: × で 1 件外れ、pending.json も減る（一覧は開いたまま）', state.trayOpen && state.count === total - 1, pending.map(a => a.review.tool));
        await edit.click('[data-review-attach-count]');
        await waitState(edit, '!s.trayOpen', 'tray closed');
    }

    // ===== geometry: 置き場の開閉・窓の大きさで、印が絵の同じ場所にある（11） =====
    if (on('geometry')) {
        await seekEdit(edit, 3);
        const closed = await edit.eval(markOnPicture(0));
        await edit.click('[data-review-attach-count]');
        await waitState(edit, 's.trayOpen', 'tray open for geometry');
        await sleep(500);
        const open = await edit.eval(markOnPicture(0));
        const openGeometry = await edit.eval(DOCK_GEOMETRY);
        await edit.click('[data-review-attach-count]');
        await waitState(edit, '!s.trayOpen', 'tray closed for geometry');
        await evalOn(main, '(() => { window.resizeTo(1280, 860); return true; })()');
        await sleep(1500);
        const resized = await edit.eval(markOnPicture(0));
        await evalOn(main, '(() => { window.resizeTo(1600, 1100); return true; })()');
        await sleep(1500);
        edit.calibration = undefined;
        await edit.calibrate();
        const delta = (a, b) => a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : null;
        result.steps.geometry = { closed, open, resized, dockHeightOpen: openGeometry.dock?.height,
            deltaOpen: delta(closed, open), deltaResized: delta(closed, resized) };
        check('11: 置き場を開く前と後で、番号 1 のバッジの中心が絵の同じ場所にある（差 0.5% 以内）',
            delta(closed, open) !== null && delta(closed, open) <= 0.005 && open.pictureSize.h < closed.pictureSize.h,
            { closed: { x: closed?.x, y: closed?.y, picture: closed?.pictureSize }, open: { x: open?.x, y: open?.y, picture: open?.pictureSize },
                delta: delta(closed, open), dockHeight: openGeometry.dock?.height });
        check('C-11: 窓の大きさを変えても同じ場所にある（差 0.5% 以内）', delta(closed, resized) !== null && delta(closed, resized) <= 0.005,
            { resized: { x: resized?.x, y: resized?.y, picture: resized?.pictureSize }, delta: delta(closed, resized) });
    }

    // ===== chrome: 置き場の開閉に、選んだ要素の枠が追従する =====
    if (on('chrome')) {
        await seekEdit(edit, 3);
        // 道具なしでステージを押すと、今までどおり絵の要素（映像のクリップ）が選ばれる
        await clickStage(edit, { x: 0.92, y: 0.45 });
        const FRAME = `(() => { const H = ${H};
          const frame = Array.from(document.querySelectorAll('.akari-interaction-selection-frame,#layer-select-box,#cut-select-box,#caption-select-box'))
            .filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden').map(H.rectOf).find(Boolean) ?? null;
          const stage = H.rectOf(H.q('#preview-stage'));
          return { frame, stage, diff: frame && stage ? Math.max(Math.abs(frame.left - stage.left), Math.abs(frame.top - stage.top),
            Math.abs(frame.right - stage.right), Math.abs(frame.bottom - stage.bottom)) : null }; })()`;
        let selected = await edit.waitFor(`(() => { const v = ${FRAME}; return v.frame ? v : null; })()`, 3000, 'selection frame').catch(() => null);
        if (!selected) {
            result.retries.push('select element on stage');
            await clickStage(edit, { x: 0.92, y: 0.45 });
            selected = await edit.waitFor(`(() => { const v = ${FRAME}; return v.frame ? v : null; })()`, 8000, 'selection frame (retry)').catch(() => null);
        }
        check('E: 道具を選んでいないときのステージのクリックは、今までどおり絵の要素を選ぶ', Boolean(selected) && selected.diff <= 3, selected && { diff: selected.diff });
        // 置き場を開閉した直後から 100ms ごとに、枠とステージのずれ（px）を測る
        const follow = async (label, action) => {
            await action();
            const samples = [];
            const started = Date.now();
            while (Date.now() - started < 2500) {
                const value = await edit.eval(FRAME);
                samples.push({ ms: Date.now() - started, diff: value.diff === null ? null : Math.round(value.diff * 10) / 10, stageH: Math.round(value.stage.height) });
                await sleep(100);
            }
            const settled = samples.find(sample => sample.diff !== null && sample.diff <= 3);
            const last = samples[samples.length - 1];
            return { label, settledMs: settled ? settled.ms : null, last, first: samples[0], worst: Math.max(...samples.map(sample => sample.diff ?? 0)) };
        };
        if (selected) {
            const runs = [];
            runs.push(await follow('一覧を開く', () => clickUntil(edit, '[data-review-attach-count]', 's.trayOpen', 'chrome tray open')));
            runs.push(await follow('一覧を閉じる', () => clickUntil(edit, '[data-review-attach-count]', '!s.trayOpen', 'chrome tray close')));
            runs.push(await follow('入力を開く', async () => { await clickBadge(edit, 0); await waitState(edit, 's.noteOpen', 'chrome note open'); }));
            runs.push(await follow('入力を閉じる', async () => { await pressEscape(); await waitState(edit, '!s.noteOpen', 'chrome note close'); }));
            runs.push(await follow('窓を小さくする（対照）', () => evalOn(main, '(() => { window.resizeTo(1280, 860); return true; })()')));
            runs.push(await follow('窓を戻す（対照）', () => evalOn(main, '(() => { window.resizeTo(1600, 1100); return true; })()')));
            edit.calibration = undefined;
            await edit.calibrate();
            result.steps.chromeFollow = runs;
            check('C-11 / B-1: 置き場の開閉に、選んだ要素の枠が追従する（1 秒以内にステージと 3px 以内）',
                runs.slice(0, 4).every(run => run.last.diff !== null && run.last.diff <= 3 && run.settledMs !== null && run.settledMs <= 1000), runs);
        }
        // 選択を外す（ステージの外の何も無いところを押す）
        const stage = await edit.rect('#preview-stage');
        const blank = edit.toMain({ x: Math.max(8, stage.left / 2), y: stage.top + stage.height / 2 });
        await mouseClick(blank.x, blank.y);
        await sleep(500);
        if ((await edit.eval(FRAME)).frame) { await pressEscape(); await sleep(400); }
        result.steps.chromeDeselected = !(await edit.eval(FRAME)).frame;
    }

    // ===== longlist: 一覧が長くても、渡すボタンが置き場の下端に見えている =====
    if (on('longlist')) {
        const WANT = 6;
        await seekEdit(edit, 3);
        let pending = await pendingList();
        const before = pending.length;
        // 足りないぶんをピンで足す（メモを入れて Enter。付けたばかりで空の印は Esc で消えるため）
        const spots = [{ x: 0.1, y: 0.45 }, { x: 0.9, y: 0.15 }, { x: 0.1, y: 0.15 }, { x: 0.9, y: 0.8 }, { x: 0.45, y: 0.12 }, { x: 0.1, y: 0.8 }];
        const memoOf = index => `${index + 1} 番の印`;
        if (before < WANT) {
            await clickUntil(edit, '[data-review-tool="pin"]', 's.activeTool === "pin"', 'longlist pin tool');
            for (let index = before; index < WANT; index += 1) {
                await clickStage(edit, spots[index]);
                await waitState(edit, `s.noteOpen && s.noteIndex === ${index}`, `longlist pin ${index + 1}`);
                await waitPending(list => list.length === index + 1, `longlist pin ${index + 1} saved`);
                await typeMemo(edit, memoOf(index));
                await pressEnter();
                await waitPending(list => list[index]?.review.text === memoOf(index), `longlist memo ${index + 1}`);
                await waitState(edit, '!s.noteOpen', `longlist note ${index + 1} closed`);
            }
            await pressEscape();
            await waitState(edit, 's.activeTool === null', 'longlist tool off');
        }
        pending = await waitPending(list => list.length >= WANT, 'longlist marks');
        await clickUntil(edit, '[data-review-attach-count]', 's.trayOpen', 'longlist tray open');
        await sleep(400);
        const atTop = await edit.eval(SEND_ROW);
        const lastText = pending[pending.length - 1].review.text;
        check(`r1: 印 ${WANT} 件の一覧を開くと、スクロール位置 0 のまま、渡すボタンの矩形が置き場の見えている矩形の内側に全部入っている`,
            atTop.count === pending.length && atTop.count >= WANT && (atTop.scroller?.scrollTop ?? 0) === 0 && atTop.sendInside && atTop.actionsInside,
            { count: atTop.count, send: atTop.send, visible: atTop.visible, actions: atTop.actions, scroller: atTop.scroller });
        check('r1: 渡すボタンの中央（と四隅）の elementFromPoint がそのボタン', atTop.sendHitAll, atTop.sendHits);
        check('r1 / B-3: 置き場の上限 min(40vh, 220px) は変わらず、スクロールするのは印の行だけ（ボタンの行はスクロールの外）',
            atTop.dock.height <= atTop.limit + 0.5 && atTop.scroller?.which === 'rows' && atTop.rowsUnderActions.length === 0,
            { height: atTop.dock.height, limit: atTop.limit, maxHeight: atTop.maxHeight, scroller: atTop.scroller, overflow: atTop.overflow,
                rowsUnderActions: atTop.rowsUnderActions });
        const scrolled = await scrollList(edit, true);
        const atBottom = scrolled.probe;
        const moved = Math.max(Math.abs(atBottom.send.top - atTop.send.top), Math.abs(atBottom.send.bottom - atTop.send.bottom),
            Math.abs(atBottom.actions.top - atTop.actions.top), Math.abs(atBottom.actions.bottom - atTop.actions.bottom));
        check('r1: 一覧をいちばん下までスクロールしても、渡すボタンは同じ位置にある（動き 0.5px 以内・全部見えていて押せる）',
            Boolean(atBottom.scroller) && atBottom.scroller.scrollTop >= atBottom.scroller.max - 0.5 && atBottom.scroller.scrollTop > 0
            && moved <= 0.5 && atBottom.sendInside && atBottom.sendHitAll && !scrolled.used.forced,
            { moved, scroller: atBottom.scroller, used: scrolled.used, sendTop: [atTop.send.top, atBottom.send.top] });
        check(`r1: いちばん下では最後の行（${pending.length} 番）がボタンの行に隠れず、全部読める`,
            atBottom.last.index === pending.length - 1 && atBottom.last.badge === String(pending.length) && atBottom.last.fullyShown
            && atBottom.last.aboveActions && atBottom.last.hit && atBottom.last.text.includes(lastText || 'メモなし') && atBottom.rowsUnderActions.length === 0,
            { last: atBottom.last, actionsTop: atBottom.actions.top, rowClip: atBottom.rowClip });
        check('r1: ボタンの行の地は置き場と同じ色で、行が透けない（いちばん上 / いちばん下）', sendRowSolid(atTop) && sendRowSolid(atBottom),
            { actionsBg: atTop.actionsBg, effectiveBg: atTop.effectiveBg, from: atTop.effectiveBgFrom, dockBg: atTop.dockBg,
                under: [atTop.rowsUnderActions, atBottom.rowsUnderActions], hits: [atTop.actionsHits, atBottom.actionsHits] });
        const back = await scrollList(edit, false);
        result.steps.longlist = { added: pending.length - before, atTop, atBottom, used: scrolled.used, moved, backToTop: back.probe.scroller, backUsed: back.used };
        // 渡すボタンは置き場の下端にある（下の padding のぶんだけ上）
        check('r1: 渡すボタンの行は置き場の下端にある（下の padding のぶんだけ内側）',
            Math.abs((atTop.visible.bottom - atTop.actions.bottom) - parseFloat(atTop.padding[1])) <= 0.5,
            { fromBottom: atTop.visible.bottom - atTop.actions.bottom, padding: atTop.padding });
        await edit.click('[data-review-attach-count]');
        state = await waitState(edit, '!s.trayOpen && !s.dockOpen', 'longlist tray closed');
        check('r1: 一覧を閉じると置き場の高さは 0 のまま', state.dockHeight === 0, { dockHeight: state.dockHeight });
        // メモの入力の側は変わらない（置き場の高さを残す）
        await clickBadge(edit, 0);
        await waitState(edit, 's.noteOpen && s.noteIndex === 0', 'longlist note');
        await sleep(300);
        const noteGeometry = await edit.eval(DOCK_GEOMETRY);
        const noteLook = await edit.eval(`(() => { const H = ${H}; const dock = H.q('#review-dock'); const note = H.q('[data-review-note]');
          return { dockDisplay: getComputedStyle(dock).display, noteHeight: note.getBoundingClientRect().height, noteWidth: note.getBoundingClientRect().width,
            dockWidth: dock.clientWidth, memo: H.rectOf(H.q('[data-review-memo]')), chips: H.rectOf(H.q('[data-review-elements]')) }; })()`);
        result.steps.longlist.note = { dock: noteGeometry.dock, note: noteGeometry.note, padding: noteGeometry.dockPadding, scroll: noteGeometry.dockScroll, look: noteLook };
        check('r1: メモの入力の側は変わらない（置き場の中に収まり、スクロールしない・幅いっぱい）',
            noteGeometry.noteStageOverlap === 0 && noteGeometry.dockScroll.scrollHeight <= noteGeometry.dockScroll.clientHeight + 1
            && Math.abs(noteLook.noteWidth - (noteLook.dockWidth - 20)) <= 1,
            { dockHeight: noteGeometry.dock.height, noteHeight: noteLook.noteHeight, noteWidth: noteLook.noteWidth, dockWidth: noteLook.dockWidth, memo: noteLook.memo });
        await pressEscape();
        await waitState(edit, '!s.noteOpen', 'longlist note closed');
    }

    // ===== themes: 明るい / 暗いテーマ（14） =====
    if (on('themes')) {
        await seekEdit(edit, 3);
        result.steps.themes = {};
        for (const theme of ['dark', 'light']) {
            const applied = await setTheme(theme, edit);
            await edit.click('[data-review-tool="pen"]');
            await sleep(300);
            const toolbarColors = await edit.eval(THEME_COLORS);
            await screenshot(`${theme}-1-toolbar`, edit);
            await pressEscape();
            await clickBadge(edit, 0);
            await waitState(edit, 's.noteOpen && s.noteIndex === 0', `${theme} note`);
            await sleep(300);
            const noteColors = await edit.eval(THEME_COLORS);
            await screenshot(`${theme}-2-note`, edit);
            await pressEscape();
            await waitState(edit, '!s.noteOpen', `${theme} note closed`);
            await clickUntil(edit, '[data-review-attach-count]', 's.trayOpen', `${theme} tray`);
            await sleep(300);
            const trayColors = await edit.eval(THEME_COLORS);
            await screenshot(`${theme}-3-tray`, edit);
            const sendTop = await edit.eval(SEND_ROW);
            const sendScrolled = await scrollList(edit, true);
            if (sendScrolled.probe.scroller) await screenshot(`${theme}-4-tray-bottom`, edit);
            await scrollList(edit, false);
            await edit.click('[data-review-attach-count]');
            await waitState(edit, '!s.trayOpen', `${theme} tray closed`);
            result.steps.themes[theme] = { applied, toolbar: toolbarColors, note: noteColors, tray: trayColors,
                sendRow: { top: sendTop, bottom: sendScrolled.probe, used: sendScrolled.used } };
            check(`r1: ${theme === 'dark' ? '暗い' : '明るい'}テーマで、渡すボタンが置き場の中に全部見え、ボタンの行の地が置き場と同じ色（行が透けない）`,
                sendTop.sendInside && sendTop.sendHitAll && sendScrolled.probe.sendInside && sendScrolled.probe.sendHitAll
                && sendRowSolid(sendTop) && sendRowSolid(sendScrolled.probe) && sendTop.dockBg === trayColors.dockBg,
                { count: sendTop.count, actionsBg: sendTop.actionsBg, effectiveBg: sendTop.effectiveBg, from: sendTop.effectiveBgFrom, dockBg: sendTop.dockBg,
                    under: [sendTop.rowsUnderActions, sendScrolled.probe.rowsUnderActions], scroller: sendScrolled.probe.scroller });
            check(`14 / B-5: ${theme === 'dark' ? '暗い' : '明るい'}テーマで 2 行目・入力・一覧が読める（文字と地のコントラスト 4.5 以上）`,
                toolbarColors.toolContrast >= 4.5 && toolbarColors.hintContrast >= 4.5 && noteColors.memoContrast >= 4.5 && trayColors.rowContrast >= 4.5,
                { body: toolbarColors.bodyClass, transportBg: toolbarColors.transportBg, dockBg: noteColors.dockBg, tool: toolbarColors.toolContrast,
                    hint: toolbarColors.hintContrast, memo: noteColors.memoContrast, row: trayColors.rowContrast });
        }
        const dark = result.steps.themes.dark; const light = result.steps.themes.light;
        check('B-5: 置き場の色はバーの変数に追従する（テーマで地の色が変わる）',
            dark.note.transportBg !== light.note.transportBg && dark.note.dockBg !== light.note.dockBg, { dark: dark.note.dockBg, light: light.note.dockBg });
        await setTheme('dark', edit);
    }

    // ===== restart: アプリを落として開き直す（13） =====
    if (on('restart')) {
        const beforeFile = await readFile(pendingPath, 'utf8');
        const beforeList = await pendingList();
        await shutdown();
        await sleep(1500);
        await launch();
        edit = await openEditPreview();
        state = await waitState(edit, `s.count === ${beforeList.length}`, 'restored count', 40000);
        await seekEdit(edit, 3);
        await edit.calibrate();
        state = await edit.eval(STATE);
        const afterFile = await readFile(pendingPath, 'utf8');
        await clickBadge(edit, 0);
        const reopened = await waitState(edit, 's.noteOpen && s.noteIndex === 0', 'restored note');
        check('13: アプリを落として開き直しても、印とメモが残る',
            afterFile === beforeFile && state.count === beforeList.length
            && state.marks.length === beforeList.filter(a => a.review.shape).length
            && reopened.memoValue === beforeList[0].review.text,
            { count: state.count, marks: state.marks.map(m => m.text), memo1: reopened.memoValue, texts: beforeList.map(a => a.review.text) });
        await pressEscape();
        await waitState(edit, '!s.noteOpen', 'restored note closed');
        await clickUntil(edit, '[data-review-tool="pin"]', 's.activeTool === "pin"', 'tool after restored note');
        await pressEscape();

        // これまでの形の pending.json（印に id が無い）もそのまま読めて、番号から直せる
        await shutdown();
        await sleep(1500);
        const legacy = { attachments: beforeList.map(item => { const { id, ...review } = item.review; return { ...item, review }; }) };
        await writeFile(pendingPath, `${JSON.stringify(legacy, null, 2)}\n`);
        await launch();
        edit = await openEditPreview();
        state = await waitState(edit, `s.count === ${beforeList.length}`, 'legacy count', 40000);
        await seekEdit(edit, 3);
        await edit.calibrate();
        await clickBadge(edit, 0);
        const legacyNote = await waitState(edit, 's.noteOpen && s.noteIndex === 0', 'legacy note');
        await typeMemo(edit, '！');
        await pressEnter();
        const legacyAfter = await waitPending(list => list[0]?.review.text === `${beforeList[0].review.text}！`, 'legacy memo saved');
        await waitState(edit, '!s.noteOpen', 'legacy note closed');
        result.steps.legacy = { hadIds: beforeList.every(item => typeof item.review.id === 'string'), texts: legacyAfter.map(a => a.review.text) };
        check('C-9: これまでの形の pending.json（id の無い印）もそのまま読めて、番号からメモを直せる（順番と件数は同じ）',
            legacyNote.memoValue === beforeList[0].review.text && legacyAfter.length === beforeList.length
            && legacyAfter.every((item, index) => item.review.tool === beforeList[index].review.tool && item.review.time === beforeList[index].review.time
                && (index === 0 || item.review.text === beforeList[index].review.text)),
            result.steps.legacy);
    }

    // ===== attach: 「クリップボードにコピー」で渡す中身（12） =====
    if (on('attach')) {
        const list = await pendingList();
        const clipboardBefore = spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout ?? '';
        try {
            await edit.click('[data-review-attach-count]');
            state = await waitState(edit, 's.trayOpen', 'tray open for attach');
            const label = state.sendText;
            await edit.click('[data-review-send]');
            await waitPending(after => after.length === 0, 'pending emptied by attach');
            state = await waitState(edit, 's.count === 0 && !s.trayOpen', 'emptied');
            await sleep(400);
            const text = spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout ?? '';
            const lines = text.split('\n').filter(Boolean);
            const emptyIndexes = list.map((a, index) => a.review.text === '' ? index : -1).filter(index => index >= 0);
            const toolName = { pen: 'ペン', pin: 'ピン', range: '範囲' };
            result.steps.attach = { button: label, clipboard: sanitizeText(text), marks: list.map(a => ({ tool: a.review.tool, time: a.review.time,
                timeEnd: a.review.timeEnd, text: a.review.text, elements: a.review.elements, thumbnail: Boolean(a.review.thumbnail) })) };
            check('12: 「クリップボードにコピー」で、印の数だけ行が渡る', lines.length === list.length && lines.every(line => line.startsWith('[レビュー] ')),
                { lines: lines.length, marks: list.length });
            check('12: メモが空の印も壊れずに入っている（時刻・道具・ここにあるもの の行）', emptyIndexes.length >= 1
                && emptyIndexes.every(index => lines[index].includes(` 0:0${Math.floor(list[index].review.time)} `) && lines[index].includes(toolName[list[index].review.tool])
                    && (list[index].review.elements ?? []).every(element => lines[index].includes(element)))
                && !/undefined|null|NaN/.test(text) && !/:\s*:/.test(text),
                emptyIndexes.map(index => sanitizeText(lines[index])));
            check('E: 渡したあと一覧と pending.json が空になり、添付のボタンが隠れる', state.countHidden === true && !state.dockOpen);
            const images = await readdir(path.join(workspaceDir, '.akari', 'review', 'attachments')).catch(() => []);
            check('E: コマの絵は .akari/review/attachments/ に保存され、行から参照される',
                images.length === list.filter(a => a.review.thumbnail).length && images.every(name => text.includes(`.akari/review/attachments/${name}`)),
                { images: images.length });
        } finally {
            spawnSync('pbcopy', [], { input: clipboardBefore });
        }
    }

    // ===== export: 書き出した動画のプレビュー（15） =====
    if (on('export')) {
        const baseCount = (await pendingList()).length;
        const raw = await openExportPreview();
        result.steps.rawProbe = sanitizeValue(await raw.eval(`({ kind: window.__akariPreview.kind, source: window.__akariPreview.reviewSource,
          label: window.__akariPreview.reviewSourceLabel })`));
        await raw.calibrate();
        await seekRaw(raw, 2);
        const rawLayout = await raw.eval(`(() => { const H = ${H}; const toolbar = H.q('.review-toolbar'); const controls = H.q('.transport-controls');
          const tools = Array.from(document.querySelectorAll('[data-review-tool]'));
          return { follows: toolbar?.previousElementSibling === controls, inToolbar: tools.length === 3 && tools.every(b => toolbar.contains(b)),
            inRight: H.q('.transport-right').querySelectorAll('[data-review-tool]').length, height: toolbar?.getBoundingClientRect().height,
            gap: toolbar ? toolbar.getBoundingClientRect().top - controls.getBoundingClientRect().bottom : null,
            dockHeight: H.q('#review-dock')?.getBoundingClientRect().height }; })()`);
        result.steps.rawLayout = rawLayout;
        check('15: 書き出した動画でも道具は 2 行目', rawLayout.follows && rawLayout.inToolbar && rawLayout.inRight === 0 && Math.abs(rawLayout.gap) <= 0.5
            && rawLayout.dockHeight === 0, rawLayout);
        await raw.click('[data-review-tool="pin"]');
        await sleep(200);
        await clickStage(raw, { x: 0.8, y: 0.2 });
        state = await waitState(raw, `s.noteOpen && s.noteIndex === ${baseCount}`, 'raw pin note');
        let pending = await waitPending(list => list.length === baseCount + 1, 'raw pin saved');
        const geometry = await raw.eval(DOCK_GEOMETRY);
        check('15: 書き出した動画でもピン → 番号のバッジ + 置き場の入力（ステージと重ならない）',
            state.marks.some(m => m.index === baseCount && m.text === String(baseCount + 1)) && state.memoFocused
            && geometry.noteStageOverlap === 0 && geometry.noteInStage === false && geometry.centerInsideDock
            && pending[baseCount].review.source === 'exports/draft-v1.mp4' && pending[baseCount].review.text === '',
            { marks: state.marks, overlap: geometry.noteStageOverlap, source: pending[baseCount].review.source });
        await screenshot('export-1-note', raw);
        await typeMemo(raw, 'ロゴを小さく');
        await pressEnter();
        pending = await waitPending(list => list[baseCount]?.review.text === 'ロゴを小さく', 'raw memo saved');
        state = await waitState(raw, '!s.noteOpen', 'raw note closed');
        check('15: 書き出した動画でも Enter で保存して閉じ、道具は選んだまま', state.activeTool === 'pin' && state.count === baseCount + 1);
        await raw.click('[data-review-tool="pen"]');
        await sleep(200);
        await drawPen(raw, [{ x: 0.62, y: 0.5 }, ...Array.from({ length: 20 }, (_, i) => {
            const a = ((i + 1) / 20) * Math.PI * 2; return { x: 0.5 + 0.12 * Math.cos(a), y: 0.5 + 0.15 * Math.sin(a) };
        })]);
        state = await waitState(raw, `s.noteOpen && s.noteIndex === ${baseCount + 1}`, 'raw pen note');
        await waitPending(list => list.length === baseCount + 2, 'raw pen saved');
        await pressEscape();
        pending = await waitPending(list => list.length === baseCount + 1, 'raw fresh pen removed by Esc');
        check('15: 書き出した動画でも、付けたばかりで空の印は Esc で消える', pending.every(a => a.review.source === 'exports/draft-v1.mp4' || a.review.source === 'edit.json'));
        await raw.click('[data-review-attach-count]');
        await waitState(raw, 's.trayOpen', 'raw tray');
        await screenshot('export-2-tray', raw);
        await sleep(300);
        const single = await raw.eval(SEND_ROW);
        result.steps.singleRowTray = single;
        if (single.count === 1) {
            check('r1: 印が 1 件のとき、行とボタンの行の間に余分な隙間ができない（置き場の高さは中身ちょうど・スクロールなし）',
                single.scroller === null && Math.abs(single.slack) <= 1 && single.gapLastRowToActions >= -0.5 && single.gapLastRowToActions <= 1
                && single.sendInside && single.sendHitAll,
                { dockHeight: single.dock.height, rowHeight: single.rows[0].height, actionsHeight: single.actions.height, padding: single.padding,
                    borderTop: single.borderTop, slack: single.slack, gap: single.gapLastRowToActions });
        }
    }

    check('クリックのやり直しが 0 回（押した 1 回目がすべて効いた）', result.retries.length === 0, result.retries);
    exitCode = result.checks.every(entry => entry.ok) ? 0 : 1;
} catch (error) {
    result.errors.push({ fatal: sanitizeText(error.stack || error.message) });
    console.error(sanitizeText(error.stack || error.message));
    await screenshot('99-failure').catch(() => undefined);
} finally {
    await shutdown().catch(() => undefined);
    if ((spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout ?? '') !== clipboardAtStart) {
        spawnSync('pbcopy', [], { input: clipboardAtStart });
        result.clipboardRestored = true;
    }
    result.pass = exitCode === 0;
    await writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(sanitizeValue(result), null, 2)}\n`);
    console.log(`checks: ${result.checks.filter(c => c.ok).length}/${result.checks.length} pass; screenshots: ${result.screenshots.length}`);
    if (!process.env.AKARI_L1_KEEP) await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(exitCode);
