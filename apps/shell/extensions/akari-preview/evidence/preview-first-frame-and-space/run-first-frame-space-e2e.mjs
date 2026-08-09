#!/usr/bin/env node
// L1 verification for task 2026-08-09-preview-first-frame-and-space.
// Pattern lifted from evidence/preview-audio-wiring/run-real-electron-audio-e2e.mjs in the
// same extension: puppeteer-core drives the outer window (quick-open), a small raw-CDP client
// reaches the nested Theia webview active-frame to read/observe real DOM + <video> state.
// Usage: node run-first-frame-space-e2e.mjs <port> <workspaceDir> <evidenceDir>

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const [, , portArg, workspaceDirArg, evidenceArg] = process.argv;
const port = Number(portArg || 9456);
const evidenceDir = evidenceArg;
const log = [];

function record(step, data) {
  const entry = { step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message, data) {
  if (!condition) {
    record('FAIL', { message, data });
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  record('assert-ok', { message });
}

class CDP {
  constructor(url) {
    this.url = url;
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
      for (const listener of this.listeners.get(message.method) || []) listener(message.params);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  close() {
    this.socket.close();
  }
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function evaluate(cdp, expression, contextId) {
  const response = await Promise.race([
    cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('evaluation timed out')), 15000))
  ]);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function click(cdp, x, y, clickCount = 1) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let count = 1; count <= clickCount; count += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
    await sleep(60);
  }
}

async function retry(fn, description, attempts = 60, intervalMs = 300) {
  let value;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      value = await fn();
    } catch (error) {
      lastError = error;
      value = undefined;
    }
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`${description} not found${lastError ? ` (last error: ${lastError})` : ''}`);
}

async function focusOutsideAnyIframe(page) {
  // The app's own "ホーム" (Home) tab renders as a webview iframe and grabs initial focus,
  // which swallows Cmd+P (keydown never bubbles out of the iframe to Theia's keybinding
  // service on the top document). Click a plain DOM tab-bar label first to move focus out.
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.lm-TabBar-tab')).map(tab => {
    const rect = tab.getBoundingClientRect();
    const label = tab.querySelector('.lm-TabBar-tabLabel');
    return { text: label ? label.textContent : '', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }));
  const target = tabs.find(tab => tab.w > 0 && tab.h > 0 && tab.text === 'ホーム') || tabs.find(tab => tab.w > 0 && tab.h > 0);
  if (target) {
    await page.mouse.click(target.x, target.y);
    await sleep(200);
  }
}

async function openFileByQuickOpen(page, fileName, excludeIframeIds) {
  await page.bringToFront();
  await focusOutsideAnyIframe(page);
  let hasWidget = false;
  for (let attempt = 0; attempt < 10 && !hasWidget; attempt += 1) {
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyP');
    await page.keyboard.up('Meta');
    await sleep(700);
    hasWidget = await page.evaluate(() => Boolean(document.querySelector('.quick-input-widget')));
    if (!hasWidget) {
      record('quick-open-retry', { fileName, attempt });
      await page.keyboard.press('Escape');
      await sleep(300);
      await focusOutsideAnyIframe(page);
    }
  }
  assert(hasWidget, `quick-open widget appeared for ${fileName}`);
  await page.keyboard.type(fileName, { delay: 25 });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(2500);
  const iframeTarget = await retry(async () => {
    const list = await targets();
    return list.find(item => item.type === 'iframe'
      && /webview\/index\.html\?id=akari-(output-)?preview-/.test(item.url)
      && !excludeIframeIds.has(item.id));
  }, `new preview webview iframe target for ${fileName}`);
  record('opened-file', { fileName, iframeTargetId: iframeTarget.id });
  return iframeTarget;
}

// The webview target can be replaced (widget-open retried under system load, see
// getOrOpenPreview's PREVIEW_OPEN_ATTEMPTS/withOpenTimeout) between when we first spot it and
// when we actually need to evaluate inside it. Re-resolve the *current* matching target fresh
// on every outer attempt instead of trusting a target snapshot captured once.
async function connectActiveFrameByUrlPattern(urlPattern, excludeIframeIds, description, overallAttempts = 12) {
  let lastError;
  for (let attempt = 0; attempt < overallAttempts; attempt += 1) {
    try {
      const list = await targets();
      const candidate = list.find(item => item.type === 'iframe'
        && urlPattern.test(item.url)
        && !excludeIframeIds.has(item.id));
      if (!candidate) throw new Error(`no matching iframe target yet for ${description}`);
      return { ...(await connectActiveFrame(candidate)), iframeTarget: candidate };
    } catch (error) {
      lastError = error;
      record('connectActiveFrameByUrlPattern-retry', { attempt, description, error: String(error) });
      await sleep(1500);
    }
  }
  throw lastError;
}

async function connectActiveFrame(iframeTarget) {
  let lastError;
  for (let outerAttempt = 0; outerAttempt < 6; outerAttempt += 1) {
    const outer = new CDP(iframeTarget.webSocketDebuggerUrl);
    try {
      await outer.connect();
      const contexts = [];
      outer.on('Runtime.executionContextCreated', params => contexts.push(params.context));
      await outer.send('Page.enable');
      await outer.send('Runtime.enable');
      await sleep(800);
      const tree = await outer.send('Page.getFrameTree');
      const topFrame = tree.frameTree.frame.id;
      const active = await retry(
        () => contexts.find(context => context.auxData?.frameId !== topFrame && context.auxData?.isDefault === true),
        'inner active-frame execution context',
        15, 400
      );
      return { outer, contextId: active.id };
    } catch (error) {
      lastError = error;
      record('connectActiveFrame-retry', { outerAttempt, error: String(error) });
      outer.close();
      await sleep(500);
    }
  }
  throw lastError;
}

// canvas-transfer pixel average, matching the 司令塔's own baseline measurement method
// (drawImage the <video> element into an offscreen canvas, average R/G/B across all pixels).
const PIXEL_AVG_EXPR = `(() => {
  const video = document.getElementById('preview-video');
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (!(w > 0) || !(h > 0)) return { avg: null, videoWidth: w, videoHeight: h };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (error) {
    return { avg: null, error: String(error), tainted: true };
  }
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  const avg = sum / (data.length / 4);
  const videoStyle = getComputedStyle(video);
  const overlayStage = document.getElementById('overlay-stage');
  const overlayStyle = overlayStage ? getComputedStyle(overlayStage) : null;
  const transitionPlate = document.getElementById('transition-plate');
  const transitionStyle = transitionPlate ? getComputedStyle(transitionPlate) : null;
  return {
    avg,
    videoWidth: w,
    videoHeight: h,
    readyState: video.readyState,
    paused: video.paused,
    currentTime: video.currentTime,
    videoVisibility: videoStyle.visibility,
    videoOpacity: videoStyle.opacity,
    videoDisplay: videoStyle.display,
    videoZIndex: videoStyle.zIndex,
    overlayOpacity: overlayStyle ? overlayStyle.opacity : null,
    overlayZIndex: overlayStyle ? overlayStyle.zIndex : null,
    overlayBackground: overlayStyle ? overlayStyle.backgroundColor : null,
    transitionOpacity: transitionStyle ? transitionStyle.opacity : null
  };
})()`;

// Re-resolves the live target + reconnects from scratch on every outer attempt: under heavy
// system load the webview widget can be discarded/recreated (getOrOpenPreview retry) after we
// first spot its target, leaving a stale connection that never reaches readyState>=1.
async function measureFirstFrame(urlPattern, excludeIframeIds, label, overallAttempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < overallAttempts; attempt += 1) {
    let outer;
    try {
      const connection = await connectActiveFrameByUrlPattern(urlPattern, excludeIframeIds, label, 4);
      outer = connection.outer;
      const { contextId } = connection;
      await retry(
        () => evaluate(outer, `(() => { const v = document.getElementById('preview-video'); return v && v.readyState >= 1 ? true : null; })()`, contextId),
        `${label}: video reaches readyState>=1 (HAVE_METADATA)`,
        20, 500
      );
      const pixel = await evaluate(outer, PIXEL_AVG_EXPR, contextId);
      record(`${label}-first-frame-pixel`, pixel);
      return { pixel, outer, contextId, iframeTarget: connection.iframeTarget };
    } catch (error) {
      lastError = error;
      record('measureFirstFrame-retry', { attempt, label, error: String(error) });
      if (outer) outer.close();
      await sleep(1000);
    }
  }
  throw lastError;
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  const page = (await browser.pages())[0];
  page.on('console', message => record('console', { type: message.type(), text: message.text() }));
  record('connected', { url: page.url() });

  // --- Scenario 1: raw single-file preview (double-click / open a bare video file) ---
  const excludeIds1 = new Set();
  await openFileByQuickOpen(page, 'clip-a.mp4', excludeIds1);
  const { pixel: rawFirstFrame, outer: outer1, contextId: contextId1, iframeTarget: iframe1 } =
    await measureFirstFrame(/webview\/index\.html\?id=akari-preview-/, excludeIds1, 'raw-preview');
  const raw1 = measurePixel => evaluate(outer1, measurePixel, contextId1);
  await page.screenshot({ path: path.join(evidenceDir, '01-raw-preview-before-play.png') });

  // Space toggle test: focus the webview (click it, but avoid hitting any specific control),
  // then dispatch a real keydown for Space and observe video.paused before/after.
  const wrapperRect1 = await raw1(`(() => {
    const rect = document.getElementById('preview-wrapper').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.15 };
  })()`);
  await click(outer1, wrapperRect1.x, wrapperRect1.y);
  await sleep(200);
  const pausedBeforeSpace1 = await raw1(`document.getElementById('preview-video').paused`);
  await outer1.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await outer1.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(500);
  const pausedAfterSpace1 = await raw1(`document.getElementById('preview-video').paused`);
  record('raw-preview-space-toggle', { pausedBeforeSpace1, pausedAfterSpace1 });
  await page.screenshot({ path: path.join(evidenceDir, '02-raw-preview-after-space.png') });

  // Space-while-typing regression check: focus the seek input's proxy -- there is no text input in
  // this webview by default, so we simulate by focusing document.body vs an editable target via a
  // temporary contenteditable probe appended to the DOM (does not exist in production markup, only
  // used here to prove the isEditable() guard genuinely inspects the focused element).
  const pausedBeforeSpaceWhileTyping = await raw1(`document.getElementById('preview-video').paused`);
  await raw1(`(() => {
    const probe = document.createElement('textarea');
    probe.id = 'akari-test-probe-textarea';
    document.body.appendChild(probe);
    probe.focus();
  })()`);
  await outer1.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await outer1.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(400);
  const pausedAfterSpaceWhileTyping = await raw1(`document.getElementById('preview-video').paused`);
  await raw1(`document.getElementById('akari-test-probe-textarea')?.remove()`);
  record('raw-preview-space-while-typing', { pausedBeforeSpaceWhileTyping, pausedAfterSpaceWhileTyping });
  assert(pausedBeforeSpaceWhileTyping === pausedAfterSpaceWhileTyping,
    'space key while a text field is focused does not toggle playback',
    { pausedBeforeSpaceWhileTyping, pausedAfterSpaceWhileTyping });

  // stop playback / return to a clean paused state before moving on
  const stillPlaying1 = await raw1(`!document.getElementById('preview-video').paused`);
  if (stillPlaying1) {
    await outer1.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await outer1.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(300);
  }

  // --- Scenario 2: output preview (edit.json / timeline, multi-source cuts) ---
  const excludeIds2 = new Set([iframe1.id]);
  await openFileByQuickOpen(page, 'edit.json', excludeIds2);
  const { pixel: outputFirstFrame, outer: outer2, contextId: contextId2, iframeTarget: iframe2 } =
    await measureFirstFrame(/webview\/index\.html\?id=akari-output-preview-/, excludeIds2, 'output-preview');
  const raw2 = expr => evaluate(outer2, expr, contextId2);
  await page.screenshot({ path: path.join(evidenceDir, '03-output-preview-before-play.png') });

  // regression: cuts[].src switching still works (play through cut1 -> cut2, check src swap)
  const srcBeforePlay = await raw2(`document.getElementById('preview-video').getAttribute('src')`);
  const wrapperRect2 = await raw2(`(() => {
    const rect = document.getElementById('preview-wrapper').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.15 };
  })()`);
  await click(outer2, wrapperRect2.x, wrapperRect2.y);
  await sleep(150);
  const playRect2 = await raw2(`(() => {
    const rect = document.getElementById('play-toggle').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(outer2, playRect2.x, playRect2.y);
  const cutSwitched = await retry(async () => {
    const src = await raw2(`document.getElementById('preview-video').getAttribute('src')`);
    return src && src !== srcBeforePlay ? src : null;
  }, 'cuts[].src swap to second source after playing through cut1', 40, 200);
  record('output-preview-cut-switch', { srcBeforePlay, cutSwitched });
  await page.screenshot({ path: path.join(evidenceDir, '04-output-preview-cut-switched.png') });
  await click(outer2, playRect2.x, playRect2.y); // pause again

  // Space toggle on output preview too (the timeline-driven TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND
  // path is separate from this in-webview handler; both must not double-fire).
  await click(outer2, wrapperRect2.x, wrapperRect2.y);
  await sleep(150);
  const pausedBeforeSpace2 = await raw2(`document.getElementById('preview-video').paused`);
  await outer2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await outer2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(500);
  const pausedAfterSpace2 = await raw2(`document.getElementById('preview-video').paused`);
  record('output-preview-space-toggle', { pausedBeforeSpace2, pausedAfterSpace2 });
  await page.screenshot({ path: path.join(evidenceDir, '05-output-preview-after-space.png') });
  const stillPlaying2 = await raw2(`!document.getElementById('preview-video').paused`);
  if (stillPlaying2) {
    await outer2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await outer2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  }

  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    rawFirstFrame, outputFirstFrame, log
  }, null, 2)}\n`);
  outer1.close();
  outer2.close();
  await browser.disconnect();
  record('ALL-DONE', {});
}

main().then(() => process.exit(0)).catch(async error => {
  record('failure', { error: error.stack || String(error) });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log-failed.json'), `${JSON.stringify({ log }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
