#!/usr/bin/env node

// L1（実機 Electron + CDP + 実 DOM）: 「素材だけの状態でプレビューを開き、その後に
// captions.json を作ったとき、プレビューを開き直さずに字幕が描かれる」ことを実測する。
//
//   node evidence/preview-captions-plate-z/run-l1.mjs
//
// 環境変数:
//   AKARI_L1_OUT        出力先（既定: evidence/preview-captions-plate-z/l1）
//   AKARI_L1_LABEL      result.json / PNG の接頭辞（既定: after-fix）
//   AKARI_L1_NUDGE      1 のとき、字幕が出なかった場合に edit.json を触って
//                       applyIncrementalModel 経由の復帰（契約の「予言」）を確かめる
//   AKARI_CDP_PORT      CDP ポート
//
// 証跡に作業機の絶対パスを残さない（sanitizeText で <REDACTED> へ置換）。

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(evidenceDir, '..', '..');
const shellDir = path.join(worktree, 'apps', 'shell');
const label = process.env.AKARI_L1_LABEL || 'after-fix';

const electronCandidates = [shellDir, worktree].map(root =>
    path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
let electronBinary = electronCandidates[0];
for (const candidate of electronCandidates) {
    if (await stat(candidate).then(() => true, () => false)) { electronBinary = candidate; break; }
}
const ffmpegBinary = path.join(worktree, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');

const isolatedRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-captionz-l1-')));
const workspaceDir = path.join(isolatedRoot, 'workspace');
const profileDir = path.join(isolatedRoot, 'profile');
const configDir = path.join(isolatedRoot, 'config');
const akariHome = path.join(isolatedRoot, 'akari-home');
const outDir = process.env.AKARI_L1_OUT
    ? path.resolve(process.env.AKARI_L1_OUT)
    : path.join(evidenceDir, 'l1');

await Promise.all([
    mkdir(profileDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(akariHome, { recursive: true }),
    mkdir(outDir, { recursive: true })
]);

function sanitizeText(value) {
    let text = String(value ?? '');
    for (const from of [worktree, isolatedRoot, outDir, os.homedir()]) {
        if (!from) continue;
        text = text.split(`file://${from}`).join('file://<REDACTED>');
        text = text.split(from).join('<REDACTED>');
    }
    text = text.replace(/\/Users\/[^/"'\s]+/g, '<REDACTED>');
    text = text.replace(/\/private\/(tmp|var)\/[^"'\s]+/g, '<REDACTED>');
    text = text.replace(/\/var\/folders\/[^"'\s]+/g, '<REDACTED>');
    return text;
}
const sanitizeValue = value => value === undefined ? undefined : JSON.parse(sanitizeText(JSON.stringify(value)));

// ---------------------------------------------------------------- fixture

// 素材を取り込んでタイムラインへ置いただけの状態（captions.json は無い）
await cp(path.join(worktree, 'templates', 'project-default'), workspaceDir, { recursive: true });
await mkdir(path.join(workspaceDir, 'assets'), { recursive: true });
const mediaPath = path.join(workspaceDir, 'assets', 'main.mp4');
const ffmpeg = spawnSync(ffmpegBinary, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-t', '8', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaPath
], { encoding: 'utf8' });
if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout}`);

const captionsAtOpen = process.env.AKARI_L1_CAPTIONS_AT_OPEN === '1';
const fps = 30;
const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    tracks: [
        {
            id: 'v-main', lane: 'visual', items: [
                { id: 'cut-a', at: 0, duration: 8 * fps, source: { kind: 'media', src: 'main', in: 0, out: 8 } }
            ]
        },
        // 字幕レーンの上下関係を測るための中段トラック（受け入れ条件 2）
        {
            id: 'v1', lane: 'visual', items: [
                {
                    id: 'telop-a', at: 0, duration: 8 * fps,
                    source: { kind: 'telop', preset: 'ref3_chapter_tag', params: { text: '中段トラック' } }
                }
            ]
        }
    ]
};
const editPath = path.join(workspaceDir, 'edit.json');
await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, 'utf8');
const editUri = pathToFileURL(editPath).href;
const captionsPath = path.join(workspaceDir, 'captions.json');
const captions = [
    { id: 'cap-1', start: 0, end: 4, text: 'あとから作った字幕' },
    { id: 'cap-2', start: 4, end: 8, text: '開き直さずに出る' }
];
// 変種: 開いた時点で captions.json が既にある（既存 fieldtest 相当）
if (captionsAtOpen) await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`, 'utf8');

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

async function waitForTargets(port, timeoutMs = 60000) {
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

// caption plate の実効 z と、実際に字幕が描かれているかの観測
const PROBE = `(() => {
  const plate = document.getElementById('caption-plate');
  const engine = document.getElementById('frame-engine-preview');
  const plateStyle = plate ? getComputedStyle(plate) : null;
  const box = plate ? plate.getBoundingClientRect() : null;
  const summary = window.akari?.state?.summary ?? null;
  return {
    now: Math.round(performance.now()),
    plateExists: Boolean(plate),
    plateInlineZ: plate ? plate.style.zIndex : null,
    plateComputedZ: plateStyle ? plateStyle.zIndex : null,
    plateDisplay: plateStyle ? plateStyle.display : null,
    plateOpacity: plateStyle ? plateStyle.opacity : null,
    plateText: plate ? plate.textContent.trim().slice(0, 80) : null,
    plateChildren: plate ? plate.children.length : null,
    plateBox: box ? { x: Math.round(box.x), y: Math.round(box.y),
                      w: Math.round(box.width), h: Math.round(box.height) } : null,
    engineExists: Boolean(engine),
    engineComputedZ: engine ? getComputedStyle(engine).zIndex : null,
    engineReady: engine ? engine.dataset.frameEngineReady : null,
    summaryCaptionTrackId: summary?.captionTrackId ?? null,
    summaryHasCaptions: summary?.hasCaptions ?? null,
    summaryTimelineTracks: (summary?.timelineTracks ?? []).map(track => track.id),
    overlayZ: Array.from(document.querySelectorAll('[data-overlay-id]'))
      .map(element => ({ id: element.getAttribute('data-overlay-id'), z: element.style.zIndex })),
    layerZ: Array.from(document.querySelectorAll('[data-akari-layer-id]'))
      .map(element => ({ id: element.getAttribute('data-akari-layer-id'),
                         z: getComputedStyle(element).zIndex })),
    seek: Number(document.getElementById('seek')?.value ?? 0)
  };
})()`;

// ---------------------------------------------------------------- run

const port = Number(process.env.AKARI_CDP_PORT) || 18000 + (process.pid % 20000);
const result = { label, steps: {}, screenshots: [], errors: [] };
let child;
let main;
let browserCdp;
let shotRect = null;

async function screenshot(cdp, name) {
    try {
        if (!shotRect) {
            shotRect = await evalOn(cdp, `(() => {
      const frame = Array.from(document.querySelectorAll('iframe'))
        .map(element => ({ element, box: element.getBoundingClientRect() }))
        .filter(value => value.box.width > 200 && value.box.height > 150)
        .sort((left, right) => (right.box.width * right.box.height) - (left.box.width * left.box.height))[0];
      if (!frame) return null;
      const box = frame.box;
      return { x: Math.round(box.left), y: Math.round(box.top + 90),
               width: Math.round(box.width), height: Math.max(120, Math.round(box.height - 90)) };
    })()`).catch(() => null);
        }
        if (shotRect) {
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: shotRect.x + shotRect.width / 2, y: shotRect.y + shotRect.height - 12, button: 'none'
            }).catch(() => undefined);
            await sleep(400);
        }
        const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png', ...(shotRect ? { clip: { ...shotRect, scale: 1 } } : {})
        });
        const file = path.join(outDir, `${label}-${name}.png`);
        await writeFile(file, Buffer.from(shot.data, 'base64'));
        result.screenshots.push(`${label}-${name}.png`);
        return file;
    } catch (error) {
        result.errors.push({ screenshot: name, error: sanitizeText(error.message) });
        return null;
    }
}

try {
    child = spawn(electronBinary, [
        shellDir, workspaceDir,
        `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-sandbox'
    ], {
        cwd: shellDir,
        env: { ...process.env, THEIA_CONFIG_DIR: configDir, AKARI_HOME: akariHome },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    result.profileDir = sanitizeText(profileDir);
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
    result.consentDismissed = await dismissConsent(main);

    let openCommand = { ok: false, error: 'not attempted' };
    const openDeadline = Date.now() + 120000;
    while (Date.now() < openDeadline) {
        await dismissConsent(main).catch(() => undefined);
        openCommand = await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
        if (openCommand.ok && (openCommand.value === 'opened' || openCommand.value === 'revealed')) break;
        await sleep(1000);
    }
    result.openCommand = sanitizeValue(openCommand);

    let preview;
    for (let attempt = 0; attempt < 45 && !preview; attempt += 1) {
        await activatePreviewTab(main);
        await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
        preview = await finder.find(2000).catch(() => undefined);
    }
    if (!preview) preview = await finder.find(20000);
    const view = {
        eval: async (expression, userGesture = false) => {
            try {
                return await evalOn(browserCdp, expression, preview.contextId, preview.sessionId, userGesture);
            } catch (error) {
                result.errors.push({ evalRetry: sanitizeText(error.message).slice(0, 160) });
                preview = await finder.find(20000);
                return evalOn(browserCdp, expression, preview.contextId, preview.sessionId, userGesture);
            }
        }
    };

    // ---- BEFORE: 字幕がまだ無い状態（開いた時点で captions.json は存在しない） ----
    const settleDeadline = Date.now() + 40000;
    while (Date.now() < settleDeadline) {
        const probe = await view.eval(PROBE);
        if (probe.engineExists && probe.engineReady === 'true') break;
        await sleep(400);
    }
    await sleep(1500);
    result.steps.before = sanitizeValue(await view.eval(PROBE));
    await screenshot(main, '01-before-captions');

    if (captionsAtOpen) {
        result.steps.after = result.steps.before;
        result.steps.captionsAtOpen = true;
        await screenshot(main, '02-after-captions');
    } else {
    // ---- 字幕作成: captions.json を外部から書く（akari-transcript の字幕作成と同じ着地点） ----
    await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`, 'utf8');
    result.steps.captionsWrittenAt = Date.now();

    const waitDeadline = Date.now() + 60000;
    const timeline = [];
    let observed = null;
    while (Date.now() < waitDeadline) {
        await sleep(500);
        const probe = await view.eval(PROBE);
        timeline.push({
            msSinceWrite: Date.now() - result.steps.captionsWrittenAt,
            plateText: probe.plateText, plateInlineZ: probe.plateInlineZ,
            plateComputedZ: probe.plateComputedZ, captionTrackId: probe.summaryCaptionTrackId
        });
        if (probe.plateText) { observed = probe; break; }
    }
    result.steps.waitTimeline = sanitizeValue(timeline);
    await sleep(1200);
    result.steps.after = sanitizeValue(observed ?? await view.eval(PROBE));
    await screenshot(main, '02-after-captions');
    }

    // ---- 予言の確認: 出なかったときに edit.json を触ると applyIncrementalModel で出る ----
    const invisibleAfter = !result.steps.after.plateText || result.steps.after.plateComputedZ === '-1';
    if (invisibleAfter && process.env.AKARI_L1_NUDGE === '1') {
        const nudged = { ...edit, output: { ...edit.output } };
        nudged.tracks[0].items[0].duration = 8 * fps - 1;
        await writeFile(editPath, `${JSON.stringify(nudged, null, 2)}\n`, 'utf8');
        const nudgeDeadline = Date.now() + 30000;
        let nudgeProbe = null;
        while (Date.now() < nudgeDeadline) {
            await sleep(500);
            nudgeProbe = await view.eval(PROBE);
            if (nudgeProbe.plateText && nudgeProbe.plateComputedZ !== '-1') break;
        }
        await sleep(1200);
        nudgeProbe = await view.eval(PROBE);
        result.steps.afterEditNudge = sanitizeValue(nudgeProbe);
        await screenshot(main, '03-after-edit-nudge');
    }

    result.consoleWarnings = finder.consoleLog.filter(entry => ['warning', 'error'].includes(entry.type)).slice(0, 20);
    result.electronStderr = sanitizeText(stderrChunks.join('')).split('\n')
        .filter(line => /error|fail|警告/i.test(line)).slice(0, 15);
} catch (error) {
    result.errors.push({ fatal: sanitizeText(error?.stack ?? error?.message ?? String(error)) });
} finally {
    try { main?.close(); } catch { /* already closed */ }
    try { browserCdp?.close(); } catch { /* already closed */ }
    if (child?.pid) {
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
        await sleep(1500);
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    await sleep(1500);
    const survivors = spawnSync('ps', ['-eo', 'pid,ppid,args'], { encoding: 'utf8' }).stdout ?? '';
    result.survivingProcesses = survivors.split('\n')
        .filter(line => line.includes(profileDir) || line.includes(path.join(shellDir, 'lib', 'backend', 'main.js')))
        .map(line => sanitizeText(line.trim())).filter(Boolean);
}

// ---- BEFORE / AFTER の画が実際に変わったか（PSNR。inf = 完全一致 = 字幕は描かれていない） ----
const beforePng = path.join(outDir, `${label}-01-before-captions.png`);
const afterPng = path.join(outDir, `${label}-02-after-captions.png`);
try {
    await stat(beforePng);
    await stat(afterPng);
    const psnr = spawnSync(ffmpegBinary, [
        '-hide_banner', '-loglevel', 'info', '-i', beforePng, '-i', afterPng,
        '-lavfi', 'psnr', '-f', 'null', '-'
    ], { encoding: 'utf8' });
    const line = (psnr.stderr ?? '').split('\n').find(value => value.includes('PSNR')) ?? '';
    result.psnrBeforeVsAfter = line.trim();
} catch (error) {
    result.psnrBeforeVsAfter = `unavailable: ${sanitizeText(String(error.message))}`;
}

function psnrAverage(line) {
    const match = /average:([0-9.]+)/.exec(String(line ?? ''));
    return match ? Number(match[1]) : null;
}
const nudgePng = path.join(outDir, `${label}-03-after-edit-nudge.png`);
try {
    await stat(nudgePng);
    const psnr = spawnSync(ffmpegBinary, [
        '-hide_banner', '-loglevel', 'info', '-i', beforePng, '-i', nudgePng,
        '-lavfi', 'psnr', '-f', 'null', '-'
    ], { encoding: 'utf8' });
    result.psnrBeforeVsNudge = ((psnr.stderr ?? '').split('\n').find(value => value.includes('PSNR')) ?? '').trim();
} catch { /* the nudge pass did not run */ }

const after = result.steps.after ?? {};
result.verdict = {
    captionRendered: Boolean(after.plateText),
    plateInlineZ: after.plateInlineZ ?? null,
    plateComputedZ: after.plateComputedZ ?? null,
    captionTrackId: after.summaryCaptionTrackId ?? null,
    reopenRequired: !after.plateText,
    survivingProcessCount: (result.survivingProcesses ?? []).length
};
// PSNR が十分低い = BEFORE の画から実際に変わった = 字幕が塗られている
const afterPsnr = psnrAverage(result.psnrBeforeVsAfter);
result.verdict.captionPaintedPsnrDb = afterPsnr;
result.verdict.captionPainted = afterPsnr !== null ? afterPsnr < 45 : null;
result.verdict.nudgePsnrDb = psnrAverage(result.psnrBeforeVsNudge);
result.fatalErrors = result.errors.filter(entry => entry.fatal || entry.screenshot);
result.pass = Boolean(after.plateText) && after.plateComputedZ !== '-1'
    && (captionsAtOpen || result.verdict.captionPainted === true) && result.fatalErrors.length === 0;

await writeFile(path.join(outDir, `${label}-result.json`), `${JSON.stringify(sanitizeValue(result), null, 2)}\n`, 'utf8');
console.log(JSON.stringify(sanitizeValue(result), null, 2));
for (const directory of [workspaceDir, profileDir, configDir, akariHome]) {
    await rm(directory, { recursive: true, force: true });
}
if ((result.fatalErrors ?? result.errors).length > 0) process.exitCode = 1;
