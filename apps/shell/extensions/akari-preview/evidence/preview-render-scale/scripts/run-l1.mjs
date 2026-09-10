#!/usr/bin/env node
/**
 * L1（実機 Electron）— shell の frame-engine プレビューが、合成用 canvas の内部画素数を
 * 表示サイズ相応（render scale）へ落としても構図が変わらないことを実測する。
 *
 *  (a) AKARI_FRAME_ENGINE_RENDER_SCALE=1 と既定 auto で各 30 秒再生し、`fps (presented/1s)` の
 *      中央値・`late frame` 増分・計測パネルの `render scale` 行を JSON に記録する
 *  (b) 同じ時刻 T で s=1 と s=auto の canvas を toDataURL で取り、等倍側を auto の寸法へ縮小して
 *      MAD（frame-diff.ts の meanAbsoluteDelta と同じ定義 = RGBA 全バイトの平均絶対差）を出す。
 *      DOM 層（字幕 / overlay）の矩形が s に依らず同じ位置（±1 CSS px）であることも記録する
 *  (c) auto で再生停止 → 300 ms 後にパネルが `render scale 1` に戻り、再生でまた auto 値に戻る
 *  (d) auto のまま PiP レイヤーをプレビュー上でクリック選択 → インスペクターで X を変える →
 *      プレビュー（レイヤー矩形・canvas 画素）と edit.json が追従する
 *  (e) 同じプロジェクトを render-cut --engine gpu で書き出し、ffprobe で output どおりの寸法を確認。
 *      receipt / render.json / ログに render scale の語が出ない
 *
 * 隔離: HOME / AKARI_HOME / AKARI_CREDENTIALS_FILE / THEIA_CONFIG_DIR / --user-data-dir /
 * ワークスペースはすべて mktemp 配下。本物の ~/.theia ~/.akari ~/.config/akari-video には触らない。
 * Electron は detached にせず、同時に 1 本まで。計測ごとに PID 指名で kill し、残存 0 件を確認する。
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 */
import assert from 'node:assert/strict';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../../../../..');
const shellRoot = path.join(repoRoot, 'apps/shell');
const stripHarness = path.join(shellRoot, 'extensions/akari-shell-strip/evidence/quick-export-one-click');
const bootScripts = path.join(shellRoot, 'extensions/akari-preview/evidence/frame-engine-boot/scripts');
const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');

const OUTPUT = 2160;
const FPS = 30;
const DURATION_S = 20;
const PIP_SCALE = 0.45;
const PIP_OFFSET = Math.round(OUTPUT / 2 - (OUTPUT * PIP_SCALE) / 2 - 60); // 右下（余白 60px）
const PROBE_T = 10; // cut 途中・PiP 表示中・字幕 c-0002（8–12 s）表示中
const PLAY_SECONDS = 30;
const WINDOW = { width: 1280, height: 900 };
const NEW_PIP_X = PIP_OFFSET - 200;
const args = process.argv.slice(2);
const skipExport = args.includes('--skip-export');
const onlySession = (args.find(a => a.startsWith('--only=')) ?? '').slice('--only='.length);

const { CDP, evalOn, listTargets, waitFor } = await import(path.join(bootScripts, 'cdp-lib.mjs'));
const { assertNoOrphans, connectAndWaitReady, installErrorCounter, errorLog, sleep, evalMain, realClick }
  = await import(path.join(stripHarness, 'harness.mjs'));
// Electron 実体はリポ直下または apps/shell の node_modules（司令塔が同期した方）を使う。detached にしない。
const ELECTRON_BIN = [path.join(repoRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  path.join(shellRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')].find(candidate => fs.existsSync(candidate));
assert.ok(ELECTRON_BIN, 'Electron binary not found');
const launchElectron = ({ workspaceDir, cdpPort, userDataDir, themeConfigDir, logPath }) => {
  const child = spawn(ELECTRON_BIN, [shellRoot, workspaceDir, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`,
    '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  { detached: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, THEIA_CONFIG_DIR: themeConfigDir } });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk.toString(); });
  child.stderr.on('data', chunk => { log += chunk.toString(); });
  child.on('error', error => { log += `\n[spawn error] ${error}`; });
  process.on('exit', () => { try { fs.writeFileSync(logPath, log); } catch { /* best effort */ } });
  return child;
};

// ------------------------------------------------------------------ fixture
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-render-scale-')));
const project = path.join(work, 'project');
const fakeHome = path.join(work, 'home');
const akariHome = path.join(work, 'akari-home');
const credentials = path.join(work, 'credentials.env');
for (const dir of [fakeHome, akariHome]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(credentials, '');
fs.cpSync(path.join(repoRoot, 'templates/project-default'), project, { recursive: true });
fs.rmSync(path.join(project, 'README.md'), { force: true });
for (const dir of ['assets', 'overlays', 'exports']) fs.mkdirSync(path.join(project, dir), { recursive: true });

const ffmpeg = (fargs) => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...fargs], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', String(FPS), '-movflags', '+faststart'];
console.log('[fixture] encoding 2160x2160 sources…');
const fixtureStarted = Date.now();
ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${OUTPUT}x${OUTPUT}:rate=${FPS}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', String(DURATION_S), ...encode, '-c:a', 'aac', '-b:a', '128k', '-shortest', path.join(project, 'assets/s1.mp4')]);
ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${OUTPUT}x${OUTPUT}:rate=${FPS}`, '-vf', 'hue=h=150', '-t', String(DURATION_S),
  ...encode, '-an', path.join(project, 'assets/s2.mp4')]);
console.log(`[fixture] encoded in ${((Date.now() - fixtureStarted) / 1000).toFixed(1)} s`);

const edit = {
  version: 2,
  output: { width: OUTPUT, height: OUTPUT, fps: FPS },
  sources: [{ id: 's1', path: 'assets/s1.mp4' }, { id: 's2', path: 'assets/s2.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [
      { id: 'base', at: 0, duration: DURATION_S * FPS, source: { kind: 'media', src: 's1', in: 0, out: DURATION_S } }] },
    { id: 'v-pip', lane: 'visual', items: [
      { id: 'pip', at: 0, duration: DURATION_S * FPS, transform: { x: PIP_OFFSET, y: PIP_OFFSET, scale: PIP_SCALE }, opacity: 0.9,
        source: { kind: 'media', src: 's2', in: 0, out: DURATION_S } }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
    { id: 'v-overlay', lane: 'visual', items: [
      { id: 'badge', at: 0, duration: DURATION_S * FPS, source: { kind: 'html', path: 'overlays/badge.html' } }] }
  ]
};
const editPath = path.join(project, 'edit.json');
fs.writeFileSync(editPath, `${JSON.stringify(edit, null, 2)}\n`);
fs.writeFileSync(path.join(project, 'captions.json'), `${JSON.stringify({ captions: [
  { id: 'c-0001', src: 's1', start: 2, end: 5, text: 'render scale probe one', speaker: null, sourceRef: null, edited: false },
  { id: 'c-0002', src: 's1', start: 8, end: 12, text: 'render scale probe two', speaker: null, sourceRef: null, edited: false }
] }, null, 2)}\n`);
fs.writeFileSync(path.join(project, 'overlays/badge.html'),
  `<div style="width:${OUTPUT}px;height:${OUTPUT}px;position:relative">`
  + '<div style="position:absolute;left:120px;top:120px;width:400px;height:200px;background:#0080ff"></div></div>\n');

// ------------------------------------------------------------------ helpers
const report = { fixture: { output: edit.output, pip: edit.tracks[1].items[0], probeT: PROBE_T, playSeconds: PLAY_SECONDS, window: WINDOW }, sessions: {} };
const scrub = value => String(value)
  .split(repoRoot).join('<WORKTREE>').split(work).join('<TMP>')
  .split(fs.realpathSync(os.tmpdir())).join('<TMP>').split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');
const psCount = needle => {
  const out = execSync(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(needle)} | grep -v grep || true`, { encoding: 'utf8' }).trim();
  return out ? out.split('\n').length : 0;
};
const parseScaleLine = text => {
  const match = /render scale\s+(\S+)\s+\((\d+)x(\d+) of (\d+)x(\d+), ([^)]+)\)/u.exec(text ?? '');
  return match ? { scale: Number(match[1]), width: Number(match[2]), height: Number(match[3]),
    outputWidth: Number(match[4]), outputHeight: Number(match[5]), mode: match[6], raw: match[0] } : null;
};
const median = values => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const decodeRgba = (png, width, height) => {
  const args2 = ['-v', 'error', '-i', png];
  if (width && height) args2.push('-vf', `scale=${width}:${height}:flags=area`);
  args2.push('-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1');
  const out = spawnSync(FFMPEG, args2, { maxBuffer: 1 << 30 });
  assert.equal(out.status, 0, String(out.stderr));
  return out.stdout;
};
const pngSize = png => {
  const out = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png], { encoding: 'utf8' });
  const [w, h] = out.stdout.trim().split(',').map(Number);
  return { width: w, height: h };
};
// packages/frame-engine/src/metrics/frame-diff.ts compareRgba と同じ定義（RGBA 全バイトの平均絶対差）
const compareRgba = (left, right) => {
  assert.equal(left.length, right.length, 'rgba length');
  let differingPixels = 0; let maxDelta = 0; let sum = 0; let sumRgb = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    let differs = false;
    for (let c = 0; c < 4; c += 1) {
      const delta = Math.abs(left[offset + c] - right[offset + c]);
      if (delta) differs = true;
      if (delta > maxDelta) maxDelta = delta;
      sum += delta;
      if (c < 3) sumRgb += delta;
    }
    if (differs) differingPixels += 1;
  }
  const pixels = left.length / 4;
  return { pixels, differingPixels, differingRatio: differingPixels / pixels, maxDelta,
    meanAbsoluteDelta: sum / left.length, meanAbsoluteDeltaRgb: sumRgb / (pixels * 3) };
};
const regionMad = (left, right, width, region) => {
  let sum = 0; let count = 0;
  for (let y = region.y0; y < region.y1; y += 1) for (let x = region.x0; x < region.x1; x += 1) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c += 1) { sum += Math.abs(left[offset + c] - right[offset + c]); count += 1; }
  }
  return count ? sum / count : null;
};
const writeDataUrl = (dataUrl, file) => {
  fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  return file;
};

// webview（Theia の webview iframe）の実行コンテキストを探す
const findWebview = async (port) => {
  const target = await waitFor('webview target', async () => {
    const current = await listTargets(port);
    return current.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
  }, 90000);
  const view = new CDP(target.webSocketDebuggerUrl);
  await view.connect();
  const contexts = [];
  view.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await view.send('Page.enable');
  await view.send('Runtime.enable');
  let contextId;
  await waitFor('preview stage in webview', async () => {
    for (const candidate of [...contexts.map(c => c.id).reverse(), undefined]) {
      try {
        if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, candidate)) { contextId = candidate; return true; }
      } catch { /* try next */ }
    }
    return false;
  }, 90000);
  return { view, eval: (expression, timeout = 30000) => {
    const params = { expression, returnByValue: true, awaitPromise: true };
    if (contextId !== undefined) params.contextId = contextId;
    return view.send('Runtime.evaluate', params, timeout).then(r => {
      if (r.exceptionDetails) throw new Error(`webview eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 1200)}`);
      return r.result.value;
    });
  } };
};

const STATE_JS = `(() => {
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(2), top: +r.top.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) }; };
  const canvas = document.getElementById('frame-engine-canvas');
  const metrics = document.getElementById('frame-engine-metrics');
  const root = document.getElementById('frame-engine-preview');
  const layer = Array.from(document.querySelectorAll('[data-akari-layer-id]')).find(el => /pip/u.test(el.dataset.akariLayerId));
  const overlayFragment = document.querySelector('#overlay-stage [data-overlay-id] > *') || document.querySelector('[data-overlay-id] > *');
  return {
    ready: root ? root.dataset.frameEngineReady : null,
    devicePixelRatio: window.devicePixelRatio,
    canvasPixels: canvas ? { width: canvas.width, height: canvas.height } : null,
    canvasRect: rect(canvas),
    stageRect: rect(document.getElementById('preview-stage')),
    layerId: layer ? layer.dataset.akariLayerId : null,
    layerRect: rect(layer),
    captionRect: rect(document.getElementById('caption-plate')),
    captionText: document.getElementById('caption-plate') ? document.getElementById('caption-plate').textContent.trim() : null,
    overlayRect: rect(overlayFragment),
    metricsHidden: metrics ? metrics.hidden : null,
    metricsText: metrics ? metrics.textContent : null,
    fps: metrics ? Number(metrics.dataset.fps) : null,
    lateFrames: metrics ? Number(metrics.dataset.lateFrames) : null,
    renderErrors: metrics ? Number(metrics.dataset.renderErrors) : null,
    playing: document.getElementById('play-toggle') ? document.getElementById('play-toggle').getAttribute('aria-label') === '一時停止' : null,
    position: document.getElementById('seek') ? Number(document.getElementById('seek').value) : null,
    timeLabel: document.getElementById('time-label') ? document.getElementById('time-label').textContent : null,
    stageScale: typeof window.akari?.stageScale === 'function' ? window.akari.stageScale() : null,
    errorText: document.getElementById('frame-engine-error') ? document.getElementById('frame-engine-error').textContent : null
  };
})()`;

// 1 回の Runtime.evaluate の中で seek → 描画完了を待つ → 即 toDataURL（auto の停止時等倍描き直し 250 ms より前）
// → 700 ms 待って再 toDataURL（停止時等倍）を行う。CDP 往復を挟むと 250 ms に間に合わないため in-page で完結させる。
const CAPTURE_JS = t => `(async () => {
  const canvas = document.getElementById('frame-engine-canvas');
  const metrics = document.getElementById('frame-engine-metrics');
  const seek = document.getElementById('seek');
  const line = () => (metrics.textContent.split('\\n').find(l => l.startsWith('render scale')) || null);
  const stamp = () => metrics.dataset.seekMs + '|' + metrics.dataset.fps + '|' + metrics.dataset.lateFrames;
  const before = stamp();
  seek.value = ${JSON.stringify(String(t))};
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  const t0 = performance.now();
  while (stamp() === before && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 2));
  const waitedMs = performance.now() - t0;
  const first = { width: canvas.width, height: canvas.height, line: line(), waitedMs };
  const firstPng = canvas.toDataURL('image/png');
  first.encodeMs = performance.now() - t0 - waitedMs;
  await new Promise(r => setTimeout(r, 700));
  const second = { width: canvas.width, height: canvas.height, line: line() };
  const secondPng = canvas.toDataURL('image/png');
  return { first, second, firstPng, secondPng, seekValue: seek.value };
})()`;

// ------------------------------------------------------------------ session
let cdpPort = 9471;
async function runSession(label, env) {
  const userDataDir = path.join(work, `userdata-${label}`);
  const configDir = path.join(work, `theia-config-${label}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'settings.json'), `${JSON.stringify({ 'akari.developerMode': true }, null, 2)}\n`);
  const session = { label, env, steps: [], electronLog: path.join(work, `electron-${label}.log`) };
  report.sessions[label] = session;
  const note = (step, detail) => { session.steps.push({ step, detail }); console.log(`[${label}] ${step}`, JSON.stringify(detail)?.slice(0, 300)); };

  const savedEnv = { ...process.env };
  process.env.HOME = fakeHome;
  process.env.AKARI_HOME = akariHome;
  process.env.AKARI_CREDENTIALS_FILE = credentials;
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.AKARI_FRAME_ENGINE_RENDER_SCALE;
  Object.assign(process.env, env);
  cdpPort += 1;
  const child = launchElectron({ workspaceDir: project, cdpPort, userDataDir, themeConfigDir: configDir, logPath: session.electronLog });
  process.env = savedEnv;
  session.pid = child.pid;
  let main; let webview;
  try {
    main = await connectAndWaitReady(cdpPort);
    await installErrorCounter(main);
    // ウィンドウ幅 1280 相当・dpr 1（Retina 機でも表示画素数を固定して auto の判定を再現可能にする。
    // frame-engine-boot の L1 と同じく Emulation.setDeviceMetricsOverride で行う）
    await main.send('Emulation.setDeviceMetricsOverride', { width: WINDOW.width, height: WINDOW.height, deviceScaleFactor: 1, mobile: false });
    await sleep(1000);
    note('app-ready', { cdpPort, innerWidth: await evalMain(main, 'window.innerWidth'), dpr: await evalMain(main, 'window.devicePixelRatio') });

    const command = (id, argument) => evalMain(main, `(async () => {
      const container = window.theia.container;
      const key = [...container._bindingDictionary._map.keys()].find(entry => typeof entry === 'function' && entry.prototype?.executeCommand);
      return container.get(key).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(argument)});
    })()`, 60000);
    const editUri = `file://${editPath}`;
    note('ensureVisible', await command('akari.preview.ensureVisible', { editUri }));
    webview = await findWebview(cdpPort);
    if (await webview.eval('window.devicePixelRatio') !== 1) {
      await webview.view.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 1, mobile: false }).catch(() => {});
      await sleep(500);
    }
    await waitFor('frame-engine ready', async () => (await webview.eval(STATE_JS)).ready === 'true', 120000, 250);
    // タイムライン（akari-annotations）が開いてレイアウトが落ち着くまで待つ。レイヤー選択はタイムライン
    // widget 経由でインスペクターへ届くため、(d) の前提でもある。開いてこなければコマンドで開く。
    const timelineTab = `Boolean([...document.querySelectorAll('.p-TabBar-tabLabel, .lm-TabBar-tabLabel')].find(el => el.textContent.trim() === 'タイムライン' && el.getBoundingClientRect().width > 0))`;
    let timelineOpenedBy = 'auto';
    if (!await waitFor('timeline tab', () => evalMain(main, timelineTab), 20000, 500).catch(() => false)) {
      timelineOpenedBy = 'command';
      await command('akari.annotations.open', undefined).catch(() => null);
      await waitFor('timeline tab after command', () => evalMain(main, timelineTab), 30000, 500).catch(() => false);
    }
    let previousRect = null; let stableCount = 0;
    await waitFor('stable canvas rect', async () => {
      const rect = (await webview.eval(STATE_JS)).canvasRect;
      const same = previousRect && rect && Math.abs(rect.width - previousRect.width) < 0.5 && Math.abs(rect.left - previousRect.left) < 0.5 && Math.abs(rect.top - previousRect.top) < 0.5;
      stableCount = same ? stableCount + 1 : 0;
      previousRect = rect;
      return stableCount >= 2;
    }, 40000, 1000).catch(() => false);
    await sleep(500);
    const boot = await webview.eval(STATE_JS);
    session.timelineOpenedBy = timelineOpenedBy;
    session.boot = { ...boot, metricsText: undefined, scaleLine: parseScaleLine(boot.metricsText) };
    session.boot.renderScaleLineRaw = session.boot.scaleLine?.raw ?? null;
    note('frame-engine-ready', { dpr: boot.devicePixelRatio, canvasRect: boot.canvasRect, canvasPixels: boot.canvasPixels, scale: session.boot.scaleLine });
    const iframeRect = await evalMain(main, `(() => { const f = [...document.querySelectorAll('iframe')].find(e => e.src.includes('/webview/index.html'));
      if (!f) return null; const r = f.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    session.iframeRect = iframeRect;

    // ---- (b) 同じ時刻 T の canvas と DOM 層の矩形 ------------------------------------------
    // 直前の位置と同じフレームだと描画が走らないので、いったん別の時刻へ寄せてから T へ seek する
    await webview.eval(`(() => { const s = document.getElementById('seek'); s.value = ${PROBE_T - 1}; s.dispatchEvent(new Event('input', { bubbles: true })); return s.value; })()`);
    await sleep(1500);
    const capture = await webview.eval(CAPTURE_JS(PROBE_T), 120000);
    const firstPng = writeDataUrl(capture.firstPng, path.join(evidenceDir, `${label}-canvas-at-${PROBE_T}s-first.png`));
    const secondPng = writeDataUrl(capture.secondPng, path.join(evidenceDir, `${label}-canvas-at-${PROBE_T}s-second.png`));
    session.captureAtT = { t: PROBE_T, seekValue: capture.seekValue,
      first: { ...capture.first, file: path.basename(firstPng), png: pngSize(firstPng) },
      second: { ...capture.second, file: path.basename(secondPng), png: pngSize(secondPng) } };
    note('capture-at-T', session.captureAtT);
    const atT = await webview.eval(STATE_JS);
    session.domAtT = { canvasRect: atT.canvasRect, layerId: atT.layerId, layerRect: atT.layerRect, captionRect: atT.captionRect, captionText: atT.captionText,
      overlayRect: atT.overlayRect, stageScale: atT.stageScale, canvasPixels: atT.canvasPixels, scaleLine: parseScaleLine(atT.metricsText) };
    note('dom-at-T', session.domAtT);
    const shot = await main.send('Page.captureScreenshot', { format: 'png' }, 30000);
    fs.writeFileSync(path.join(evidenceDir, `${label}-window-at-${PROBE_T}s.png`), Buffer.from(shot.data, 'base64'));

    // ---- (a) 30 秒再生（20 秒尺なので末尾で 0 へ戻して再生を続ける） ------------------------
    const PAUSE_JS = `(() => { const b = document.getElementById('play-toggle'); if (b.getAttribute('aria-label') === '一時停止') b.click(); return b.getAttribute('aria-label'); })()`;
    const PLAY_JS = `(() => { const b = document.getElementById('play-toggle'); if (b.getAttribute('aria-label') !== '一時停止') b.click(); return b.getAttribute('aria-label'); })()`;
    await webview.eval(`(() => { const s = document.getElementById('seek'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); return s.value; })()`);
    await sleep(1200);
    const startState = await webview.eval(STATE_JS);
    await webview.eval(PLAY_JS);
    const samples = [];
    let restarts = 0;
    const playbackStarted = Date.now();
    for (let second = 1; second <= PLAY_SECONDS; second += 1) {
      await sleep(1000);
      const state = await webview.eval(STATE_JS);
      const sample = { second, fps: state.fps, lateFrames: state.lateFrames, playing: state.playing, position: +Number(state.position).toFixed(2),
        canvasPixels: state.canvasPixels, canvasRect: state.canvasRect, scale: parseScaleLine(state.metricsText)?.scale ?? null, restarted: false };
      if (!state.playing || Number(state.position) >= DURATION_S - 0.5) {
        // 20 秒尺の末尾に着いたら 0 へ戻して再生を続ける（30 秒の計測窓を満たす）
        await webview.eval(`(() => { const s = document.getElementById('seek'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); return s.value; })()`);
        await sleep(150);
        await webview.eval(`(() => { const b = document.getElementById('play-toggle'); if (b.getAttribute('aria-label') !== '一時停止') b.click(); return b.getAttribute('aria-label'); })()`);
        restarts += 1;
        sample.restarted = true;
      }
      samples.push(sample);
    }
    const playbackElapsedMs = Date.now() - playbackStarted;
    await webview.eval(PAUSE_JS);
    const stoppedAt = Date.now();
    const steady = samples.filter((s, i) => !s.restarted && !(samples[i - 1]?.restarted) && i > 0);
    session.playback = {
      seconds: PLAY_SECONDS, elapsedMs: playbackElapsedMs, restarts, samples,
      lateFramesStart: startState.lateFrames, lateFramesEnd: samples[samples.length - 1].lateFrames,
      lateFramesDelta: samples[samples.length - 1].lateFrames - startState.lateFrames,
      fpsMedianAll: median(samples.map(s => s.fps)), fpsMedianSteady: median(steady.map(s => s.fps)),
      fpsMin: Math.min(...samples.map(s => s.fps)), fpsMax: Math.max(...samples.map(s => s.fps)),
      scaleDuringPlayback: [...new Set(samples.map(s => s.scale))],
      canvasPixelsDuringPlayback: [...new Set(samples.map(s => JSON.stringify(s.canvasPixels)))].map(v => JSON.parse(v))
    };
    note('playback', { ...session.playback, samples: undefined });

    // ---- (c) 停止 → 300 ms 後の等倍 → 再生で auto 値 ---------------------------------------
    await sleep(Math.max(0, 300 - (Date.now() - stoppedAt)) + 50);
    const afterStop = await webview.eval(STATE_JS);
    await webview.eval(PLAY_JS);
    await sleep(600);
    const afterResume = await webview.eval(STATE_JS);
    await sleep(400);
    await webview.eval(PAUSE_JS);
    await sleep(400);
    const afterStop2 = await webview.eval(STATE_JS);
    session.stopResume = {
      afterStop300ms: { scale: parseScaleLine(afterStop.metricsText), canvasPixels: afterStop.canvasPixels, playing: afterStop.playing, position: afterStop.position },
      afterResume600ms: { scale: parseScaleLine(afterResume.metricsText), canvasPixels: afterResume.canvasPixels, playing: afterResume.playing, position: afterResume.position },
      afterSecondStop400ms: { scale: parseScaleLine(afterStop2.metricsText), canvasPixels: afterStop2.canvasPixels, playing: afterStop2.playing, position: afterStop2.position }
    };
    note('stop-resume', session.stopResume);

    // ---- (d) PiP をクリック選択 → インスペクターで X を変える → 追従 ----------------------
    if (env.AKARI_FRAME_ENGINE_RENDER_SCALE === undefined) {
      await webview.eval(`(() => { const s = document.getElementById('seek'); s.value = ${PROBE_T}; s.dispatchEvent(new Event('input', { bubbles: true })); return s.value; })()`);
      await sleep(1200);
      const beforeClick = await webview.eval(STATE_JS);
      assert.ok(beforeClick.layerRect && iframeRect, 'PiP layer rect / iframe rect must exist');
      const clickX = iframeRect.left + beforeClick.layerRect.left + beforeClick.layerRect.width * 0.5;
      const clickY = iframeRect.top + beforeClick.layerRect.top + beforeClick.layerRect.height * 0.5;
      await realClick(main, clickX, clickY);
      await sleep(1500);
      const selected = await webview.eval(`(() => { const box = document.getElementById('layer-select-box');
        const r = box ? box.getBoundingClientRect() : null; return { visible: Boolean(box && r.width > 0 && getComputedStyle(box).display !== 'none'),
        rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null }; })()`);
      note('pip-click', { clickX, clickY, selected });
      const fieldSelector = '[data-akari-ui="field:inspector-transform-x"] .akari-inspector-number-input';
      const fieldVisible = `(() => { const i = document.querySelector(${JSON.stringify(fieldSelector)}); if (!i) return false; const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
      if (!await evalMain(main, fieldVisible)) {
        await command('akari.inspector.open', undefined).catch(() => null);
      }
      await waitFor('inspector transform-x field', () => evalMain(main, fieldVisible), 30000, 300);
      const fieldBefore = await evalMain(main, `document.querySelector(${JSON.stringify(fieldSelector)}).value`);
      const probe = await evalMain(main, `(() => { const i = document.querySelector(${JSON.stringify(fieldSelector)}); i.scrollIntoView({ block: 'center' });
        const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await realClick(main, probe.x, probe.y);
      await sleep(200);
      await evalMain(main, `(() => { const i = document.querySelector(${JSON.stringify(fieldSelector)}); i.focus(); i.select(); i.value = ''; return document.activeElement === i; })()`);
      for (const ch of String(NEW_PIP_X)) { await main.send('Input.insertText', { text: ch }); await sleep(120); }
      await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      let written = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(500);
        written = JSON.parse(fs.readFileSync(editPath, 'utf8'));
        if (written.tracks?.[1]?.items?.[0]?.transform?.x === NEW_PIP_X) break;
      }
      await sleep(2500);
      // edit.json の書き込みで webview が作り直されることがあるので引き直す
      webview = await findWebview(cdpPort).catch(() => webview);
      await waitFor('frame-engine ready after write', async () => (await webview.eval(STATE_JS)).ready === 'true', 120000, 250);
      await sleep(1000);
      await webview.eval(`(() => { const s = document.getElementById('seek'); s.value = ${PROBE_T - 1}; s.dispatchEvent(new Event('input', { bubbles: true })); return s.value; })()`);
      await sleep(1200);
      const captureAfter = await webview.eval(CAPTURE_JS(PROBE_T), 120000);
      const afterPng = writeDataUrl(captureAfter.secondPng, path.join(evidenceDir, `${label}-canvas-at-${PROBE_T}s-after-x-change.png`));
      const afterScaledPng = writeDataUrl(captureAfter.firstPng, path.join(evidenceDir, `${label}-canvas-at-${PROBE_T}s-after-x-change-first.png`));
      const afterState = await webview.eval(STATE_JS);
      const shot2 = await main.send('Page.captureScreenshot', { format: 'png' }, 30000);
      fs.writeFileSync(path.join(evidenceDir, `${label}-window-after-x-change.png`), Buffer.from(shot2.data, 'base64'));
      session.inspectorX = {
        fieldBefore, typed: String(NEW_PIP_X), editJsonTransform: written?.tracks?.[1]?.items?.[0]?.transform ?? null,
        layerRectBefore: beforeClick.layerRect, layerRectAfter: afterState.layerRect,
        layerShiftCssPx: afterState.layerRect && beforeClick.layerRect ? +(afterState.layerRect.left - beforeClick.layerRect.left).toFixed(2) : null,
        expectedShiftCssPx: afterState.stageScale ? +((NEW_PIP_X - PIP_OFFSET) * afterState.stageScale).toFixed(2) : null,
        stageScale: afterState.stageScale,
        scaleLineAfter: parseScaleLine(afterState.metricsText),
        captureAfter: { first: { ...captureAfter.first, file: path.basename(afterScaledPng) }, second: { ...captureAfter.second, file: path.basename(afterPng) } },
        selected
      };
      note('inspector-x', session.inspectorX);
    }

    session.consoleErrors = await errorLog(main);
    session.finalState = (({ metricsText, ...rest }) => ({ ...rest, scaleLine: parseScaleLine(metricsText) }))(await webview.eval(STATE_JS));
  } catch (error) {
    session.error = scrub(String(error?.stack ?? error)).slice(0, 3000);
    console.error(`[${label}] ERROR`, session.error);
  } finally {
    try { webview?.view.close(); } catch { /* gone */ }
    try { main?.close(); } catch { /* gone */ }
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    await sleep(2500);
    session.orphanSweep = await assertNoOrphans(child.pid, userDataDir);
    await sleep(500);
    session.survivingUserDataDirProcesses = psCount(userDataDir);
    session.survivingBackendMainJs = psCount(path.join(shellRoot, 'lib/backend/main.js'));
    note('cleanup', { orphanSweep: session.orphanSweep, survivingUserDataDirProcesses: session.survivingUserDataDirProcesses, survivingBackendMainJs: session.survivingBackendMainJs });
  }
  return session;
}

// ------------------------------------------------------------------ run
if (!onlySession || onlySession === 'scale-1') await runSession('scale-1', { AKARI_FRAME_ENGINE_RENDER_SCALE: '1' });
if (!onlySession || onlySession === 'auto') await runSession('auto', {});

// ---- (b) MAD: 等倍（s=1 セッション）を auto の寸法へ縮小して比較 ------------------------------
const s1 = report.sessions['scale-1'];
const auto = report.sessions.auto;
if (s1?.captureAtT && auto?.captureAtT) {
  const scaledFile = path.join(evidenceDir, auto.captureAtT.first.file);
  const fullFile = path.join(evidenceDir, s1.captureAtT.first.file);
  const { width, height } = auto.captureAtT.first.png;
  const scaled = decodeRgba(scaledFile);
  const fullDown = decodeRgba(fullFile, width, height);
  const autoOwnFull = decodeRgba(path.join(evidenceDir, auto.captureAtT.second.file), width, height);
  const pipRegion = { x0: Math.floor((OUTPUT / 2 + PIP_OFFSET - OUTPUT * PIP_SCALE / 2) * width / OUTPUT), x1: Math.floor((OUTPUT / 2 + PIP_OFFSET + OUTPUT * PIP_SCALE / 2) * width / OUTPUT),
    y0: Math.floor((OUTPUT / 2 + PIP_OFFSET - OUTPUT * PIP_SCALE / 2) * height / OUTPUT), y1: Math.floor((OUTPUT / 2 + PIP_OFFSET + OUTPUT * PIP_SCALE / 2) * height / OUTPUT) };
  report.mad = {
    definition: 'packages/frame-engine/src/metrics/frame-diff.ts compareRgba.meanAbsoluteDelta（RGBA 全バイトの平均絶対差、/255）。等倍側は ffmpeg scale flags=area で auto の寸法へ縮小',
    threshold: 2.0,
    autoScaledVsScale1Downscaled: { scaledFile: path.basename(scaledFile), fullFile: path.basename(fullFile), dimensions: { width, height },
      ...compareRgba(scaled, fullDown), pipRegionMadRgb: regionMad(scaled, fullDown, width, pipRegion) },
    autoScaledVsAutoOwnFullRedrawDownscaled: { fullFile: auto.captureAtT.second.file, dimensions: { width, height }, ...compareRgba(scaled, autoOwnFull) },
    scale1FirstVsSecond: (() => { const a = decodeRgba(fullFile); const b = decodeRgba(path.join(evidenceDir, s1.captureAtT.second.file)); return compareRgba(a, b); })()
  };
  // DOM 層の矩形は各セッションの canvas 矩形（ステージ）を基準に出力 px へ正規化して比べる
  // （セッション間でパネル配置が違ってもステージ内の位置・大きさで一致を見る）。
  const toOutputPx = (rect, canvas) => rect && canvas ? { left: +((rect.left - canvas.left) / canvas.width * OUTPUT).toFixed(2), top: +((rect.top - canvas.top) / canvas.height * OUTPUT).toFixed(2),
    width: +(rect.width / canvas.width * OUTPUT).toFixed(2), height: +(rect.height / canvas.height * OUTPUT).toFixed(2) } : null;
  const rectDelta = (a, b) => a && b ? +Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height)).toFixed(2) : null;
  const cssPxInOutputPx = +(OUTPUT / Math.min(s1.domAtT.canvasRect.width, auto.domAtT.canvasRect.width)).toFixed(2);
  const compareRect = key => {
    const a = toOutputPx(s1.domAtT[key], s1.domAtT.canvasRect); const b = toOutputPx(auto.domAtT[key], auto.domAtT.canvasRect);
    return { scale1Css: s1.domAtT[key], autoCss: auto.domAtT[key], scale1OutputPx: a, autoOutputPx: b, maxDeltaOutputPx: rectDelta(a, b),
      maxDeltaCssPx: rectDelta(a, b) === null ? null : +(rectDelta(a, b) / cssPxInOutputPx).toFixed(3) };
  };
  report.domLayerRects = { note: 'ステージ（canvas 矩形）基準の出力 px。maxDeltaCssPx は auto セッションの CSS px 換算（1 CSS px = ' + cssPxInOutputPx + ' output px）',
    sameLayout: rectDelta(s1.domAtT.canvasRect, auto.domAtT.canvasRect) === 0,
    canvas: { scale1: s1.domAtT.canvasRect, auto: auto.domAtT.canvasRect },
    caption: compareRect('captionRect'), overlay: compareRect('overlayRect'), layer: compareRect('layerRect') };
  if (auto.inspectorX) {
    const after = decodeRgba(path.join(evidenceDir, auto.inspectorX.captureAfter.second.file), width, height);
    const strip = { x0: Math.floor((OUTPUT / 2 + PIP_OFFSET + OUTPUT * PIP_SCALE / 2 - 200) * width / OUTPUT), x1: Math.floor((OUTPUT / 2 + PIP_OFFSET + OUTPUT * PIP_SCALE / 2 - 10) * width / OUTPUT), y0: pipRegion.y0 + 10, y1: pipRegion.y1 - 10 };
    const untouched = { x0: 0, x1: Math.floor(width * 0.4), y0: Math.floor(height * 0.35), y1: Math.floor(height * 0.5) };
    report.inspectorFollow = {
      vacatedPipStripMadRgb: regionMad(autoOwnFull, after, width, strip),
      untouchedRegionMadRgb: regionMad(autoOwnFull, after, width, untouched),
      strip, untouched
    };
  }
  console.log('[mad]', JSON.stringify(report.mad, null, 1));
}

// ---- (e) GPU 書き出し（Electron セッション終了後・render-cut --engine gpu） ------------------
if (!skipExport && !onlySession) {
  const started = Date.now();
  // shell の書き出しと同じ順序: edit-lint PASS（.akari/lint.json）→ render-cut --engine gpu
  const lint = spawnSync(process.execPath, [path.join(repoRoot, 'packages/edit-lint/bin/edit-lint.mjs'), project, '--json'],
    { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, HOME: fakeHome, AKARI_HOME: akariHome, AKARI_CREDENTIALS_FILE: credentials } });
  fs.writeFileSync(path.join(evidenceDir, 'export-edit-lint.txt'), scrub(`exit=${lint.status}\n${lint.stdout ?? ''}\n${lint.stderr ?? ''}`));
  // gpu-export は npm の electron（tier 2）を require('electron') で引く。この worktree では Electron 実体が
  // apps/shell/node_modules 側にあるので、electron パッケージが公式に読む ELECTRON_OVERRIDE_DIST_PATH で dist を指す。
  const electronDist = path.resolve(ELECTRON_BIN, '../../../..');
  const out = spawnSync(process.execPath, [path.join(repoRoot, 'packages/render-cut/bin/render-cut.mjs'), project, '--engine', 'gpu', '--progress',
    '--out', path.join(project, 'exports/l1-gpu-export.mp4')],
    { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, HOME: fakeHome, AKARI_HOME: akariHome, AKARI_CREDENTIALS_FILE: credentials,
      ELECTRON_OVERRIDE_DIST_PATH: electronDist }, timeout: 20 * 60 * 1000 });
  const log = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
  fs.writeFileSync(path.join(evidenceDir, 'export-render-cut.txt'), scrub(log));
  const mp4 = path.join(project, 'exports/l1-gpu-export.mp4');
  const probe = fs.existsSync(mp4) ? JSON.parse(spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,codec_name,r_frame_rate,nb_frames:format=duration', '-of', 'json', mp4], { encoding: 'utf8' }).stdout) : null;
  const receiptsDir = path.join(project, '.akari/reports/render-receipts');
  const receipts = fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir).filter(n => n.endsWith('.json')) : [];
  const receiptText = receipts.map(n => fs.readFileSync(path.join(receiptsDir, n), 'utf8')).join('\n');
  const renderJson = fs.existsSync(path.join(project, '.akari/render.json')) ? fs.readFileSync(path.join(project, '.akari/render.json'), 'utf8') : '';
  // 語の検査は作業機パスを伏せた後の文字列で行う（worktree のディレクトリ名に render-scale が含まれるため）。
  // 字幕テキスト（'render scale probe …'）は receipt に載り得るので、その語は除いて検査する。
  const needle = /render[ _-]?scale(?! probe)/iu;
  const mentions = text => { const m = needle.exec(scrub(text)); return m ? scrub(text).slice(Math.max(0, m.index - 60), m.index + 60) : null; };
  report.export = {
    engine: 'gpu', lintExitCode: lint.status, exitCode: out.status, elapsedMs: Date.now() - started, ffprobe: probe,
    receipts: receipts.length, receiptMentionsRenderScale: mentions(receiptText), renderJsonMentionsRenderScale: mentions(renderJson),
    logMentionsRenderScale: mentions(log), logTail: scrub(log.trim().split('\n').slice(-12).join('\n')),
    survivingGpuExportProcesses: psCount('gpu-export'),
    receiptFile: receipts[0] ? `.akari/reports/render-receipts/${receipts[0]}` : null
  };
  if (receipts[0]) fs.writeFileSync(path.join(evidenceDir, 'export-render-receipt.json'), scrub(fs.readFileSync(path.join(receiptsDir, receipts[0]), 'utf8')));
  if (renderJson) fs.writeFileSync(path.join(evidenceDir, 'export-render-state.json'), scrub(renderJson));
  console.log('[export]', JSON.stringify({ ...report.export, logTail: undefined }, null, 1));
}

// ------------------------------------------------------------------ verdict
const expectedScaleFor = (rect, dpr) => {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return 1;
  for (const s of [0.25, 0.5, 1]) if (OUTPUT * s >= rect.width * dpr && OUTPUT * s >= rect.height * dpr) return s;
  return 1;
};
const autoDpr = auto?.boot?.devicePixelRatio ?? 1;
const expectedAuto = expectedScaleFor(auto?.domAtT?.canvasRect, autoDpr);
if (auto?.playback) auto.playback.expectedScalePerSample = auto.playback.samples.map(s => expectedScaleFor(s.canvasRect, autoDpr));
report.expectedAuto = { fromCanvasRect: auto?.domAtT?.canvasRect, webviewDevicePixelRatio: autoDpr, scale: expectedAuto };
report.verdict = {
  scale1PanelShowsOne: s1?.boot?.scaleLine?.scale === 1 && s1?.boot?.scaleLine?.mode === '1',
  autoPanelShowsReduced: auto?.playback?.samples?.filter(s => !s.restarted).every(s => s.scale === 0.5 || s.scale === 0.25) ?? false,
  autoPlaybackScaleMatchesPureFunction: auto?.playback?.samples?.filter(s => !s.restarted).every((s, i) => s.scale === expectedScaleFor(s.canvasRect, autoDpr)) ?? false,
  expectedAutoFromCanvasRect: expectedAuto,
  lateFramesNotWorse: (auto?.playback?.lateFramesDelta ?? Infinity) <= (s1?.playback?.lateFramesDelta ?? -1),
  fpsMedian: { scale1: s1?.playback?.fpsMedianAll, auto: auto?.playback?.fpsMedianAll },
  madWithinThreshold: (report.mad?.autoScaledVsScale1Downscaled?.meanAbsoluteDelta ?? Infinity) <= 2.0,
  domRectsStable: ['caption', 'overlay', 'layer'].every(k => (report.domLayerRects?.[k]?.maxDeltaCssPx ?? Infinity) <= 1),
  stopRedrawsAtOne: auto?.stopResume?.afterStop300ms?.scale?.scale === 1 && auto?.stopResume?.afterStop300ms?.canvasPixels?.width === OUTPUT && auto?.stopResume?.afterStop300ms?.playing === false,
  resumeReturnsToAuto: auto?.stopResume?.afterResume600ms?.scale?.scale === expectedAuto && auto?.stopResume?.afterResume600ms?.playing === true,
  autoCaptureFirstIsReducedThenFull: auto?.captureAtT?.first?.width === OUTPUT * expectedAuto && auto?.captureAtT?.second?.width === OUTPUT,
  inspectorXWritten: auto?.inspectorX?.editJsonTransform?.x === NEW_PIP_X,
  inspectorPreviewFollows: auto?.inspectorX?.layerShiftCssPx !== null && auto?.inspectorX?.expectedShiftCssPx !== null
    && Math.abs((auto?.inspectorX?.layerShiftCssPx ?? 0) - (auto?.inspectorX?.expectedShiftCssPx ?? 1e9)) <= 1
    && (report.inspectorFollow?.vacatedPipStripMadRgb ?? 0) > 8 && (report.inspectorFollow?.untouchedRegionMadRgb ?? 99) <= 2,
  exportMatchesOutput: skipExport || onlySession ? 'skipped' : report.export?.exitCode === 0 && report.export?.ffprobe?.streams?.[0]?.width === OUTPUT && report.export?.ffprobe?.streams?.[0]?.height === OUTPUT,
  exportSilentOnRenderScale: skipExport || onlySession ? 'skipped' : report.export && !report.export.receiptMentionsRenderScale && !report.export.renderJsonMentionsRenderScale && !report.export.logMentionsRenderScale,
  noSessionErrors: Object.values(report.sessions).every(s => !s.error),
  noSurvivingProcesses: Object.values(report.sessions).every(s => s.survivingUserDataDirProcesses === 0 && s.survivingBackendMainJs === 0)
};
report.survivingBackendMainJsAtEnd = psCount(path.join(shellRoot, 'lib/backend/main.js'));
report.generatedAt = new Date().toISOString();
report.host = { platform: process.platform, arch: process.arch, cpus: os.cpus()[0]?.model, memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version };
fs.writeFileSync(path.join(evidenceDir, 'l1-measure.json'), `${scrub(JSON.stringify(report, null, 2))}\n`);
console.log(scrub(JSON.stringify(report.verdict, null, 2)));
fs.rmSync(work, { recursive: true, force: true });
