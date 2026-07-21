#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , portArg, evidenceDirArg] = process.argv;
const cdpPort = Number(portArg || 9364);
const evidenceDir = evidenceDirArg;
const records = [];
const mainConsole = [];

function record(step, data) {
  const entry = { at: new Date().toISOString(), step, ...data };
  records.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message, data = {}) {
  if (!condition) {
    record(`FAIL: ${message}`, data);
    throw new Error(message);
  }
}

class CDP {
  constructor(webSocketDebuggerUrl) {
    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketDebuggerUrl);
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

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  return response.json();
}

function consoleText(params) {
  return (params.args || []).map(argument => argument.value ?? argument.description ?? '').join(' ');
}

async function evaluate(cdp, expression, contextId, userGesture = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    ...(contextId ? { contextId } : {}),
    returnByValue: true,
    awaitPromise: true,
    userGesture
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function click(cdp, x, y, clickCount = 1) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
}

async function screenshot(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidenceDir, name), Buffer.from(result.data, 'base64'));
}

async function openExplorerEntry(main, label, doubleClick = true) {
  let row;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    row = await evaluate(main, `(() => {
      const rows = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]'));
      const target = rows.find(candidate => candidate.textContent.trim() === ${JSON.stringify(label)});
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.left + 24, y: rect.top + rect.height / 2, collapsed: Boolean(target.querySelector('.theia-mod-collapsed')) };
    })()`);
    if (row) break;
    await sleep(250);
  }
  assert(row, `Explorer entry not found: ${label}`);
  await click(main, row.x, row.y, doubleClick ? 2 : 1);
  await sleep(500);
  return row;
}

async function resolvePreview(expectedVideoBase) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets = (await listTargets()).filter(target => target.type === 'iframe' && /webview\/index\.html/.test(target.url));
    for (const target of targets) {
      const cdp = new CDP(target.webSocketDebuggerUrl);
      await cdp.connect();
      const contexts = [];
      cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await sleep(120);
      for (const context of contexts) {
        try {
          const videoUri = await evaluate(cdp, 'window.__akariPreview && window.__akariPreview.videoUri', context.id);
          if (typeof videoUri === 'string' && videoUri.includes(expectedVideoBase)) {
            const consoleEntries = [];
            cdp.on('Runtime.consoleAPICalled', params => consoleEntries.push({
              type: params.type,
              text: consoleText(params)
            }));
            return { cdp, contextId: context.id, consoleEntries };
          }
        } catch {
          // The top/placeholder context does not expose the preview state.
        }
      }
      cdp.close();
    }
    await sleep(250);
  }
  throw new Error(`preview context not found for ${expectedVideoBase}`);
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  let mainTarget;
  for (let attempt = 0; attempt < 30 && !mainTarget; attempt += 1) {
    mainTarget = (await listTargets()).find(target => target.type === 'page');
    if (!mainTarget) await sleep(250);
  }
  assert(mainTarget, 'main Electron page target not found');
  const shell = new CDP(mainTarget.webSocketDebuggerUrl);
  await shell.connect();
  shell.on('Runtime.consoleAPICalled', params => mainConsole.push({ type: params.type, text: consoleText(params) }));
  await shell.send('Page.enable');
  await shell.send('Runtime.enable');

  const explorer = await evaluate(shell, `(() => {
    const visibleRow = Array.from(document.querySelectorAll('.theia-TreeNode')).some(row => row.getBoundingClientRect().width > 0);
    const icon = Array.from(document.querySelectorAll('.codicon-files')).find(element => element.getBoundingClientRect().width > 0);
    if (!icon) return { visibleRow, icon: null };
    const rect = icon.getBoundingClientRect();
    return { visibleRow, icon: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
  })()`);
  if (!explorer.visibleRow && explorer.icon) {
    await click(shell, explorer.icon.x, explorer.icon.y);
    await sleep(500);
  }

  await openExplorerEntry(shell, 'fixture-video.mp4');
  await sleep(1200);
  const audioPreview = await resolvePreview('fixture-video.mp4');
  await sleep(1000);
  const decodedState = await evaluate(audioPreview.cdp, 'window.akari.previewAudioDebug()', audioPreview.contextId);
  record('audio-decoded', decodedState);
  assert(decodedState.decoded.bgm === true, 'BGM was not decoded', decodedState);
  assert(decodedState.decoded.sfx.length === 1, 'valid SFX was not decoded exactly once', decodedState);
  assert(decodedState.decoded.narration.length === 1, 'narration was not decoded exactly once', decodedState);

  await evaluate(audioPreview.cdp, `(() => {
    const video = document.getElementById('preview-video');
    video.currentTime = 0;
    document.getElementById('play-toggle').click();
    return true;
  })()`, audioPreview.contextId, true);
  await sleep(650);
  const scheduledState = await evaluate(audioPreview.cdp, 'window.akari.previewAudioDebug()', audioPreview.contextId);
  record('audio-scheduled-outside-duck', scheduledState);
  assert(scheduledState.contextState === 'running', 'AudioContext did not resume from play gesture', scheduledState);
  assert(scheduledState.active.bgm === 1, 'BGM source was not scheduled', scheduledState);
  assert(scheduledState.active.sfx === 1, 'SFX source was not scheduled', scheduledState);
  assert(scheduledState.active.narration === 1, 'narration source was not scheduled', scheduledState);
  assert(scheduledState.duckGainDb === 0, 'BGM was ducked outside narration interval', scheduledState);

  await evaluate(audioPreview.cdp, `(() => {
    document.getElementById('preview-video').currentTime = 2.2;
    return true;
  })()`, audioPreview.contextId);
  await sleep(350);
  const duckedState = await evaluate(audioPreview.cdp, 'window.akari.previewAudioDebug()', audioPreview.contextId);
  record('audio-ducked-inside-narration', duckedState);
  const expectedDuckedLinear = Math.pow(10, (-18 - 12) / 20);
  assert(duckedState.duckGainDb === -12, 'BGM duck gain was not -12dB in narration interval', duckedState);
  assert(Math.abs(duckedState.bgmGainLinear - expectedDuckedLinear) < 0.00001,
    'BGM linear gain did not equal base -18dB plus duck -12dB', { duckedState, expectedDuckedLinear });

  const masterMirror = await evaluate(audioPreview.cdp, `(() => {
    const video = document.getElementById('preview-video');
    video.volume = 0.4;
    const volume = window.akari.previewAudioDebug().masterGainLinear;
    video.muted = true;
    const muted = window.akari.previewAudioDebug().masterGainLinear;
    video.muted = false;
    video.volume = 1;
    video.pause();
    return { volume, muted };
  })()`, audioPreview.contextId);
  record('master-gain-mirror', masterMirror);
  assert(Math.abs(masterMirror.volume - 0.4) < 0.0001 && masterMirror.muted === 0,
    'video volume/muted state was not mirrored to master gain', masterMirror);
  await screenshot(shell, '01-audio-preview.png');

  const missingWarning = mainConsole.find(entry => entry.text.includes('audio.sfx[1]')
    && entry.text.includes('音声ファイルを配信できません'));
  record('missing-file-degradation', { observed: Boolean(missingWarning), warning: missingWarning || null });
  assert(missingWarning, 'missing SFX warning was not observed in shell console', { mainConsole });

  await openExplorerEntry(shell, 'no-audio');
  await openExplorerEntry(shell, 'no-audio-video.mp4');
  await sleep(1000);
  const noAudioPreview = await resolvePreview('no-audio-video.mp4');
  const noAudioInitial = await evaluate(noAudioPreview.cdp, `(() => ({
    audio: window.akari.previewAudioDebug(),
    readyState: document.getElementById('preview-video').readyState,
    currentTime: document.getElementById('preview-video').currentTime
  }))()`, noAudioPreview.contextId);
  record('no-audio-initial', noAudioInitial);
  assert(noAudioInitial.audio.disabled === true, 'audio-less project unexpectedly created supplemental AudioContext', noAudioInitial);
  await evaluate(noAudioPreview.cdp, `(() => {
    document.getElementById('play-toggle').click();
    return true;
  })()`, noAudioPreview.contextId, true);
  await sleep(500);
  const noAudioPlaying = await evaluate(noAudioPreview.cdp, `(() => {
    const video = document.getElementById('preview-video');
    const result = { paused: video.paused, currentTime: video.currentTime, audio: window.akari.previewAudioDebug() };
    video.pause();
    return result;
  })()`, noAudioPreview.contextId);
  record('no-audio-playing', noAudioPlaying);
  assert(noAudioPlaying.paused === false && noAudioPlaying.currentTime > 0.1,
    'audio-less project did not retain normal preview playback', noAudioPlaying);
  assert(noAudioPlaying.audio.disabled === true, 'audio-less project changed supplemental audio state', noAudioPlaying);
  await screenshot(shell, '02-no-audio-regression.png');

  record('ALL-PASS', {
    decoded: { bgm: 1, sfx: 1, narration: 1 },
    duckGainDb: duckedState.duckGainDb,
    expectedDuckedLinear,
    missingFileSkipped: true,
    noAudioRegression: true
  });
  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify({ records, mainConsole }, null, 2));
  audioPreview.cdp.close();
  noAudioPreview.cdp.close();
  shell.close();
}

main().catch(async error => {
  console.error(error);
  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify({ records, mainConsole, error: String(error) }, null, 2)).catch(() => undefined);
  process.exitCode = 1;
});
