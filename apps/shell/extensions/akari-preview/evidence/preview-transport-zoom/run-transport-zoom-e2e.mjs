#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins only: fetch, WebSocket) raw-CDP driver that
// exercises the AKARI Video preview-tab transport (2-row layout, frame/skip
// controls, zoom/pan/minimap, ctrl+wheel zoom, fullscreen toggle) end-to-end
// through the Theia WebviewWidget double iframe, using genuine hit-tested
// mouse/keyboard/wheel input. Modeled on
// docs/e2e-method/scripts/run-inspector-writeback-e2e.mjs (see that file /
// README for the double-iframe piercing technique this reuses verbatim).
//
// Usage:
//   node run-transport-zoom-e2e.mjs <cdpPort> <workspaceDir> <videoRelPath> <evidenceDir>
//
// Requires an already-running Electron instance of apps/shell with
// --remote-debugging-port=<cdpPort>, opened on <workspaceDir>, with a fixture
// edit.json next to the video declaring output.fps and a captions.json.

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , cdpPortArg, workspaceDirArg, videoRelPathArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9333);
const WORKSPACE_DIR = workspaceDirArg || '/tmp/akari-transport-zoom-scratch/workspace';
const VIDEO_REL_PATH = videoRelPathArg || 'exports/sample.mp4';
const EVIDENCE_DIR = evidenceDirArg || '/tmp/akari-transport-zoom-scratch/evidence';

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
function assert(condition, message) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + message);
  record('assert-ok', { message });
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.listeners.get(msg.method) || []) h(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }
  close() { this.ws.close(); }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}

// eval が返らないケース（fullscreen 遷移等で対象コンテキストが破棄された場合など）を
// 無限停止でなくエラーとして顕在化させるためのタイムアウト付きラッパ
function withEvalTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`eval timeout (15s): ${label.slice(0, 140)}`)), 15000))
  ]);
}

async function evalMain(cdp, expression) {
  const r = await withEvalTimeout(
    cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }), expression);
  if (r.exceptionDetails) throw new Error('evalMain failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function evalIn(cdp, contextId, expression) {
  const r = await withEvalTimeout(
    cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }), expression);
  if (r.exceptionDetails) throw new Error('evalIn failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let count = 1; count <= clicks; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
    if (count < clicks) await sleep(60);
  }
}

async function realDrag(cdp, x0, y0, x1, y1, steps = 8) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  await sleep(30);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(20);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  await sleep(50);
}

async function realWheel(cdp, x, y, deltaY, ctrlKey) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers: ctrlKey ? 2 : 0
  });
}

async function realKey(cdp, key, code, windowsVirtualKeyCode, modifiers = 0) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
}

async function screenshot(cdp, filePath) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

async function findOuterWebviewTarget() {
  let outerTarget = null;
  for (let attempt = 0; attempt < 10 && !outerTarget; attempt++) {
    const targets = await listTargets();
    outerTarget = targets.find(t => t.type === 'iframe' && /webview\/index\.html/.test(t.url));
    if (!outerTarget) await sleep(300);
  }
  return outerTarget;
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const results = {};

  // ---- connect to main Theia frontend page target ----
  const targets0 = await listTargets();
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('DOM.enable');
  record('connected-main', { targetId: mainTarget.id });

  // ---- open Explorer if not already open ----
  // 起動直後はレイアウト安定前でクリックが空振りすることがあるため、
  // 「ツリー行が見えるまでアイコンクリックを繰り返す」形で開く
  await sleep(2000);
  let explorerState = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    explorerState = await evalMain(main, `(() => {
      const anyRow = document.querySelector('.theia-TreeNode');
      const alreadyOpen = !!(anyRow && anyRow.getBoundingClientRect().width > 0);
      const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
      const r = el ? el.getBoundingClientRect() : null;
      return { alreadyOpen, x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0 };
    })()`);
    if (explorerState.alreadyOpen) break;
    if (explorerState.x) await realClick(main, explorerState.x, explorerState.y);
    await sleep(1000);
  }
  record('opened-explorer', explorerState);

  // ---- expand folder + open video (idempotent) ----
  const videoDir = path.dirname(VIDEO_REL_PATH).split('/')[0];
  const videoBase = path.basename(VIDEO_REL_PATH);
  const findRow = (label) => evalMain(main, `(() => {
    const rows = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]'));
    const row = rows.find(r => r.textContent.trim() === ${JSON.stringify(label)});
    if (!row) return { found: false };
    const r = row.getBoundingClientRect();
    const collapsed = !!row.querySelector('.theia-mod-collapsed');
    return { found: true, collapsed, x: r.left + 20, y: r.top + r.height / 2 };
  })()`);
  const findRowRetry = async (label, tries = 20) => {
    for (let i = 0; i < tries; i += 1) {
      const row = await findRow(label);
      if (row.found) return row;
      await sleep(500);
    }
    return { found: false };
  };
  const folderRow = await findRowRetry(videoDir);
  if (!folderRow.found) throw new Error(`tree row for folder "${videoDir}" not found`);
  // Theia のディレクトリ行はシングルクリックで展開トグルする。
  // 「子行（動画ファイル）が DOM に現れるまで」を展開完了の判定に使い、必要ならクリックを繰り返す
  let fileRow = await findRow(videoBase);
  for (let attempt = 0; attempt < 4 && !fileRow.found; attempt += 1) {
    const current = await findRow(videoDir);
    if (current.found) {
      await realClick(main, current.x, current.y);
      await sleep(700);
    }
    fileRow = await findRowRetry(videoBase, 6);
  }
  if (!fileRow.found) throw new Error(`tree row for file "${videoBase}" not found`);
  await realClick(main, fileRow.x, fileRow.y, { clickCount: 2 });
  await sleep(1500);
  record('opened-video-tab', { videoBase, ...fileRow });

  // ---- reach the inner active-frame execution context ----
  // fullscreen/最大化トグルで webview の CDP ターゲットごと作り直されることがあるため、
  // 接続確立は再実行可能な関数にしておく
  let outer; let contexts; let topFrameId; let activeCtx;
  const connectWebview = async () => {
    const outerTarget = await findOuterWebviewTarget();
    if (!outerTarget) throw new Error('outer webview CDP target not found');
    outer = new CDP(outerTarget.webSocketDebuggerUrl);
    await outer.connect();
    contexts = [];
    outer.on('Runtime.executionContextCreated', (params) => contexts.push(params.context));
    await outer.send('Page.enable');
    await outer.send('Runtime.enable');
    await sleep(400);
    const frameTree = await outer.send('Page.getFrameTree');
    topFrameId = frameTree.frameTree.frame.id;
    activeCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
    if (!activeCtx) throw new Error('inner active-frame execution context not found');
  };
  await connectWebview();
  record('reached-active-frame-context', { activeContextId: activeCtx.id });

  const evalActive = (expr) => evalIn(outer, activeCtx.id, expr);

  // =========================================================================
  // Criterion 1: 2-row transport layout
  // =========================================================================
  await sleep(300);
  const layout = await evalActive(`(() => {
    const seekRow = document.querySelector('.transport-seek');
    const controlsRow = document.querySelector('.transport-controls');
    const centerIds = Array.from(document.querySelectorAll('.transport-center button')).map(b => b.id);
    const rightIds = Array.from(document.querySelectorAll('.transport-right > button')).map(b => b.id);
    const seekRect = seekRow.getBoundingClientRect();
    const controlsRect = controlsRow.getBoundingClientRect();
    return {
      seekRowTop: seekRect.top, seekRowBottom: seekRect.bottom, seekRowWidth: seekRect.width,
      controlsRowTop: controlsRect.top,
      centerIds, rightIds,
      seekAboveControls: seekRect.bottom <= controlsRect.top + 1
    };
  })()`);
  record('layout-two-rows', layout);
  assert(layout.seekAboveControls, 'seek row must be above the controls row (2-row transport)');
  assert(JSON.stringify(layout.centerIds) === JSON.stringify(['skip-back', 'frame-back', 'play-toggle', 'frame-forward', 'skip-forward']), 'center zone button order');
  assert(JSON.stringify(layout.rightIds) === JSON.stringify(['zoom-toggle', 'fullscreen-toggle']), 'right zone button order');
  results.criterion1_layout = layout;
  await screenshot(main, path.join(EVIDENCE_DIR, '01-transport-two-rows.png'));

  // =========================================================================
  // Criterion 2: frame-forward / frame-back (paused), incl. clamping
  // =========================================================================
  const fps = await evalActive(`window.__akariPreview.summary.output.fps`);
  const duration = await evalActive(`(() => { const v = document.getElementById('preview-video'); return v.duration; })()`);
  record('fixture-fps-duration', { fps, duration });

  const frameButtonRect = async (id) => evalActive(`(() => {
    const r = document.getElementById('${id}').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

  const setTimePaused = (t) => evalActive(`(() => {
    const v = document.getElementById('preview-video');
    v.pause();
    v.currentTime = ${t};
    return new Promise(resolve => {
      const done = () => { v.removeEventListener('seeked', done); resolve(v.currentTime); };
      v.addEventListener('seeked', done, { once: true });
    });
  })()`);

  await setTimePaused(5);
  let before = await evalActive(`document.getElementById('preview-video').currentTime`);
  let ffRect = await frameButtonRect('frame-forward');
  await realClick(outer, ffRect.x, ffRect.y);
  await sleep(150);
  let after = await evalActive(`document.getElementById('preview-video').currentTime`);
  const frameForwardDelta = after - before;
  record('frame-forward-delta', { before, after, delta: frameForwardDelta, expected: 1 / fps });
  assert(Math.abs(frameForwardDelta - 1 / fps) <= 0.005, `frame-forward delta ${frameForwardDelta} within +-0.005 of 1/fps=${1 / fps}`);

  before = after;
  let fbRect = await frameButtonRect('frame-back');
  await realClick(outer, fbRect.x, fbRect.y);
  await sleep(150);
  after = await evalActive(`document.getElementById('preview-video').currentTime`);
  const frameBackDelta = before - after;
  record('frame-back-delta', { before, after, delta: frameBackDelta, expected: 1 / fps });
  assert(Math.abs(frameBackDelta - 1 / fps) <= 0.005, `frame-back delta ${frameBackDelta} within +-0.005 of 1/fps=${1 / fps}`);

  // clamp at 0
  await setTimePaused(0);
  await realClick(outer, fbRect.x, fbRect.y);
  await sleep(150);
  const clampedZero = await evalActive(`document.getElementById('preview-video').currentTime`);
  record('frame-back-clamp-zero', { clampedZero });
  assert(clampedZero === 0, `frame-back at t=0 must clamp to 0, got ${clampedZero}`);

  // clamp at duration
  await setTimePaused(Math.max(0, duration - 0.01));
  const nearEnd = await evalActive(`document.getElementById('preview-video').currentTime`);
  await realClick(outer, ffRect.x, ffRect.y);
  await sleep(150);
  const clampedDuration = await evalActive(`document.getElementById('preview-video').currentTime`);
  record('frame-forward-clamp-duration', { nearEnd, clampedDuration, duration });
  assert(clampedDuration <= duration + 0.001, `frame-forward near end must clamp to <= duration, got ${clampedDuration}`);
  results.criterion2_frame_step = { fps, frameForwardDelta, frameBackDelta, clampedZero, clampedDuration };

  // =========================================================================
  // Criterion 3: skip-forward / skip-back (+-10s), incl. clamping
  // =========================================================================
  await setTimePaused(5);
  before = await evalActive(`document.getElementById('preview-video').currentTime`);
  let sfRect = await frameButtonRect('skip-forward');
  await realClick(outer, sfRect.x, sfRect.y);
  await sleep(150);
  after = await evalActive(`document.getElementById('preview-video').currentTime`);
  const skipForwardDelta = after - before;
  record('skip-forward-delta', { before, after, delta: skipForwardDelta });
  assert(Math.abs(skipForwardDelta - 10) <= 0.05, `skip-forward delta ${skipForwardDelta} within +-0.05 of 10`);

  before = after;
  let sbRect = await frameButtonRect('skip-back');
  await realClick(outer, sbRect.x, sbRect.y);
  await sleep(150);
  after = await evalActive(`document.getElementById('preview-video').currentTime`);
  const skipBackDelta = before - after;
  record('skip-back-delta', { before, after, delta: skipBackDelta });
  assert(Math.abs(skipBackDelta - 10) <= 0.05, `skip-back delta ${skipBackDelta} within +-0.05 of 10`);

  await setTimePaused(2);
  await realClick(outer, sbRect.x, sbRect.y);
  await sleep(150);
  const skipClampZero = await evalActive(`document.getElementById('preview-video').currentTime`);
  record('skip-back-clamp-zero', { skipClampZero });
  assert(skipClampZero === 0, `skip-back near 0 must clamp to 0, got ${skipClampZero}`);

  await setTimePaused(Math.max(0, duration - 2));
  await realClick(outer, sfRect.x, sfRect.y);
  await sleep(150);
  const skipClampDuration = await evalActive(`document.getElementById('preview-video').currentTime`);
  record('skip-forward-clamp-duration', { skipClampDuration, duration });
  assert(skipClampDuration <= duration + 0.001, `skip-forward near end must clamp to <= duration, got ${skipClampDuration}`);
  results.criterion3_skip_10s = { skipForwardDelta, skipBackDelta, skipClampZero, skipClampDuration };

  // =========================================================================
  // Criterion 4: frame-forward while playing pauses first, then advances
  // =========================================================================
  await setTimePaused(5);
  await evalActive(`(() => { const v = document.getElementById('preview-video'); return v.play(); })()`);
  await sleep(400);
  const playingBefore = await evalActive(`document.getElementById('preview-video').paused`);
  before = await evalActive(`document.getElementById('preview-video').currentTime`);
  await realClick(outer, ffRect.x, ffRect.y);
  await sleep(250);
  const pausedAfter = await evalActive(`document.getElementById('preview-video').paused`);
  after = await evalActive(`document.getElementById('preview-video').currentTime`);
  record('frame-forward-while-playing', { playingBefore, before, pausedAfter, after, delta: after - before });
  assert(playingBefore === false, 'video must actually be playing before the click');
  assert(pausedAfter === true, 'frame-forward during playback must pause the video');
  results.criterion4_pause_then_step = { playingBefore, pausedAfter, delta: after - before };

  // =========================================================================
  // Criterion 5: zoom popup -> 200%, minimap, drag pan, reset to 100%
  // =========================================================================
  await setTimePaused(5);
  const zoomToggleRect = await frameButtonRect('zoom-toggle');
  await realClick(outer, zoomToggleRect.x, zoomToggleRect.y);
  await sleep(200);
  const popupOpen = await evalActive(`document.getElementById('zoom-popup').hidden === false`);
  record('zoom-popup-opened', { popupOpen });
  assert(popupOpen, 'zoom popup must open after clicking zoom-toggle');
  await screenshot(main, path.join(EVIDENCE_DIR, '02-zoom-popup-open.png'));

  const preset200 = await evalActive(`(() => {
    const el = document.querySelector('.zoom-preset[data-zoom="2"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await realClick(outer, preset200.x, preset200.y);
  await sleep(250);
  const zoomedState = await evalActive(`(() => {
    const layerTransform = document.getElementById('zoom-layer').style.transform;
    const minimapHidden = document.getElementById('zoom-minimap').hidden;
    const vp = document.getElementById('zoom-minimap-viewport');
    return { layerTransform, minimapHidden, vpWidth: vp.style.width, vpHeight: vp.style.height, vpLeft: vp.style.left, vpTop: vp.style.top };
  })()`);
  record('zoom-200-state', zoomedState);
  assert(/scale\(2\)/.test(zoomedState.layerTransform), `zoom-layer transform must contain scale(2), got "${zoomedState.layerTransform}"`);
  assert(zoomedState.minimapHidden === false, 'minimap must be visible when zoomed > 1.05');
  const vpWidthPct = parseFloat(zoomedState.vpWidth);
  const vpHeightPct = parseFloat(zoomedState.vpHeight);
  assert(Math.abs(vpWidthPct - 50) <= 2, `minimap viewport width ${vpWidthPct}% within +-2% of 50%`);
  assert(Math.abs(vpHeightPct - 50) <= 2, `minimap viewport height ${vpHeightPct}% within +-2% of 50%`);
  await screenshot(main, path.join(EVIDENCE_DIR, '03-zoom-200-minimap.png'));

  // close popup by clicking outside it (on the video area) before dragging
  const wrapperRectPre = await evalActive(`(() => {
    const r = document.getElementById('preview-wrapper').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  await realClick(outer, wrapperRectPre.left + wrapperRectPre.width * 0.5, wrapperRectPre.top + wrapperRectPre.height * 0.15);
  await sleep(200);

  const vpBeforeDrag = await evalActive(`(() => {
    const vp = document.getElementById('zoom-minimap-viewport');
    return { left: vp.style.left, top: vp.style.top };
  })()`);
  const dragStart = { x: wrapperRectPre.left + wrapperRectPre.width * 0.5, y: wrapperRectPre.top + wrapperRectPre.height * 0.5 };
  const dragEnd = { x: dragStart.x - wrapperRectPre.width * 0.2, y: dragStart.y - wrapperRectPre.height * 0.2 };
  await realDrag(outer, dragStart.x, dragStart.y, dragEnd.x, dragEnd.y, 10);
  await sleep(250);
  const vpAfterDrag = await evalActive(`(() => {
    const vp = document.getElementById('zoom-minimap-viewport');
    const layerTransform = document.getElementById('zoom-layer').style.transform;
    return { left: vp.style.left, top: vp.style.top, layerTransform };
  })()`);
  record('drag-pan', { dragStart, dragEnd, vpBeforeDrag, vpAfterDrag });
  assert(vpAfterDrag.left !== vpBeforeDrag.left || vpAfterDrag.top !== vpBeforeDrag.top, 'minimap viewport rect must move after drag pan');
  await screenshot(main, path.join(EVIDENCE_DIR, '04-zoom-200-panned.png'));

  // reset to 100% via popup preset
  await realClick(outer, zoomToggleRect.x, zoomToggleRect.y);
  await sleep(200);
  const preset100 = await evalActive(`(() => {
    const el = document.querySelector('.zoom-preset[data-zoom="1"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await realClick(outer, preset100.x, preset100.y);
  await sleep(250);
  const resetState = await evalActive(`(() => {
    const layerTransform = document.getElementById('zoom-layer').style.transform;
    const minimapHidden = document.getElementById('zoom-minimap').hidden;
    return { layerTransform, minimapHidden };
  })()`);
  record('zoom-reset-100', resetState);
  assert(/scale\(1\)/.test(resetState.layerTransform), `zoom-layer transform must contain scale(1) after reset, got "${resetState.layerTransform}"`);
  assert(/translate\(0(\.000)?%, 0(\.000)?%\)/.test(resetState.layerTransform), `pan must be 0 after reset, got "${resetState.layerTransform}"`);
  assert(resetState.minimapHidden === true, 'minimap must hide again at zoom<=1.05');
  results.criterion5_zoom_pan_minimap = { zoomedState, vpBeforeDrag, vpAfterDrag, resetState };

  // =========================================================================
  // Criterion 6: ctrl+wheel zoom
  // =========================================================================
  const previewPaneRect = await evalActive(`(() => {
    const r = document.querySelector('.preview-pane').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  const zoomBeforeWheel = await evalActive(`document.getElementById('zoom-layer').style.transform`);
  await realWheel(outer, previewPaneRect.x, previewPaneRect.y, -200, true);
  await sleep(250);
  const zoomAfterWheel = await evalActive(`document.getElementById('zoom-layer').style.transform`);
  record('ctrl-wheel-zoom', { zoomBeforeWheel, zoomAfterWheel });
  assert(zoomAfterWheel !== zoomBeforeWheel, 'ctrl+wheel must change the zoom transform');
  await screenshot(main, path.join(EVIDENCE_DIR, '05-ctrl-wheel-zoom.png'));

  // reset back to 100% for the caption/overlay + fullscreen checks
  await realClick(outer, zoomToggleRect.x, zoomToggleRect.y);
  await sleep(150);
  await realClick(outer, preset100.x, preset100.y);
  await sleep(150);
  await realClick(outer, zoomToggleRect.x, zoomToggleRect.y); // close popup (toggle) if still open
  await sleep(150);
  const closedCheck = await evalActive(`document.getElementById('zoom-popup').hidden`);
  if (!closedCheck) {
    await realClick(outer, wrapperRectPre.left + wrapperRectPre.width * 0.5, wrapperRectPre.top + wrapperRectPre.height * 0.15);
    await sleep(150);
  }

  // =========================================================================
  // Criterion 7: captions + overlay scale together with the video at 200%
  // =========================================================================
  const seekResult = await evalActive(`(() => {
    const video = document.getElementById('preview-video');
    video.pause();
    video.currentTime = 3;
    return new Promise(resolve => {
      video.addEventListener('seeked', function handler() {
        video.removeEventListener('seeked', handler);
        window.akari.runtime.tick(video.currentTime, false);
        resolve({ currentTime: video.currentTime, captionText: document.getElementById('caption-plate').textContent });
      }, { once: true });
    });
  })()`);
  record('seeked-for-caption', seekResult);
  assert(seekResult.captionText && seekResult.captionText.length > 0, 'caption must be visible at t=3 with the fixture captions.json');

  await realClick(outer, zoomToggleRect.x, zoomToggleRect.y);
  await sleep(150);
  const preset200b = await evalActive(`(() => {
    const el = document.querySelector('.zoom-preset[data-zoom="2"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await realClick(outer, preset200b.x, preset200b.y);
  await sleep(300);
  const captionOverlayAtZoom = await evalActive(`(() => {
    const plain = r => r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
    const layerRect = plain(document.getElementById('zoom-layer').getBoundingClientRect());
    const videoRect = plain(document.getElementById('preview-video').getBoundingClientRect());
    const overlayEl = document.querySelector('[data-overlay-id="cap-a"]');
    const overlayRect = plain(overlayEl && overlayEl.getBoundingClientRect());
    const captionRect = plain(document.getElementById('caption-plate').getBoundingClientRect());
    return { layerRect, videoRect, overlayRect, captionRect };
  })()`);
  record('caption-overlay-at-zoom-200', captionOverlayAtZoom);
  await screenshot(main, path.join(EVIDENCE_DIR, '06-zoom-200-captions-overlay.png'));

  // reset zoom back to 100% before the fullscreen check
  await realClick(outer, zoomToggleRect.x, zoomToggleRect.y);
  await sleep(150);
  await realClick(outer, preset100.x, preset100.y);
  await sleep(200);
  results.criterion7_caption_overlay_scaling = captionOverlayAtZoom;

  // =========================================================================
  // Criterion 8: fullscreen toggle
  // =========================================================================
  const fsToggleRect = await frameButtonRect('fullscreen-toggle');
  const maximizedBefore = await evalMain(main, `!!document.querySelector('.theia-maximized')`);
  await realClick(outer, fsToggleRect.x, fsToggleRect.y);
  await sleep(1200);
  // どちらの経路（webview 内 Fullscreen API / widget 最大化 fallback）でも
  // webview ターゲットが作り直され得るため、判定前に接続を張り直す
  let fsElementAfter = false;
  try {
    await connectWebview();
    fsElementAfter = await evalMain(outer, `document.fullscreenElement != null`);
  } catch (error) {
    record('fs-reconnect-after-enter', { err: String(error).slice(0, 200) });
  }
  const maximizedAfter = await evalMain(main, `!!document.querySelector('.theia-maximized')`);
  record('fullscreen-toggle-first-click', { maximizedBefore, fsElementAfter, maximizedAfter });
  await screenshot(main, path.join(EVIDENCE_DIR, '07-fullscreen-on.png'));
  const fullscreenPath = fsElementAfter ? 'webview-fullscreen' : (maximizedAfter && !maximizedBefore ? 'widget-maximize-fallback' : 'unknown');
  assert(fullscreenPath !== 'unknown', 'fullscreen-toggle must either enter webview Fullscreen API or trigger the widget-maximize fallback');

  // 復帰クリック: 最大化でレイアウトが変わるためボタン座標は再取得する
  const fsToggleRect2 = await frameButtonRect('fullscreen-toggle');
  await realClick(outer, fsToggleRect2.x, fsToggleRect2.y);
  await sleep(1200);
  try {
    await connectWebview();
  } catch (error) {
    record('fs-reconnect-after-exit', { err: String(error).slice(0, 200) });
  }
  const fsElementRestored = await evalMain(outer, `document.fullscreenElement != null`);
  const maximizedRestored = await evalMain(main, `!!document.querySelector('.theia-maximized')`);
  record('fullscreen-toggle-second-click', { fsElementRestored, maximizedRestored });
  await screenshot(main, path.join(EVIDENCE_DIR, '08-fullscreen-off.png'));
  if (fullscreenPath === 'webview-fullscreen') {
    assert(fsElementRestored === false, 'second click must exit webview fullscreen');
  } else {
    assert(maximizedRestored === maximizedBefore, 'second click must restore the widget-maximize state');
  }
  results.criterion8_fullscreen = { fullscreenPath, maximizedBefore, fsElementAfter, maximizedAfter, fsElementRestored, maximizedRestored };

  // =========================================================================
  // Criterion 9 (partial - non inspector-writeback regressions):
  // seekbar drag, space-key playback, external akari-preview-seek message
  // =========================================================================
  await setTimePaused(5);
  const seekRect = await evalActive(`(() => {
    const r = document.getElementById('seek').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await realClick(outer, seekRect.x, seekRect.y);
  await sleep(100);
  const beforeArrow = await evalActive(`document.getElementById('preview-video').currentTime`);
  for (let i = 0; i < 5; i++) {
    await realKey(outer, 'ArrowRight', 'ArrowRight', 39);
    await sleep(40);
  }
  await sleep(150);
  const afterArrow = await evalActive(`document.getElementById('preview-video').currentTime`);
  record('regression-seekbar-arrow-keys', { beforeArrow, afterArrow });
  assert(afterArrow !== beforeArrow, 'seek input must still change video.currentTime (regression: seekbar)');

  // 直前のシークバー操作でフォーカスが input[type=range] に残っていると、
  // 実装の isEditable ガード（正しい挙動）により Space が無視されるため、必ず blur してから送る
  const bodyFocus = await evalActive(`(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return document.activeElement === document.body;
  })()`);
  const pausedBeforeSpace = await evalActive(`document.getElementById('preview-video').paused`);
  await realKey(outer, ' ', 'Space', 32);
  await sleep(300);
  const pausedAfterSpace = await evalActive(`document.getElementById('preview-video').paused`);
  record('regression-space-key', { bodyFocus, pausedBeforeSpace, pausedAfterSpace });
  assert(pausedAfterSpace !== pausedBeforeSpace, 'space key must still toggle playback (regression: space key)');
  // leave it paused for determinism
  if (!(await evalActive(`document.getElementById('preview-video').paused`))) {
    await realKey(outer, ' ', 'Space', 32);
    await sleep(300);
  }

  const externalSeekResult = await evalActive(`(() => {
    const v = document.getElementById('preview-video');
    return new Promise(resolve => {
      const done = () => { v.removeEventListener('seeked', done); resolve(v.currentTime); };
      v.addEventListener('seeked', done, { once: true });
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'akari-preview-seek', time: 12.5 } }));
    });
  })()`);
  record('regression-external-seek-message', { externalSeekResult });
  assert(Math.abs(externalSeekResult - 12.5) < 0.05, `external akari-preview-seek message must move currentTime to ~12.5, got ${externalSeekResult}`);
  results.criterion9_regressions_partial = {
    seekbarArrowKeys: { beforeArrow, afterArrow },
    spaceKey: { pausedBeforeSpace, pausedAfterSpace },
    externalSeek: externalSeekResult
  };

  outer.close();
  main.close();

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  await writeFile(path.join(EVIDENCE_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log('SUCCESS: all transport/zoom/pan/minimap/fullscreen/regression checks passed.');
}

main().catch(err => {
  console.error('FAILED', err);
  process.exit(1);
});
