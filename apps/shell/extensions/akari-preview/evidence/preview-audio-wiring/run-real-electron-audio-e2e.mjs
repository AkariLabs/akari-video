#!/usr/bin/env node
// Wrapper-authored L1 verification: drives a real Electron instance of this app over CDP.
// puppeteer-core (from the main repo's node_modules, referenced read-only, not added as a
// dependency of this repo) handles the main-window quick-open/keyboard interaction reliably;
// a small raw-CDP client (pattern lifted from evidence/preview-waveform/run-waveform-e2e.mjs
// in the same extension) reaches into the nested Theia webview active-frame, which Puppeteer's
// target discovery does not enumerate, to read the real window.akari.previewAudio state.
// Usage: node run-real-electron-audio-e2e.mjs <port> <evidenceDir>

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const [, , portArg, evidenceArg] = process.argv;
const port = Number(portArg || 9455);
const evidenceDir = evidenceArg;
const log = [];
const consoleMessages = [];

function record(step, data) {
  const entry = { at: new Date().toISOString(), step, ...data };
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

async function retry(fn, description, attempts = 40) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    value = await fn();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`${description} not found`);
}

async function openFileByQuickOpen(page, fileName, excludeIframeIds) {
  await page.bringToFront();
  await page.keyboard.down('Meta');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Meta');
  await sleep(500);
  const hasWidget = await page.evaluate(() => Boolean(document.querySelector('.quick-input-widget')));
  assert(hasWidget, `quick-open widget appeared for ${fileName}`);
  await page.keyboard.type(fileName, { delay: 25 });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(2000);
  const iframeTarget = await retry(async () => {
    const list = await targets();
    return list.find(item => item.type === 'iframe'
      && /webview\/index\.html/.test(item.url)
      && !excludeIframeIds.has(item.id));
  }, `new preview webview iframe target for ${fileName}`);
  record('opened-file', { fileName, iframeTargetId: iframeTarget.id });
  return iframeTarget;
}

async function connectActiveFrame(iframeTarget) {
  const outer = new CDP(iframeTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');
  await sleep(600);
  const tree = await outer.send('Page.getFrameTree');
  const topFrame = tree.frameTree.frame.id;
  const active = await retry(
    () => contexts.find(context => context.auxData?.frameId !== topFrame && context.auxData?.isDefault === true),
    'inner active-frame execution context'
  );
  return { outer, contextId: active.id };
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  const page = (await browser.pages())[0];
  page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
  record('connected', { url: page.url() });

  // --- Scenario 1: bgm + sfx (incl. 1 missing) + narration + ducking:true ---
  const iframe1 = await openFileByQuickOpen(page, 'fixture-video.mp4', new Set());
  const { outer, contextId } = await connectActiveFrame(iframe1);
  const active = expression => evaluate(outer, expression, contextId);

  const summaryAudio = await retry(
    () => active(`window.__akariPreview && window.__akariPreview.summary && window.__akariPreview.summary.audio || null`),
    'parsed audio summary'
  );
  record('parsed-audio-summary', summaryAudio);
  assert(summaryAudio.bgm && summaryAudio.bgm.ducking === true && summaryAudio.bgm.gainDb === -18,
    'bgm parsed with ducking=true and gain_db=-18 from edit.json', summaryAudio);
  assert(summaryAudio.sfx.length === 1 && summaryAudio.sfx[0].t === 1,
    'only the resolvable sfx made it through node-side degradation (missing.wav dropped)', summaryAudio.sfx);
  assert(summaryAudio.narration.length === 1 && summaryAudio.narration[0].id === 'n-0001',
    'narration n-0001 parsed', summaryAudio.narration);

  const decodedState = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && state.decoded && state.decoded.bgm && state.decoded.sfx.length === 1 && state.decoded.narration.length === 1 ? state : null;
  }, 'decoded bgm/sfx/narration before playback');
  record('decoded-before-play', decodedState);
  // Not asserted: contextState before play can already be 'running' in this CDP-driven harness,
  // because the prior Enter keypress used to open the file counts as real user activation for
  // the whole top-level page in Chromium's autoplay-gating model, independent of the app's own
  // resume() wiring (which fires unconditionally on the play button's click either way).

  const playRect = await active(`(() => {
    const rect = document.getElementById('play-toggle').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(outer, playRect.x, playRect.y);

  const scheduled = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && state.contextState === 'running' && state.active.bgm === 1 && state.active.sfx === 1 && state.active.narration === 1
      ? state : null;
  }, 'bgm/sfx/narration all scheduled and AudioContext running after play');
  record('scheduled-after-play', scheduled);
  assert(Math.abs(scheduled.bgmGainLinear - Math.pow(10, -18 / 20)) < 0.001,
    'bgm gain reflects -18dB before entering the narration ducking window', scheduled);

  const ducked = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && state.duckGainDb === -12 ? state : null;
  }, 'bgm ducked by -12dB while narration n-0001 is playing (t=2..4)', 20);
  record('ducked-during-narration', ducked);
  const expectedDuckedLinear = Math.pow(10, (-18 - 12) / 20);
  assert(Math.abs(ducked.bgmGainLinear - expectedDuckedLinear) < 0.001,
    'ducked bgm linear gain matches 10^((-18-12)/20)', { ducked, expectedDuckedLinear });

  const restored = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && state.duckGainDb === 0 ? state : null;
  }, 'bgm gain restored once narration interval ends (t>=4)', 20);
  record('restored-after-narration', restored);

  await active(`(() => { document.getElementById('preview-video').muted = true; })()`);
  const mutedState = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && state.masterGainLinear === 0 ? state : null;
  }, 'master gain mirrors video.muted=true');
  record('master-gain-muted', mutedState);
  await active(`(() => { const v = document.getElementById('preview-video'); v.muted = false; v.volume = 0.4; })()`);
  const volumeState = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && Math.abs(state.masterGainLinear - 0.4) < 0.01 ? state : null;
  }, 'master gain mirrors video.volume=0.4');
  record('master-gain-volume', volumeState);

  await page.screenshot({ path: path.join(evidenceDir, '06-audio-playing.png') });
  await click(outer, playRect.x, playRect.y);
  const paused = await retry(async () => {
    const state = await active(`window.akari.previewAudioDebug()`);
    return state && state.active.bgm === 0 && state.active.sfx === 0 && state.active.narration === 0 ? state : null;
  }, 'all audio sources stop on pause');
  record('stopped-after-pause', paused);

  // --- Scenario 2: audio-less project non-regression (reuse the same running app) ---
  const iframe2 = await openFileByQuickOpen(page, 'no-audio-video.mp4', new Set([iframe1.id]));
  const { outer: outer2, contextId: contextId2 } = await connectActiveFrame(iframe2);
  const active2 = expression => evaluate(outer2, expression, contextId2);
  const noAudioSummary = await retry(
    () => active2(`window.__akariPreview && window.__akariPreview.summary ? { hasAudio: 'audio' in window.__akariPreview.summary } : null`),
    'no-audio summary parsed'
  );
  record('no-audio-summary', noAudioSummary);
  assert(noAudioSummary.hasAudio === false, 'summary.audio is absent for a project with no audio section', noAudioSummary);
  const noAudioDebug = await retry(() => active2(`window.akari.previewAudioDebug()`), 'no-audio previewAudioDebug');
  record('no-audio-debug', noAudioDebug);
  assert(noAudioDebug.disabled === true, 'no supplemental AudioContext is created for an audio-less project', noAudioDebug);

  const noAudioPlayRect = await active2(`(() => {
    const rect = document.getElementById('play-toggle').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(outer2, noAudioPlayRect.x, noAudioPlayRect.y);
  const noAudioPlaying = await retry(async () => {
    const state = await active2(`(() => {
      const video = document.getElementById('preview-video');
      return { paused: video.paused, currentTime: video.currentTime };
    })()`);
    return state && !state.paused && state.currentTime > 0 ? state : null;
  }, 'audio-less video still plays normally (no regression)');
  record('no-audio-video-plays', noAudioPlaying);
  await page.screenshot({ path: path.join(evidenceDir, '07-no-audio-playing.png') });
  await click(outer2, noAudioPlayRect.x, noAudioPlayRect.y);

  const missingSfxWarned = consoleMessages.some(entry => /audio\.sfx.*(を無視しました|missing)/i.test(entry.text));
  record('console-messages', { count: consoleMessages.length, missingSfxWarned, sample: consoleMessages.slice(0, 50) });

  await writeFile(path.join(evidenceDir, 'real-electron-run-log.json'), `${JSON.stringify({ log, consoleMessages }, null, 2)}\n`);
  outer.close();
  outer2.close();
  await browser.disconnect();
  record('ALL-PASS', {});
}

main().then(() => process.exit(0)).catch(async error => {
  record('failure', { error: error.stack || String(error) });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'real-electron-run-log-failed.json'), `${JSON.stringify({ log, consoleMessages }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
