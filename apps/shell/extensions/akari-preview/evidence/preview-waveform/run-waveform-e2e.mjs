#!/usr/bin/env node
// Dependency-free raw-CDP waveform-strip verification for the Theia webview.
// Usage: node run-waveform-e2e.mjs <port> <workspace> <videoRelPath> <evidenceDir> <waveform|fallback>

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , portArg, workspaceArg, videoArg, evidenceArg, modeArg] = process.argv;
const port = Number(portArg || 9333);
const workspace = workspaceArg || '/tmp/akari-waveform/workspace';
const videoPath = videoArg || 'exports/sample.mp4';
const evidenceDir = evidenceArg || '/tmp/akari-waveform/evidence';
const mode = modeArg || 'waveform';
const log = [];

function record(step, data) {
  const entry = { at: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
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
    cdp.send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true
    }),
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

async function screenshot(cdp, fileName) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidenceDir, fileName), Buffer.from(data, 'base64'));
}

async function retry(fn, description, attempts = 30) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    value = await fn();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`${description} not found`);
}

async function openVideo(main) {
  await sleep(2000);
  const mainEval = expression => evaluate(main, expression);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const explorer = await mainEval(`(() => {
      const row = document.querySelector('.theia-TreeNode');
      if (row && row.getBoundingClientRect().width > 0) return { open: true };
      const icon = Array.from(document.querySelectorAll('.codicon-files'))
        .find(candidate => candidate.getBoundingClientRect().width > 0);
      if (!icon) return null;
      const rect = icon.getBoundingClientRect();
      return { open: false, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (explorer?.open) break;
    if (explorer) await click(main, explorer.x, explorer.y);
    await sleep(700);
  }

  const row = label => mainEval(`(() => {
    const candidate = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]'))
      .find(element => element.textContent.trim() === ${JSON.stringify(label)});
    if (!candidate) return null;
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 ? { x: rect.left + 20, y: rect.top + rect.height / 2 } : null;
  })()`);
  const directoryName = videoPath.split('/')[0];
  const fileName = path.basename(videoPath);
  const directory = await retry(() => row(directoryName), `directory row ${directoryName}`);
  let file = await row(fileName);
  for (let attempt = 0; attempt < 4 && !file; attempt += 1) {
    await click(main, directory.x, directory.y);
    await sleep(700);
    file = await row(fileName);
  }
  if (!file) file = await retry(() => row(fileName), `file row ${fileName}`);
  await click(main, file.x, file.y, 2);
  await sleep(1500);
  record('opened-video', { fileName, workspace });
}

async function connectActiveFrame() {
  const target = await retry(async () => {
    const list = await targets();
    return list.find(item => item.type === 'iframe' && /webview\/index\.html/.test(item.url));
  }, 'outer webview target');
  const outer = new CDP(target.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');
  await sleep(400);
  const tree = await outer.send('Page.getFrameTree');
  const topFrame = tree.frameTree.frame.id;
  const active = contexts.find(context => context.auxData?.frameId !== topFrame);
  if (!active) throw new Error('inner active-frame context not found');
  return { outer, contextId: active.id };
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const list = await targets();
  const page = list.find(target => target.type === 'page');
  if (!page) throw new Error('main page target not found');
  const frontend = new CDP(page.webSocketDebuggerUrl);
  await frontend.connect();
  await frontend.send('Page.enable');
  await frontend.send('Runtime.enable');
  await openVideo(frontend);

  const { outer, contextId } = await connectActiveFrame();
  const active = expression => evaluate(outer, expression, contextId);
  const initial = await active(`(() => {
    const row = document.querySelector('.transport-waveform');
    const toggle = document.getElementById('waveform-toggle');
    const left = Array.from(document.querySelector('.transport-left').children).map(node => node.id);
    return { hidden: row.hidden, pressed: toggle.getAttribute('aria-pressed'), left };
  })()`);
  record('initial-state', initial);
  assert(initial.hidden && initial.pressed === 'false', 'waveform row starts hidden and aria-pressed=false');
  assert(JSON.stringify(initial.left) === JSON.stringify(['waveform-toggle', 'time-label']), 'waveform toggle is first in the left zone');

  await active(`(() => {
    window.__waveformE2eTexts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.__waveformE2eTexts.push(String(text));
      return original.call(this, text, ...args);
    };
  })()`);

  const toggleRect = await active(`(() => {
    const rect = document.getElementById('waveform-toggle').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(outer, toggleRect.x, toggleRect.y);

  const visible = await retry(async () => active(`(() => {
    const row = document.querySelector('.transport-waveform');
    const seek = document.querySelector('.transport-seek');
    const rowRect = row.getBoundingClientRect();
    const seekRect = seek.getBoundingClientRect();
    if (row.hidden || rowRect.width <= 0) return null;
    return {
      hidden: row.hidden,
      pressed: document.getElementById('waveform-toggle').getAttribute('aria-pressed'),
      height: rowRect.height,
      width: rowRect.width,
      seekWidth: seekRect.width,
      rowBottom: rowRect.bottom,
      seekTop: seekRect.top
    };
  })()`), 'visible waveform row');
  record('visible-layout', visible);
  assert(visible.pressed === 'true', 'aria-pressed follows the visible state');
  assert(Math.abs(visible.height - 56) <= 1, `waveform row height is 56px (actual ${visible.height})`);
  assert(Math.abs(visible.width - visible.seekWidth) <= 1, 'waveform and seek rows have equal width');
  assert(visible.rowBottom <= visible.seekTop + 1, 'waveform row is immediately above the seek row');

  if (mode === 'waveform') {
    const pixels = await retry(async () => {
      const counts = await active(`(() => {
        const canvas = document.getElementById('waveform-canvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let cyan = 0; let orange = 0; let nonBackground = 0;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index]; const g = data[index + 1]; const b = data[index + 2];
          if (r === 34 && g === 211 && b === 238) cyan += 1;
          if (r === 249 && g === 115 && b === 22) orange += 1;
          if (r !== 24 || g !== 24 || b !== 24) nonBackground += 1;
        }
        return { cyan, orange, nonBackground, width: canvas.width, height: canvas.height };
      })()`);
      return counts.cyan > 100 && counts.orange > 100 ? counts : null;
    }, 'rendered cyan and orange waveform pixels', 360);
    record('waveform-pixels', pixels);
    assert(pixels.nonBackground > 1000, 'canvas contains waveform pixels above the background');
    await screenshot(frontend, '01-waveform-visible.png');

    const canvasRect = await active(`(() => {
      const rect = document.getElementById('waveform-canvas').getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    })()`);
    await click(outer, canvasRect.left + canvasRect.width * 0.25, canvasRect.top + canvasRect.height / 2);
    await sleep(250);
    const seekResult = await active(`(() => {
      const video = document.getElementById('preview-video');
      return { currentTime: video.currentTime, duration: video.duration };
    })()`);
    record('waveform-seek-25-percent', seekResult);
    assert(Math.abs(seekResult.currentTime - seekResult.duration * 0.25) <= 0.3, '25% waveform click seeks to 25% of duration within 0.3s');

    const playRect = await active(`(() => {
      const rect = document.getElementById('play-toggle').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await click(outer, playRect.x, playRect.y);
    const playhead = [];
    for (let sample = 0; sample < 4; sample += 1) {
      await sleep(250);
      playhead.push(await active(`parseFloat(document.querySelector('.transport-waveform-playhead').style.left)`));
    }
    record('playhead-samples', { playhead });
    assert(playhead.every((value, index) => index === 0 || value > playhead[index - 1]), 'playhead left percentage increases during playback');
    await click(outer, playRect.x, playRect.y);
  } else {
    const fallback = await retry(async () => {
      const counts = await active(`(() => {
        const canvas = document.getElementById('waveform-canvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let gray = 0; let cyan = 0;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index]; const g = data[index + 1]; const b = data[index + 2];
          if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2 && r > 80) gray += 1;
          if (r === 34 && g === 211 && b === 238) cyan += 1;
        }
        return { gray, cyan };
      })()`);
      return counts.gray > 30 && counts.cyan === 0 ? counts : null;
    }, 'fallback message pixels', 180);
    const transport = await active(`(() => ({
      playDisabled: document.getElementById('play-toggle').disabled,
      seekDisabled: document.getElementById('seek').disabled,
      waveformDisabled: document.getElementById('waveform-toggle').disabled,
      drawnTexts: window.__waveformE2eTexts
    }))()`);
    record('fallback-state', { ...fallback, ...transport });
    assert(transport.drawnTexts.includes('この動画の波形は生成できません'), 'canvas draws the exact no-audio fallback text');
    assert(!transport.playDisabled && !transport.seekDisabled && !transport.waveformDisabled, 'transport remains enabled when audio decoding fails');
    await screenshot(frontend, '02-waveform-fallback.png');
  }

  await click(outer, toggleRect.x, toggleRect.y);
  const closed = await active(`(() => ({
    hidden: document.querySelector('.transport-waveform').hidden,
    pressed: document.getElementById('waveform-toggle').getAttribute('aria-pressed')
  }))()`);
  record('closed-state', closed);
  assert(closed.hidden && closed.pressed === 'false', 'second toggle hides the row and resets aria-pressed');

  await writeFile(path.join(evidenceDir, `run-log-${mode}.json`), `${JSON.stringify(log, null, 2)}\n`);
  outer.close();
  frontend.close();
}

main().then(() => process.exit(0)).catch(async error => {
  record('failure', { error: error.stack || String(error) });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `run-log-${mode}-failed.json`), `${JSON.stringify(log, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
