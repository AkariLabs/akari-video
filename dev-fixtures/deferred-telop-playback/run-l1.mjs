#!/usr/bin/env node

// L1（実機 Electron + CDP + 実 DOM）: ネイティブテロップの遅延ラスタライズが
// 「焼き中は準備中プレースホルダが見える / 焼き上がった瞬間に再生中でもその場で出る」
// ことを実測する検証ハーネス。
//
//   node dev-fixtures/deferred-telop-playback/run-l1.mjs
//
// 環境変数:
//   AKARI_L1_PROJECT       既存プロジェクトを隔離コピーして使う（未指定なら ffmpeg で合成）
//   AKARI_L1_TELOP_EXTEND  1 のとき、コピー側の telop item を全尺へ延長する
//                          （焼き上がりが再生中の区間内で起きる状況を確実に作るため）
//   AKARI_L1_OUT           結果 JSON / スクリーンショットの出力先（既定: 一時ディレクトリ）
//   AKARI_CDP_PORT         CDP ポート
//
// 出力（result.json）の主要な実測値:
//   pass1.bakeReadyMs / firstVisibleMs / readyToVisibleMs / visibleWhilePlaying
//   pass1.placeholderSeenWhileBaking / placeholderText
//   pass2（焼き上がり後の通し再生）/ pass3（シーク経由）/ scrub（静止シークの安定）

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(fixtureDir, '..', '..');
const shellDir = path.join(worktree, 'apps', 'shell');

const electronBinary = process.platform === 'darwin'
    ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : process.platform === 'win32'
        ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe')
        : path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron');

// macOS の /var/folders は /private/var/folders への symlink。ワークスペース境界判定は
// realpath 側で行われるため、最初から実体パスで揃えておく
const isolatedRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-telop-l1-')));
const workspaceDir = path.join(isolatedRoot, 'workspace');
const profileDir = path.join(isolatedRoot, 'profile');
const configDir = path.join(isolatedRoot, 'config');
const outDir = process.env.AKARI_L1_OUT
    ? path.resolve(process.env.AKARI_L1_OUT)
    : path.join(isolatedRoot, 'out');

await stat(electronBinary);
await Promise.all([
    mkdir(profileDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
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
    text = text.replace(/\/private\/tmp\/[^"'\s]+/g, '<REDACTED>');
    text = text.replace(/\/var\/folders\/[^"'\s]+/g, '<REDACTED>');
    return text;
}

function sanitizeValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(sanitizeText(JSON.stringify(value)));
}

// ---------------------------------------------------------------- fixture

async function synthesizeProject(target) {
    await cp(path.join(worktree, 'templates', 'project-default'), target, { recursive: true });
    await mkdir(path.join(target, 'assets'), { recursive: true });
    const media = path.join(target, 'assets', 'main.mp4');
    const ffmpeg = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
        '-t', '13', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media
    ], { encoding: 'utf8' });
    if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout}`);
    const edit = {
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'main', path: 'assets/main.mp4' }],
        tracks: [
            {
                id: 'v-main', lane: 'visual', items: [
                    { id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } },
                    { id: 'cut-b', at: 180, duration: 150, source: { kind: 'media', src: 'main', in: 6, out: 11 } }
                ]
            },
            {
                id: 'v1', lane: 'visual', items: [
                    {
                        id: 'telop-chapter', at: 30, duration: 90,
                        source: { kind: 'telop', preset: 'ref3_chapter_tag', params: { text: '第1章 検証' } }
                    }
                ]
            }
        ]
    };
    await writeFile(path.join(target, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`, 'utf8');
}

const sourceProject = process.env.AKARI_L1_PROJECT;
if (sourceProject) {
    await cp(path.resolve(sourceProject), workspaceDir, { recursive: true });
    // キャッシュ済み .preview.webm が残っていると「焼き中」が観測できないので毎回落とす
    await rm(path.join(workspaceDir, 'cache', 'preview'), { recursive: true, force: true });
} else {
    await synthesizeProject(workspaceDir);
}

const editPath = path.join(workspaceDir, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const edit = JSON.parse(await readFile(editPath, 'utf8'));
const fps = edit.output?.fps ?? 30;
const telopItem = edit.tracks
    .flatMap(track => track.items ?? [])
    .find(item => item.source?.kind === 'telop');
if (!telopItem) throw new Error('telop item was not found in edit.json');
const timelineFrames = Math.max(...edit.tracks.flatMap(track =>
    (track.items ?? []).map(item => item.at + item.duration)));

let editMutated = false;
if (process.env.AKARI_L1_TELOP_EXTEND === '1') {
    telopItem.duration = timelineFrames - telopItem.at;
    editMutated = true;
}
// テロップ焼成のコストは「解像度 x 焼くフレーム数」に比例し、サービス側には 120 秒の
// タイムアウトがある。負荷の高いマシンでもタイムアウト前に焼き上がるよう、コピー側の
// 出力解像度と fps だけを落とせるようにする（fps を下げても秒尺は変えない = 尺は
// フレーム番号を新 fps へ換算する。fieldtest 原本は無改変）
if (process.env.AKARI_L1_OUTPUT) {
    const [width, height] = process.env.AKARI_L1_OUTPUT.split('x').map(Number);
    if (Number.isFinite(width) && Number.isFinite(height)) {
        edit.output = { ...edit.output, width, height };
        editMutated = true;
    }
}
if (process.env.AKARI_L1_FPS) {
    const nextFps = Number(process.env.AKARI_L1_FPS);
    if (Number.isFinite(nextFps) && nextFps > 0 && nextFps !== fps) {
        const rescale = frames => Math.max(1, Math.round((frames * nextFps) / fps));
        for (const track of edit.tracks) {
            for (const item of track.items ?? []) {
                item.at = Math.round((item.at * nextFps) / fps);
                item.duration = rescale(item.duration);
            }
        }
        edit.output = { ...edit.output, fps: nextFps };
        editMutated = true;
    }
}
if (editMutated) await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, 'utf8');

const outputFps = edit.output?.fps ?? fps;
const finalFrames = Math.max(...edit.tracks.flatMap(track =>
    (track.items ?? []).map(item => item.at + item.duration)));
const telopWindow = {
    id: telopItem.id,
    start: telopItem.at / outputFps,
    end: (telopItem.at + telopItem.duration) / outputFps
};
const telopBakeFrames = telopItem.duration;
const timelineDuration = finalFrames / outputFps;
const cutBoundaries = (edit.tracks.find(track => (track.items ?? [])
    .some(item => item.source?.kind === 'media'))?.items ?? [])
    .slice(1).map(item => item.at / outputFps);

// ---------------------------------------------------------------- CDP

class CDP {
    constructor(url, label) {
        this.url = url;
        this.label = label;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

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
            for (const listener of this.listeners.get(message.method) ?? []) {
                listener(message.params, message.sessionId);
            }
        });
    }

    // セッションが黙って消えると応答が返らない。無期限待ちでハングしないよう必ず期限を切る
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

    close() {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
    }
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

async function listTargets(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return response.json();
}

async function browserDebuggerUrl(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const value = await response.json();
    if (!value.webSocketDebuggerUrl) throw new Error('browser debugger URL was not exposed');
    return value.webSocketDebuggerUrl;
}

async function waitForTargets(port, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    let latest = [];
    while (Date.now() < deadline) {
        try {
            latest = await listTargets(port);
            if (latest.some(target => target.type === 'page')) return latest;
        } catch { /* the debugger endpoint is not up yet */ }
        await sleep(250);
    }
    throw new Error('CDP target was not ready');
}

// preview webview（二重 iframe）の内側 execution context を探す
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
                args: (event.args ?? []).map(arg => sanitizeText(arg.value ?? arg.description ?? ''))
            });
        });
    }

    // Theia の webview は「外側 webview.localhost の iframe → 内側 active-frame」の二重入れ子で、
    // 手動 attach したセッションは再ナビゲートのたびに detach される。auto-attach を親子両方向へ
    // 再帰的にかけて、入れ子フレームの execution context を取りこぼさないようにする。
    async initialize() {
        this.cdp.on('Target.attachedToTarget', event => {
            void this.register(event.sessionId, event.targetInfo);
        });
        await this.cdp.send('Target.setDiscoverTargets', { discover: true });
        await this.cdp.send('Target.setAutoAttach', {
            autoAttach: true, waitForDebuggerOnStart: false, flatten: true
        });
        await this.refresh();
    }

    async register(sessionId, info) {
        if (String(info?.url ?? '').startsWith('devtools:')) return;
        this.sessions.set(sessionId, { info, sessionId });
        this.contexts.set(sessionId, new Map());
        for (const [method, params] of [
            ['Runtime.enable', {}],
            ['Page.enable', {}],
            ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }]
        ]) {
            await this.cdp.send(method, params, sessionId).catch(() => undefined);
        }
    }

    // auto-attach は OOPIF（webview.localhost の iframe）を拾い切らないことがあるので、
    // Target.getTargets の明示 attach も併用して取りこぼしを埋める
    async refresh() {
        const result = await this.cdp.send('Target.getTargets', {}).catch(() => undefined);
        const live = new Set([...this.sessions.values()].map(session => session.info?.targetId));
        for (const info of result?.targetInfos ?? []) {
            if (!['page', 'iframe', 'webview', 'other'].includes(info.type)) continue;
            if (String(info.url ?? '').startsWith('devtools:')) continue;
            if (live.has(info.targetId)) continue;
            try {
                const attached = await this.cdp.send('Target.attachToTarget', {
                    targetId: info.targetId, flatten: true
                });
                await this.register(attached.sessionId, info);
            } catch { /* target went away or is already attached */ }
        }
    }

    async find(timeoutMs = 60000) {
        const deadline = Date.now() + timeoutMs;
        const probe = `(() => { try {
            return { href: typeof location === 'object' ? location.href : '',
                hit: Boolean(document.getElementById('preview-layers')
                    && document.getElementById('play-toggle')),
                title: document.title,
                bodyHead: (document.body && document.body.innerHTML || '').slice(0, 80) };
        } catch (error) { return { error: String(error) }; } })()`;
        while (Date.now() < deadline) {
            await this.refresh();
            this.probeErrors = [];
            for (const session of this.sessions.values()) {
                for (const context of this.contexts.get(session.sessionId)?.values() ?? []) {
                    try {
                        const value = await evalOn(this.cdp, probe, context.id, session.sessionId);
                        this.probeErrors.push({ context: context.id, value });
                        if (value?.hit) return { sessionId: session.sessionId, contextId: context.id };
                    } catch (error) {
                        this.probeErrors.push({ context: context.id, error: sanitizeText(error.message).slice(0, 400) });
                    }
                }
            }
            await sleep(250);
        }
        throw new Error(`preview webview context was not found: ${sanitizeText(JSON.stringify(this.diagnostics()))}`);
    }

    diagnostics() {
        return { probes: this.probeErrors ?? [], sessions: [...this.sessions.values()].map(session => ({
            type: session.info.type,
            url: session.info.url,
            title: session.info.title,
            contexts: [...(this.contexts.get(session.sessionId)?.values() ?? [])]
                .map(context => ({ id: context.id, origin: context.origin, name: context.name }))
        })) };
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
      const primitive = value === null
        || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
      return { ok: true, value: primitive ? value : undefined };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  })()`);
}

async function activatePreviewTab(cdp) {
    {
        const rect = await evalOn(cdp, `(() => {
      const label = Array.from(document.querySelectorAll('[class*="TabBar-tabLabel"]'))
        .find(element => element.textContent?.trim() === '出力プレビュー');
      if (!label) return null;
      const box = label.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
        if (rect) {
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' });
            await sleep(40);
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1
            });
            await sleep(60);
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1
            });
            await sleep(500);
            const framed = await evalOn(cdp, 'document.querySelectorAll(\'iframe\').length');
            if (framed > 0) return true;
        }
    }
    return false;
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

// ---------------------------------------------------------------- sampler

const SAMPLER = telopId => `(() => {
  window.__akariTelopSamples = [];
  window.__akariTelopMarks = [];
  const telopId = ${JSON.stringify(telopId)};
  const stage = document.getElementById('preview-layers');
  const seek = document.getElementById('seek');
  const playToggle = document.getElementById('play-toggle');
  const read = () => {
    const placeholder = stage.querySelector('[data-akari-deferred-telop-id=' + JSON.stringify(telopId) + ']')
      || stage.querySelector('[data-akari-deferred-telop-id]');
    const video = stage.querySelector('video[data-akari-layer-id=' + JSON.stringify(telopId) + ']')
      || stage.querySelector('img[data-akari-layer-id=' + JSON.stringify(telopId) + ']');
    const layer = (window.akari?.state?.summary?.layers ?? [])
      .find(candidate => String(candidate.id) === telopId) ?? null;
    return {
      now: Math.round(performance.now()),
      t: Number(seek?.value ?? 0),
      playing: playToggle?.getAttribute('aria-label') === '一時停止',
      placeholderDisplay: placeholder ? getComputedStyle(placeholder).display : null,
      placeholderState: placeholder?.dataset?.akariDeferredState ?? null,
      placeholderText: placeholder ? placeholder.textContent.trim() : null,
      placeholderVisible: placeholder
        ? getComputedStyle(placeholder).display !== 'none'
          && getComputedStyle(placeholder).visibility !== 'hidden'
          && placeholder.getBoundingClientRect().width > 0
        : false,
      videoDisplay: video ? getComputedStyle(video).display : null,
      videoVisible: Boolean(video) && getComputedStyle(video).display !== 'none'
        && video.getBoundingClientRect().width > 0,
      videoReadyState: video?.readyState ?? null,
      videoCurrentTime: video ? Number(video.currentTime.toFixed(3)) : null,
      videoPaused: video?.paused ?? null,
      videoRate: video ? Number(video.playbackRate.toFixed(3)) : null,
      layerProxyMissing: layer ? Boolean(layer.proxyMissing) : null,
      layerHasSrc: layer ? Boolean(layer.src) : null
    };
  };
  const pump = () => {
    try { window.__akariTelopSamples.push(read()); } catch (error) { /* keep sampling */ }
    window.__akariTelopRaf = requestAnimationFrame(pump);
  };
  window.__akariTelopMark = label => window.__akariTelopMarks.push({
    label, now: Math.round(performance.now()), t: Number(seek?.value ?? 0)
  });
  window.__akariTelopRaf = requestAnimationFrame(pump);
  return true;
})()`;

const READ_SAMPLES = `(() => {
  const samples = window.__akariTelopSamples ?? [];
  window.__akariTelopSamples = [];
  return { samples, marks: window.__akariTelopMarks ?? [] };
})()`;

// ---------------------------------------------------------------- analysis

function analyse(samples, marks, label) {
    const inWindow = sample => sample.t >= telopWindow.start && sample.t < telopWindow.end;
    const origin = samples.length > 0 ? samples[0].now : 0;
    const relative = sample => sample.now - origin;
    const ready = samples.find(sample => sample.layerProxyMissing === false && sample.layerHasSrc);
    const firstVisible = samples.find(sample => sample.videoVisible);
    const placeholderWhileBaking = samples.filter(sample =>
        sample.placeholderVisible && inWindow(sample) && sample.layerProxyMissing !== false);
    const placeholderAfterReady = samples.filter(sample =>
        sample.placeholderVisible && inWindow(sample) && sample.layerProxyMissing === false);
    const visibleInWindow = samples.filter(sample => sample.videoVisible && inWindow(sample));
    const nothingShown = samples.filter(sample =>
        inWindow(sample) && !sample.videoVisible && !sample.placeholderVisible);
    const playingSamples = samples.filter(sample => sample.playing);
    let maxBackJump = 0;
    for (let index = 1; index < playingSamples.length; index += 1) {
        const delta = playingSamples[index - 1].t - playingSamples[index].t;
        if (delta > maxBackJump) maxBackJump = delta;
    }
    const drifts = visibleInWindow
        .filter(sample => sample.videoCurrentTime !== null)
        .map(sample => Math.abs((sample.t - telopWindow.start) - sample.videoCurrentTime));
    const timelineTs = samples.map(sample => sample.t).filter(Number.isFinite);
    const crossedCutBoundaries = cutBoundaries.filter(boundary =>
        timelineTs.some(value => value < boundary) && timelineTs.some(value => value >= boundary));
    return {
        label,
        sampleCount: samples.length,
        minTimelineT: timelineTs.length > 0 ? Number(Math.min(...timelineTs).toFixed(3)) : null,
        maxTimelineT: timelineTs.length > 0 ? Number(Math.max(...timelineTs).toFixed(3)) : null,
        crossedCutBoundaries,
        marks: marks.map(mark => ({ ...mark, ms: mark.now - origin })),
        telopWindow,
        bakeReadyMs: ready ? relative(ready) : null,
        bakeReadyAtTimelineT: ready ? Number(ready.t.toFixed(3)) : null,
        firstVisibleMs: firstVisible ? relative(firstVisible) : null,
        firstVisibleAtTimelineT: firstVisible ? Number(firstVisible.t.toFixed(3)) : null,
        readyToVisibleMs: ready && firstVisible ? relative(firstVisible) - relative(ready) : null,
        visibleWhilePlaying: Boolean(firstVisible?.playing),
        placeholderSeenWhileBaking: placeholderWhileBaking.length,
        placeholderText: placeholderWhileBaking[0]?.placeholderText
            ?? samples.find(sample => sample.placeholderText)?.placeholderText ?? null,
        placeholderStates: [...new Set(samples.map(sample => sample.placeholderState).filter(Boolean))],
        placeholderFramesAfterReadyInWindow: placeholderAfterReady.length,
        visibleFramesInWindow: visibleInWindow.length,
        framesInWindow: samples.filter(inWindow).length,
        blankFramesInWindow: nothingShown.length,
        blankFramesInWindowAfterReady: nothingShown.filter(sample => sample.layerProxyMissing === false).length,
        maxTimelineBackJumpSec: Number(maxBackJump.toFixed(3)),
        maxTelopClockDriftSec: drifts.length > 0 ? Number(Math.max(...drifts).toFixed(3)) : null,
        playbackRates: [...new Set(visibleInWindow.map(sample => sample.videoRate))].sort()
    };
}

// ---------------------------------------------------------------- run

const port = Number(process.env.AKARI_CDP_PORT) || 18000 + (process.pid % 20000);
const result = {
    project: sourceProject ? 'copied-project' : 'synthesized-project',
    telopExtended: process.env.AKARI_L1_TELOP_EXTEND === '1',
    output: { width: edit.output?.width, height: edit.output?.height, fps: outputFps },
    telopBakeFrames,
    telopWindow,
    timelineDuration,
    cutBoundaries,
    passes: {},
    screenshots: [],
    errors: []
};
let child;
let main;
let browserCdp;

// Page.captureScreenshot は top-level target 専用。webview の iframe セッションでは
// 実行できないので、常にメインページ側から撮る。
// 証跡にマシン絶対パスを残さないため、(a) 撮る前にカーソルを退避してツールチップを消し、
// (b) プレビュー webview の矩形だけを clip する（タブのパスツールチップやサイドバーを外す）
async function screenshot(cdp, sessionId, name) {
    try {
        const rect = await evalOn(cdp, `(() => {
      const frame = Array.from(document.querySelectorAll('iframe'))
        .map(element => ({ element, box: element.getBoundingClientRect() }))
        .filter(value => value.box.width > 200 && value.box.height > 150)
        .sort((left, right) => (right.box.width * right.box.height) - (left.box.width * left.box.height))[0];
      if (!frame) return null;
      // 上端 90px はタブ列のツールチップ（ワークスペース絶対パスを出す）が被り得るので外す
      const box = frame.box;
      return { x: box.left, y: box.top + 90, width: box.width, height: Math.max(120, box.height - 90) };
    })()`).catch(() => null);
        if (rect) {
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: rect.x + rect.width / 2, y: rect.y + rect.height - 12, button: 'none'
            }).catch(() => undefined);
            await sleep(500);
        }
        const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            ...(rect ? { clip: { ...rect, scale: 1 } } : {})
        });
        const file = path.join(outDir, `${name}.png`);
        await writeFile(file, Buffer.from(shot.data, 'base64'));
        result.screenshots.push(`${name}.png`);
    } catch (error) {
        result.errors.push({ screenshot: name, error: sanitizeText(error.message) });
    }
}

try {
    child = spawn(electronBinary, [
        shellDir,
        workspaceDir,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        '--no-sandbox'
    ], {
        cwd: shellDir,
        env: { ...process.env, THEIA_CONFIG_DIR: configDir },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const stderrChunks = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => stderrChunks.push(chunk));

    const targets = await waitForTargets(port);
    const mainTarget = targets.find(target => target.type === 'page' && !target.url.startsWith('devtools:'));
    if (!mainTarget) throw new Error('main page target was not found');
    main = new CDP(mainTarget.webSocketDebuggerUrl, 'main');
    await main.connect();
    await main.send('Page.enable');
    await main.send('Runtime.enable');

    browserCdp = new CDP(await browserDebuggerUrl(port), 'browser');
    await browserCdp.connect();
    const finder = new PreviewFinder(browserCdp);
    await finder.initialize();

    await evalOn(main, '(() => { window.resizeTo(1600, 1100); return true; })()');
    await sleep(700);
    result.consentDismissed = await dismissConsent(main);

    // シェルの起動完了（拡張の command 登録）を待ってから開く
    let openCommand = { ok: false, error: 'not attempted' };
    const openDeadline = Date.now() + 120000;
    while (Date.now() < openDeadline) {
        await dismissConsent(main).catch(() => undefined);
        openCommand = await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
        if (openCommand.ok && (openCommand.value === 'opened' || openCommand.value === 'revealed')) break;
        await sleep(1000);
    }
    result.openCommand = sanitizeValue(openCommand);
    if (!openCommand.ok) {
        await screenshot(main, undefined, '00-open-failed');
        result.mainBodyText = sanitizeText(
            await evalOn(main, 'document.body?.innerText?.slice(0, 600) ?? ""').catch(() => '')
        );
    }
    // ensureVisible はタブを作るが前面化までは保証しない。Theia の webview iframe は
    // 前面のタブでしか生成されないので、タブラベルを実クリックして活性化する
    let preview;
    let activated = false;
    try {
        for (let attempt = 0; attempt < 45 && !preview; attempt += 1) {
            activated = (await activatePreviewTab(main)) || activated;
            await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
            preview = await finder.find(2000).catch(() => undefined);
        }
        result.previewTabActivated = activated;
        if (!preview) preview = await finder.find(20000);
    } catch (error) {
        await screenshot(main, undefined, '00-preview-not-found');
        result.previewTabState = sanitizeValue(await evalOn(main, `(() => ({
            title: document.title,
            tabs: Array.from(document.querySelectorAll('[class*="TabBar-tabLabel"]'))
                .map(element => element.textContent?.trim()).filter(Boolean),
            webviewFrames: document.querySelectorAll('iframe').length
        }))()`).catch(() => null));
        throw error;
    }
    // webview は再ナビゲートで execution context が入れ替わる。失敗したら探し直して 1 度だけ再試行
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

    // ---- pass 1: 開いた直後に即再生（焼き中に区間へ突入する経路） ----
    await view.eval(SAMPLER(telopWindow.id));
    await view.eval(`(() => { window.__akariTelopMark('play-click');
        document.getElementById('play-toggle').click(); return true; })()`, true);
    // 焼き上がり + 通し再生を十分カバーする時間だけ回す
    const pass1Deadline = Date.now() + 40000;
    let pass1Samples = [];
    let pass1Marks = [];
    let shotDuringBake = false;
    while (Date.now() < pass1Deadline) {
        await sleep(400);
        const chunk = await view.eval(READ_SAMPLES);
        pass1Samples = pass1Samples.concat(chunk.samples);
        pass1Marks = chunk.marks;
        const latest = chunk.samples[chunk.samples.length - 1];
        if (!shotDuringBake && latest?.placeholderVisible) {
            shotDuringBake = true;
            await screenshot(main, undefined, '01-baking-placeholder');
        }
        const ready = pass1Samples.some(sample => sample.layerProxyMissing === false);
        const visible = pass1Samples.some(sample => sample.videoVisible);
        const stopped = latest && !latest.playing && pass1Samples.some(sample => sample.playing);
        if (ready && visible) break;
        if (stopped) break;
    }
    result.passes.pass1 = analyse(pass1Samples, pass1Marks, '開いた直後に即再生');

    // ---- pass 1b: 焼き上がりの瞬間まで「区間の中で再生し続ける」 ----
    // 焼成は telop の尺に比例して重く、素の通し再生では焼き上がる前に尺が終わる。
    // 区間端まで来たら区間頭へ戻して再生を継続し、焼き上がりが「再生中・区間内」で
    // 起きる状況を作る。戻しシークの時刻を記録し、first-visible がその後のシークでは
    // なく焼き上がり自体で起きたことを判定できるようにする。
    await view.eval(`(() => {
        if (document.getElementById('play-toggle').getAttribute('aria-label') === '一時停止') {
            document.getElementById('play-toggle').click();
        }
        window.postMessage({ type: 'akari-preview-seek', time: ${telopWindow.start + 0.05} }, '*');
        return true; })()`, true);
    await sleep(600);
    await view.eval(SAMPLER(telopWindow.id));
    await view.eval(`(() => { window.__akariTelopMark('play-click');
        document.getElementById('play-toggle').click(); return true; })()`, true);
    let loopSamples = [];
    let loopMarks = [];
    const loopDeadline = Date.now() + Number(process.env.AKARI_L1_READY_TIMEOUT_MS ?? 300000);
    while (Date.now() < loopDeadline) {
        await sleep(120);
        const chunk = await view.eval(READ_SAMPLES);
        loopSamples = loopSamples.concat(chunk.samples);
        loopMarks = chunk.marks;
        const latest = chunk.samples[chunk.samples.length - 1];
        if (!latest) continue;
        if (!shotDuringBake && latest.placeholderVisible) {
            shotDuringBake = true;
            await screenshot(main, undefined, '01-baking-placeholder');
        }
        if (loopSamples.some(sample => sample.videoVisible)) {
            // 焼き上がり直後（まだ区間内）の画をそのまま撮る。1.5s の追加サンプリングは
            // 撮影のあとに回す（待ってから撮ると再生が区間を出てしまう）
            await screenshot(main, undefined, '02-telop-visible-while-playing');
            await sleep(1500);
            break;
        }
        // 区間の終端に近づいたら（または再生が止まっていたら）区間頭へ巻き戻して再生継続
        if (!latest.playing || latest.t >= telopWindow.end - 0.35) {
            await view.eval(`(() => {
                window.__akariTelopMark('loop-seek');
                window.postMessage({ type: 'akari-preview-seek', time: ${telopWindow.start + 0.05} }, '*');
                if (document.getElementById('play-toggle').getAttribute('aria-label') !== '一時停止') {
                    document.getElementById('play-toggle').click();
                }
                return true; })()`, true);
        }
    }
    const tail = await view.eval(READ_SAMPLES);
    loopSamples = loopSamples.concat(tail.samples);
    loopMarks = tail.marks;
    result.passes.pass1b = analyse(loopSamples, loopMarks, '焼き上がりの瞬間（区間内で再生継続）');
    {
        const origin = loopSamples.length > 0 ? loopSamples[0].now : 0;
        const readySample = loopSamples.find(sample => sample.layerProxyMissing === false && sample.layerHasSrc);
        const visibleSample = loopSamples.find(sample => sample.videoVisible);
        const seekMarks = loopMarks.filter(mark => mark.label === 'loop-seek')
            .map(mark => mark.now - origin);
        const visibleMs = visibleSample ? visibleSample.now - origin : null;
        const lastSeekBeforeVisible = visibleMs === null
            ? null
            : seekMarks.filter(value => value <= visibleMs).pop() ?? null;
        result.passes.pass1b.loopSeekCount = seekMarks.length;
        result.passes.pass1b.lastLoopSeekBeforeVisibleMs = lastSeekBeforeVisible;
        result.passes.pass1b.visibleAfterLastSeekMs = visibleMs !== null && lastSeekBeforeVisible !== null
            ? visibleMs - lastSeekBeforeVisible
            : null;
        result.passes.pass1b.readyToVisibleMsMeasured = readySample && visibleSample
            ? (visibleSample.now - origin) - (readySample.now - origin)
            : null;
        result.passes.pass1b.seekBetweenReadyAndVisible = readySample && visibleSample
            ? seekMarks.some(value => value > (readySample.now - origin) && value <= visibleMs)
            : null;
    }

    // ---- 焼き上がり待ち（非回帰パスの前提） ----
    const readyDeadline = Date.now() + Number(process.env.AKARI_L1_READY_TIMEOUT_MS ?? 240000);
    const readyStart = Date.now();
    let bakeReady = false;
    while (Date.now() < readyDeadline && !bakeReady) {
        bakeReady = await view.eval(`(() => {
            const layer = (window.akari?.state?.summary?.layers ?? [])
                .find(candidate => String(candidate.id) === ${JSON.stringify(telopWindow.id)});
            return Boolean(layer && layer.proxyMissing === false && layer.src);
        })()`);
        if (!bakeReady) await sleep(1000);
    }
    result.bakeReadyWaitMs = bakeReady ? Date.now() - readyStart : null;
    result.bakeReady = bakeReady;

    // ---- pass 2: 焼き上がり後の通し再生（非回帰） ----
    await view.eval(`(() => {
        if (document.getElementById('play-toggle').getAttribute('aria-label') === '一時停止') {
            document.getElementById('play-toggle').click();
        }
        window.postMessage({ type: 'akari-preview-seek', time: 0 }, '*');
        return true; })()`, true);
    await sleep(1200);
    await view.eval(SAMPLER(telopWindow.id));
    await view.eval(`(() => { window.__akariTelopMark('play-click');
        document.getElementById('play-toggle').click(); return true; })()`, true);
    let pass2Samples = [];
    let pass2Marks = [];
    const pass2Deadline = Date.now() + Math.ceil((telopWindow.end + 3) * 1000) + 6000;
    while (Date.now() < pass2Deadline) {
        await sleep(400);
        const chunk = await view.eval(READ_SAMPLES);
        pass2Samples = pass2Samples.concat(chunk.samples);
        pass2Marks = chunk.marks;
        const latest = chunk.samples[chunk.samples.length - 1];
        if (latest && latest.t >= Math.min(telopWindow.end + 0.4, timelineDuration - 0.05)) break;
    }
    await screenshot(main, undefined, '03-second-playthrough');
    result.passes.pass2 = analyse(pass2Samples, pass2Marks, '焼き上がり後の通し再生');

    // ---- pass 3: シーク経由（非回帰） ----
    await view.eval(`(() => {
        if (document.getElementById('play-toggle').getAttribute('aria-label') === '一時停止') {
            document.getElementById('play-toggle').click();
        }
        return true; })()`, true);
    await sleep(600);
    await view.eval(SAMPLER(telopWindow.id));
    const scrubTargets = [];
    for (let index = 1; index <= 6; index += 1) {
        const target = telopWindow.start
            + ((telopWindow.end - telopWindow.start) * index) / 7;
        scrubTargets.push(Number(target.toFixed(3)));
    }
    const scrubObservations = [];
    for (const target of scrubTargets) {
        await view.eval(`(() => { window.__akariTelopMark('seek-${target}');
            window.postMessage({ type: 'akari-preview-seek', time: ${target} }, '*'); return true; })()`);
        await sleep(700);
        const settled = await view.eval(`(() => {
            const samples = window.__akariTelopSamples ?? [];
            return samples[samples.length - 1] ?? null;
        })()`);
        scrubObservations.push({
            seekTo: target,
            timelineT: settled ? Number(settled.t.toFixed(3)) : null,
            videoVisible: settled?.videoVisible ?? null,
            placeholderVisible: settled?.placeholderVisible ?? null,
            placeholderState: settled?.placeholderState ?? null,
            videoCurrentTime: settled?.videoCurrentTime ?? null
        });
    }
    await screenshot(main, undefined, '04-seek-visible');
    const scrubChunk = await view.eval(READ_SAMPLES);
    result.passes.pass3 = analyse(scrubChunk.samples, scrubChunk.marks, 'シーク経由');
    result.passes.pass3.scrubObservations = scrubObservations;
    result.passes.pass3.placeholderFlashFramesWhilePaused = scrubChunk.samples
        .filter(sample => !sample.playing && sample.placeholderVisible
            && sample.layerProxyMissing === false).length;
    result.passes.pass3.blankFramesWhilePausedInWindow = scrubChunk.samples
        .filter(sample => !sample.playing && sample.t >= telopWindow.start && sample.t < telopWindow.end
            && !sample.videoVisible && !sample.placeholderVisible).length;

    result.consoleWarnings = finder.consoleLog
        .filter(entry => ['warning', 'error'].includes(entry.type))
        .slice(0, 40);
    result.electronStderr = sanitizeText(stderrChunks.join('')).split('\n')
        .filter(line => /error|fail|警告/i.test(line)).slice(0, 20);
} catch (error) {
    result.errors.push({ fatal: sanitizeText(error?.stack ?? error?.message ?? String(error)) });
} finally {
    try { main?.close(); } catch { /* already closed */ }
    try { browserCdp?.close(); } catch { /* already closed */ }
    if (child?.pid) {
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
        await sleep(1200);
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
}

await writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(sanitizeValue(result), null, 2)}\n`, 'utf8');
console.log(JSON.stringify(sanitizeValue(result), null, 2));
for (const directory of [workspaceDir, profileDir, configDir]) {
    await rm(directory, { recursive: true, force: true });
}
if (result.errors.length > 0) process.exitCode = 1;
