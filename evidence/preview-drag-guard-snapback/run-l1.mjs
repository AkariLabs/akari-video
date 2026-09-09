#!/usr/bin/env node

// L1 (task 2026-09-09-preview-drag-guard-snapback): 実機 Electron を起動し、出力プレビュー上で
//   (a) 同じ cut を 20 回連続で移動し、1 回も元に戻らないこと
//   (b) ドラッグ中に外部から edit.json を書き換えても戻らないこと
//   (c) v2 プロジェクトでクロップが確定すること
//   (d) v1 プロジェクトでクロップ不可の 1 文が出ること
// を実測する。BEFORE/AFTER で同じスクリプトを流し、JSON と PNG を突き合わせる。
//
// 使い方: node dev-fixtures/preview-drag-guard-snapback/run-l1.mjs --label after --out <dir>

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const ffmpeg = path.join(repoRoot, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

const args = process.argv.slice(2);
const label = args[args.indexOf('--label') + 1] || 'after';
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(os.tmpdir(), `akari-l1-${label}`);
const basePort = Number(process.env.AKARI_CDP_PORT ?? 9412);

await stat(electron);
await stat(ffmpeg);
await mkdir(outDir, { recursive: true });

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-drag-guard-')));
const akariHome = path.join(scratch, 'akari-home');
await mkdir(akariHome, { recursive: true });

// ---------------------------------------------------------------- CDP client
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
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
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }
      }, 30000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression, contextId, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
    ...(contextId === undefined ? {} : { contextId }),
  }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await (await fetch(url)).json(); if (predicate(value)) return value; } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const collectedContexts = [];
function watchContexts(browser) {
  browser.on('Runtime.executionContextCreated', (params, sessionId) => {
    collectedContexts.push({
      sessionId,
      contextId: params.context.id,
      frameId: params.context.auxData?.frameId,
      isDefault: params.context.auxData?.isDefault === true,
    });
  });
}

async function findPreviewView(browser, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type)) continue;
      if (!String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        await browser.send('Page.enable', {}, sessionId).catch(() => undefined);
        const tree = await browser.send('Page.getFrameTree', {}, sessionId);
        const frames = [];
        (function walk(node) { frames.push(node.frame); (node.childFrames ?? []).forEach(walk); })(tree.frameTree);
        // 各フレームの main world（isDefault コンテキスト）を優先する。
        // window.akari 越しの観測ができるのは main world だけ。
        await browser.send('Runtime.enable', {}, sessionId).catch(() => undefined);
        await sleep(300);
        for (const frame of frames) {
          const context = collectedContexts.find(entry => entry.sessionId === sessionId
            && entry.frameId === frame.id && entry.isDefault);
          if (!context) continue;
          try {
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle') && window.akari)`,
              context.contextId, sessionId);
            if (hit) return { sessionId, contextId: context.contextId };
          } catch { /* context gone */ }
        }
        for (const frame of frames) {
          try {
            const world = await browser.send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'akari-l1' }, sessionId);
            const hit = await evaluate(browser,
              `Boolean(document.getElementById('preview-layers') && document.getElementById('play-toggle'))`,
              world.executionContextId, sessionId);
            if (hit) return { sessionId, contextId: world.executionContextId, isolated: true };
          } catch { /* frame gone */ }
        }
      } catch { /* target changed */ }
    }
    await sleep(500);
  }
  throw new Error('preview webview context not found');
}

async function executeCommand(main, command, argument) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      const value = await window.theia.container.get(CommandClass)
        .executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argument)});
      return { ok: true, value: typeof value === 'string' ? value : null };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function activatePreview(main) {
  return evaluate(main, `(() => {
    const label = [...document.querySelectorAll('[class*="TabBar-tabLabel"]')]
      .find(node => node.textContent?.trim() === '出力プレビュー');
    if (!label) return false;
    label.click();
    return true;
  })()`);
}

async function capture(mainCdp, browserCdp, view, name) {
  try {
    const inner = await evaluate(browserCdp, `(() => {
      const stage = document.getElementById('preview-layers').getBoundingClientRect();
      return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
    })()`, view.contextId, view.sessionId);
    const outer = await evaluate(mainCdp, `(() => {
      const frame = document.querySelector('iframe');
      const rect = frame ? frame.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    // ステージだけを切ると通知バー（#write-error-banner）が写らないので、
    // プレビュー widget の iframe 全体を撮る。inner はステージ位置の妥当性確認にだけ使う。
    void inner;
    const clip = { x: outer.x, y: outer.y, width: outer.width, height: outer.height, scale: 1 };
    const shot = await mainCdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
    await writeFile(path.join(outDir, `${label}-${name}.png`), Buffer.from(shot.data, 'base64'));
    return `${label}-${name}.png`;
  } catch (error) { return `capture-failed: ${error?.message ?? error}`; }
}

// -------------------------------------------------------- webview 内の操作ヘルパ
// 合成 PointerEvent を isolated world から撒く（main world のリスナーへ届く）。
const DRIVER = `
window.__akariL1 = window.__akariL1 || (() => {
  const stage = () => document.getElementById('preview-layers');
  const rectOf = element => element.getBoundingClientRect();
  const pointer = (type, x, y, extra = {}) => new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'mouse',
    button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, shiftKey: true, ...extra,
  });
  // 選択後の cut の正本 dataset は closure 内の proxy 要素なので DOM からは読めない。
  // 代わりに #cut-select-box の画面位置（updateCutSelectBox が transform から引く）を観測値にする。
  const cutState = () => {
    const video = document.getElementById('preview-video');
    const box = document.getElementById('cut-select-box');
    const boxRect = box ? box.getBoundingClientRect() : null;
    const stageRect = document.getElementById('preview-layers')?.getBoundingClientRect() ?? null;
    return {
      cutIndex: video?.dataset.akariCutIndex ?? '',
      cutId: video?.dataset.akariCutId ?? '',
      x: Number(video?.dataset.akariTransformX ?? NaN),
      y: Number(video?.dataset.akariTransformY ?? NaN),
      boxX: boxRect && stageRect ? Number((boxRect.x - stageRect.x).toFixed(2)) : null,
      boxY: boxRect && stageRect ? Number((boxRect.y - stageRect.y).toFixed(2)) : null,
      boxW: boxRect ? Number(boxRect.width.toFixed(2)) : null,
      selected: box?.classList.contains('is-active') ?? false,
      banner: document.getElementById('write-error-banner')?.hidden === false
        ? (document.getElementById('write-error-message')?.textContent ?? '') : null,
    };
  };
  return {
    cutState,
    dismissBanner: () => { const b = document.getElementById('write-error-dismiss'); if (b) b.click(); return true; },
    seek: time => { window.postMessage({ type: 'akari-preview-seek', time }, '*'); return true; },
    // V2 の重なりクリップ（中央 50%）を避け、下の cut だけが居る左側 12% を掴む。
    down: () => {
      // #preview-layers（台紙）へ撒くと選択解除の経路に入る。実体（legacy video）へ撒く。
      const media = document.getElementById('preview-video');
      const rect = rectOf(media);
      const x = rect.x + rect.width * 0.12, y = rect.y + rect.height / 2;
      window.__akariL1Origin = { x, y };
      media.dispatchEvent(pointer('pointerdown', x, y));
      return cutState();
    },
    move: dx => {
      const o = window.__akariL1Origin;
      window.dispatchEvent(pointer('pointermove', o.x + dx, o.y));
      return cutState();
    },
    up: dx => {
      const o = window.__akariL1Origin;
      window.dispatchEvent(pointer('pointerup', o.x + dx, o.y));
      return cutState();
    },
    cropDown: dir => {
      const handle = document.querySelector('#cut-select-box [data-akari-crop-edge="' + dir + '"]');
      if (!handle) return { error: 'no crop handle' };
      const rect = rectOf(handle);
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      window.__akariL1Origin = { x, y };
      handle.dispatchEvent(pointer('pointerdown', x, y));
      return cutState();
    },
    spySelection: () => {
      if (!window.akari || window.__akariL1Spy) return Boolean(window.__akariL1Spy);
      window.__akariL1Spy = { cutSelection: [], writes: [] };
      const original = window.akari.reportCutSelection;
      window.akari.reportCutSelection = id => { window.__akariL1Spy.cutSelection.push(id); return original?.(id); };
      const cutWrite = window.akari.engine?.cutWrite;
      if (cutWrite) window.akari.engine.cutWrite = (...a) => {
        window.__akariL1Spy.writes.push({ kind: 'cut', index: a[0], id: a[1], patch: a[2] });
        return cutWrite.apply(window.akari.engine, a);
      };
      const layerWrite = window.akari.engine?.layerWrite;
      if (layerWrite) window.akari.engine.layerWrite = (...a) => {
        window.__akariL1Spy.writes.push({ kind: 'layer', args: a.slice(0, 2) });
        return layerWrite.apply(window.akari.engine, a);
      };
      return true;
    },
    spy: () => window.__akariL1Spy ?? null,
    summary: () => {
      const s = window.akari?.state?.summary;
      if (!s) return null;
      return {
        editVersion: s.editVersion,
        cuts: (s.cuts ?? []).map(c => ({ id: c.id, track: c.track, at: c.at, in: c.in, out: c.out })),
        layers: (s.layers ?? []).map(l => ({ id: l.id, trackId: l.trackId })),
      };
    },
    probe: () => {
      const video = document.getElementById('preview-video');
      const st = stage();
      const sr = rectOf(st), vr = video ? rectOf(video) : null;
      const cx = sr.x + sr.width / 2, cy = sr.y + sr.height / 2;
      const cs = video ? getComputedStyle(video) : null;
      return {
        stageRect: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
        videoRect: vr ? { x: vr.x, y: vr.y, w: vr.width, h: vr.height } : null,
        videoDisplay: cs?.display, videoVisibility: cs?.visibility, videoOpacity: cs?.opacity,
        elementsAtCenter: document.elementsFromPoint(cx, cy).slice(0, 6).map(e => e.id || e.tagName + (e.dataset?.akariLayerId ? ':' + e.dataset.akariLayerId : '')),
        canvas: Boolean(document.getElementById('frame-engine-canvas')),
        selectBox: document.getElementById('cut-select-box')?.className ?? null,
        playing: document.getElementById('play-toggle')?.textContent ?? null,
      };
    },
    selectLayerById: id => {
      window.postMessage({ type: 'akari-preview-select-layer', layerId: id }, '*');
      return true;
    },
    layerState: id => {
      const media = document.querySelector('[data-akari-layer-id="' + id + '"]');
      const box = document.getElementById('layer-select-box');
      const boxRect = box ? box.getBoundingClientRect() : null;
      const stageRect = document.getElementById('preview-layers')?.getBoundingClientRect() ?? null;
      return {
        x: Number(media?.dataset.akariTransformX ?? NaN),
        y: Number(media?.dataset.akariTransformY ?? NaN),
        boxX: boxRect && stageRect ? Number((boxRect.x - stageRect.x).toFixed(2)) : null,
        boxW: boxRect ? Number(boxRect.width.toFixed(2)) : null,
        selected: box?.classList.contains('is-active') ?? false,
      };
    },
    layerDown: id => {
      const box = document.getElementById('layer-select-box');
      const rect = rectOf(box);
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      window.__akariL1Origin = { x, y };
      box.dispatchEvent(pointer('pointerdown', x, y));
      return { origin: window.__akariL1Origin };
    },
    cropHandleVisible: dir => {
      const handle = document.querySelector('#cut-select-box [data-akari-crop-edge="' + dir + '"]');
      if (!handle) return false;
      const rect = rectOf(handle);
      return rect.width > 0 && rect.height > 0;
    },
  };
})();
`;

async function drive(browser, view, call) {
  return evaluate(browser, `${DRIVER}; JSON.stringify(window.__akariL1.${call})`, view.contextId, view.sessionId)
    .then(text => JSON.parse(text));
}

// ---------------------------------------------------------------- fixture 生成
function makeVideo(file, color) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:d=12:r=30`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

const editV2 = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'base', path: 'base.mp4', proxy: null }, { id: 'over', path: 'over.mp4', proxy: null }],
  tracks: [
    { id: 'v1', lane: 'visual', name: 'V1 — base', items: [{ id: 'base-item', at: 0, duration: 360,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 }, source: { kind: 'media', src: 'base', in: 0, out: 12 } }] },
    { id: 'v2', lane: 'visual', name: 'V2 — overlap', items: [{ id: 'over-item', at: 0, duration: 360,
      transform: { x: 0, y: 0, scale: 0.5, rotate: 0 }, source: { kind: 'media', src: 'over', in: 0, out: 12 } }] },
  ],
};

const editV1 = {
  version: 1,
  output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'base', path: 'base.mp4', proxy: null }, { id: 'over', path: 'over.mp4', proxy: null }],
  cuts: [{ id: 'base-cut', src: 'base', in: 0, out: 12 }],
  layers: [{ id: 'over-layer', t: 0, duration: 12, kind: 'video', src: 'over.mp4',
    transform: { x: 0, y: 0, scale: 0.5, rotate: 0 }, track: 10 }],
  overlays: [],
};

async function makeProject(name, edit) {
  const dir = path.join(scratch, name);
  await mkdir(path.join(dir, '.akari'), { recursive: true });
  await writeFile(path.join(dir, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  makeVideo(path.join(dir, 'base.mp4'), 'red');
  makeVideo(path.join(dir, 'over.mp4'), 'green');
  await writeFile(path.join(dir, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  return dir;
}

// ---------------------------------------------------------------- 起動 / 後始末
async function withShell(projectDir, port, body) {
  const profile = path.join(scratch, `profile-${port}`);
  const config = path.join(scratch, `config-${port}`);
  await mkdir(profile, { recursive: true });
  await mkdir(config, { recursive: true });
  const child = spawn(electron, [shellDir, projectDir, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome },
    stdio: 'ignore',
  });
  let main; let browser;
  try {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, values => values.find(v => v.type === 'page'));
    const target = targets.find(v => v.type === 'page' && !v.url.startsWith('devtools:'));
    main = new CDP(target.webSocketDebuggerUrl);
    await main.connect();
    const consoleLog = [];
    main.on('Runtime.consoleAPICalled', params => {
      if (params.type !== 'error' && params.type !== 'warning') return;
      consoleLog.push(params.args.map(a => String(a.value ?? a.description ?? a.type)).join(' ').slice(0, 400));
    });
    await main.send('Runtime.enable');
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, v => v.webSocketDebuggerUrl);
    browser = new CDP(version.webSocketDebuggerUrl);
    await browser.connect();
    await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
    collectedContexts.length = 0;
    watchContexts(browser);

    await sleep(10000);
    const editUri = pathToFileURL(path.join(projectDir, 'edit.json')).href;
    let view;
    let lastOpened;
    const deadline = Date.now() + 180000;
    while (!view && Date.now() < deadline) {
      await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
      lastOpened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
      if (!lastOpened.ok) { await sleep(2000); continue; }
      await sleep(3000);
      await activatePreview(main);
      view = await findPreviewView(browser, 20000).catch(() => undefined);
    }
    if (!view) {
      const diagnostics = {
        opened: lastOpened,
        tabs: await evaluate(main, `[...document.querySelectorAll('[class*="TabBar-tabLabel"]')].map(n => n.textContent?.trim())`).catch(e => String(e)),
        targets: (await browser.send('Target.getTargets').catch(() => ({ targetInfos: [] }))).targetInfos
          .map(t => ({ type: t.type, url: String(t.url).slice(0, 90) })),
        body: await evaluate(main, `(document.body?.innerText ?? '').slice(0, 900)`).catch(e => String(e)),
        console: consoleLog.slice(-25),
      };
      await writeFile(path.join(outDir, `${label}-diagnostics.json`), JSON.stringify(diagnostics, null, 2) + '\n');
      const shot = await main.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).catch(() => null);
      if (shot) await writeFile(path.join(outDir, `${label}-diagnostics.png`), Buffer.from(shot.data, 'base64'));
      throw new Error('preview did not activate: ' + JSON.stringify(diagnostics).slice(0, 1200));
    }
    return await body({ main, browser, view, projectDir, profile });
  } finally {
    main?.close();
    browser?.close();
    if (child?.pid) {
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* exited */ }
      await sleep(1500);
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* exited */ }
      await sleep(500);
    }
  }
}

const readEdit = async dir => JSON.parse(await readFile(path.join(dir, 'edit.json'), 'utf8'));
const cutTransformOf = edit => edit.version === 2
  ? edit.tracks.find(track => track.id === 'v1').items[0].transform
  : (edit.cuts[0].transform ?? { x: 0, y: 0 });
const cutCropOf = edit => edit.version === 2
  ? (edit.tracks.find(track => track.id === 'v1').items[0].crop ?? null)
  : (edit.cuts[0].crop ?? null);

async function waitForDiskX(dir, previous, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = previous;
  while (Date.now() < deadline) {
    try { last = cutTransformOf(await readEdit(dir)).x; if (last !== previous) return last; } catch { /* mid-write */ }
    await sleep(80);
  }
  return last;
}

// ---------------------------------------------------------------------- 本体
const report = { label, scenarios: {} };
const v2Dir = await makeProject('project-v2', editV2);
const v1Dir = await makeProject('project-v1', editV1);

try {
  await withShell(v2Dir, basePort, async ({ main, browser, view }) => {
    await drive(browser, view, 'spySelection()');
    await drive(browser, view, 'seek(4)');
    await sleep(1500);
    report.summary = await drive(browser, view, 'summary()');

    const writeCount = async () => (await drive(browser, view, 'spy()'))?.writes.length ?? 0;
    const waitForWrite = async (from, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await writeCount() > from) return true;
        await sleep(80);
      }
      return false;
    };
    const ensureSelected = async () => {
      let state = await drive(browser, view, 'cutState()');
      for (let attempt = 0; attempt < 6 && !state.selected; attempt += 1) {
        await drive(browser, view, 'down()');
        await sleep(120);
        await drive(browser, view, 'up(0)');
        await sleep(400);
        state = await drive(browser, view, 'cutState()');
      }
      return state;
    };

    const selected = await ensureSelected();
    report.scenarios.selection = selected;
    if (!selected.selected) throw new Error(`cut not selected: ${JSON.stringify(selected)}`);
    report.shots = { start: await capture(main, browser, view, 'a-00-start') };

    // (a) 20 回連続移動。書き込み → refresh が着地する前に次のドラッグへ入る。
    const moves = [];
    let diskX = cutTransformOf(await readEdit(v2Dir)).x;
    for (let index = 0; index < 20; index += 1) {
      const before = await drive(browser, view, 'cutState()');
      const writes0 = await writeCount();
      const onDown = await drive(browser, view, 'down()');
      await drive(browser, view, 'move(12)');
      const dragged = await drive(browser, view, 'move(12)');
      await drive(browser, view, 'up(12)');
      const wrote = await waitForWrite(writes0);
      const afterUp = await drive(browser, view, 'cutState()');
      const nextDisk = await waitForDiskX(v2Dir, diskX);
      moves.push({
        index,
        selectedBefore: before.selected, selectedOnDown: onDown.selected,
        boxOnDown: onDown.boxX,
        boxBefore: before.boxX, boxDuringDrag: dragged.boxX, boxAfterUp: afterUp.boxX,
        selectedAfterUp: afterUp.selected,
        dragTook: dragged.boxX !== null && before.boxX !== null && dragged.boxX > before.boxX + 1,
        wrote, diskBefore: diskX, disk: nextDisk, committed: nextDisk > diskX + 0.5,
      });
      diskX = nextDisk;
      await sleep(60); // refresh を待たずに次へ（BEFORE の上書きを踏ませる間隔）
    }
    report.scenarios.a = {
      moves,
      dragsThatDidNotStart: moves.filter(m => !m.dragTook).length,
      dragsNotCommitted: moves.filter(m => m.dragTook && !m.committed).length,
      snapbackToPrevious: moves.filter(m => m.dragTook && m.wrote && !m.committed).length,
      strictlyIncreasing: moves.every((m, i) => i === 0 || m.disk > moves[i - 1].disk),
      finalDisk: diskX,
    };
    report.shots.afterTwenty = await capture(main, browser, view, 'a-20-after');

    // (b) ドラッグ中に外部から edit.json を書き換える。
    // 同一バイトの再書き込みだとモデル差分が none になり refresh が webview へ届かないので、
    // 実際にモデルが変わる編集（cut の transform.y）を外部から入れて DOM 上書き経路を踏ませる。
    await ensureSelected();
    const writesB = await writeCount();
    const beforeB = await drive(browser, view, 'cutState()');
    await drive(browser, view, 'down()');
    await drive(browser, view, 'move(24)');
    const draggedB = await drive(browser, view, 'move(24)');
    const externalEdit = await readEdit(v2Dir);
    const externalY = 40;
    externalEdit.tracks.find(track => track.id === 'v1').items[0].transform.y = externalY;
    await writeFile(path.join(v2Dir, 'edit.json'), JSON.stringify(externalEdit, null, 2) + '\n');
    await sleep(2500);                                          // watcher → queueRefresh が着地する時間
    const duringB = await drive(browser, view, 'cutState()');
    report.shots = { ...report.shots, bDuringExternalWrite: await capture(main, browser, view, 'b-during-external-write') };
    await drive(browser, view, 'up(24)');
    const wroteB = await waitForWrite(writesB);
    const diskB = await waitForDiskX(v2Dir, externalEdit.tracks.find(t => t.id === 'v1').items[0].transform.x);
    report.scenarios.b = {
      externalWrite: { field: 'cuts[0].transform.y', value: externalY },
      boxBefore: beforeB.boxX, boxAfterDrag: draggedB.boxX, boxDuringExternalWrite: duringB.boxX,
      dragTook: draggedB.boxX > beforeB.boxX + 1,
      heldThroughExternalWrite: duringB.boxX !== null && draggedB.boxX !== null
        && Math.abs(duringB.boxX - draggedB.boxX) < 1.5,
      wrote: wroteB, diskBefore: diskX, disk: diskB, committed: diskB > diskX + 0.5,
      snapback: wroteB && !(diskB > diskX + 0.5),
    };
    diskX = diskB;
    report.shots.externalWrite = await capture(main, browser, view, 'b-external-write');

    // (c) v2 のクロップ確定
    await ensureSelected();
    const cropVisible = await drive(browser, view, 'cropHandleVisible("e")');
    const beforeCrop = cutCropOf(await readEdit(v2Dir));
    const writesC = await writeCount();
    const cropDown = await drive(browser, view, 'cropDown("e")');
    await drive(browser, view, 'move(-30)');
    await drive(browser, view, 'move(-30)');
    await drive(browser, view, 'up(-30)');
    const wroteC = await waitForWrite(writesC, 8000);
    await sleep(1500);
    const afterCrop = cutCropOf(await readEdit(v2Dir));
    const cropState = await drive(browser, view, 'cutState()');
    report.scenarios.c = {
      handleVisible: cropVisible, selectedAtCropDown: cropDown.selected, wrote: wroteC,
      before: beforeCrop, after: afterCrop, banner: cropState.banner,
      committed: Boolean(afterCrop) && afterCrop.w < 0.999,
    };
    report.shots.crop = await capture(main, browser, view, 'c-crop');

    // (e) レイヤー（V2 の重なりクリップ）を掴んだまま外部でモデルが変わる edit.json を書く。
    // applyIncrementalLayerSpec は layer の dataset（= pointerup が読む値）へ直接書くので、
    // 保護が無いと確定値が外部モデルの古い x へ戻る（= オーナー報告の「動かしたのに戻る」）。
    const layerId = 'over-item';
    const layerDiskX = () => (async () => {
      const edit = await readEdit(v2Dir);
      return edit.tracks.find(track => track.id === 'v2').items[0].transform.x;
    })();
    await drive(browser, view, `selectLayerById(${JSON.stringify(layerId)})`);
    await sleep(1200);
    const layerSelected = await drive(browser, view, `layerState(${JSON.stringify(layerId)})`);
    const writesE = await writeCount();
    const diskE0 = await layerDiskX();
    await drive(browser, view, `layerDown(${JSON.stringify(layerId)})`);
    await drive(browser, view, 'move(24)');
    const draggedE = await drive(browser, view, `layerState(${JSON.stringify(layerId)})`);
    const externalE = await readEdit(v2Dir);
    externalE.tracks.find(track => track.id === 'v1').items[0].transform.y = 60;
    await writeFile(path.join(v2Dir, 'edit.json'), JSON.stringify(externalE, null, 2) + '\n');
    await sleep(2500);
    const duringE = await drive(browser, view, `layerState(${JSON.stringify(layerId)})`);
    report.shots = { ...report.shots, eDuringExternalWrite: await capture(main, browser, view, 'e-during-external-write') };
    await drive(browser, view, 'up(24)');
    const wroteE = await waitForWrite(writesE, 8000);
    await sleep(2000);
    const diskE1 = await layerDiskX();
    report.scenarios.e = {
      layerSelected: layerSelected.selected,
      domBeforeDrag: layerSelected.x, domAfterDrag: draggedE.x, domDuringExternalWrite: duringE.x,
      dragTook: draggedE.x > layerSelected.x + 1,
      heldThroughExternalWrite: Number.isFinite(duringE.x) && Number.isFinite(draggedE.x)
        && Math.abs(duringE.x - draggedE.x) < 1.5,
      wrote: wroteE, diskBefore: diskE0, disk: diskE1, committed: diskE1 > diskE0 + 0.5,
      snapback: wroteE && !(diskE1 > diskE0 + 0.5),
    };
    report.shots.layerExternalWrite = await capture(main, browser, view, 'e-layer-external-write');
  });

  await withShell(v1Dir, basePort + 1, async ({ main, browser, view }) => {
    await drive(browser, view, 'seek(4)');
    await sleep(1500);
    await drive(browser, view, 'down()');
    await drive(browser, view, 'up(0)');
    await sleep(1200);
    const state = await drive(browser, view, 'cutState()');
    const cropVisible = await drive(browser, view, 'cropHandleVisible("e")');
    report.scenarios.d = {
      selected: state.selected, banner: state.banner, cropHandleVisible: cropVisible,
      noticeShown: typeof state.banner === 'string' && state.banner.includes('v1'),
    };
    report.shots = { ...report.shots, v1Notice: await capture(main, browser, view, 'd-v1-notice') };
  });
} finally {
  await writeFile(path.join(outDir, `${label}-l1.json`), JSON.stringify(report, null, 2) + '\n');
  await rm(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));
