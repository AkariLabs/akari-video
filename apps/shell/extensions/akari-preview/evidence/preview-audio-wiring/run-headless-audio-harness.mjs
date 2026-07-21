#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixture');
const sourcePath = path.resolve(here, '../../src/browser/akari-preview-open-handler.ts');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const records = [];
const consoleEntries = [];

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

function methodTemplate(source, name, nextName) {
  const methodStart = source.indexOf(`protected ${name}(): string {`);
  const nextStart = source.indexOf(`protected ${nextName}`, methodStart);
  assert(methodStart >= 0 && nextStart > methodStart, `method source not found: ${name}`);
  const method = source.slice(methodStart, nextStart);
  const returnStart = method.indexOf('return `') + 'return `'.length;
  const returnEnd = method.lastIndexOf('`;');
  assert(returnStart >= 'return `'.length && returnEnd > returnStart, `template body not found: ${name}`);
  return method.slice(returnStart, returnEnd);
}

function previewHtml(hostScript, bootstrapScript, fixtureUrl, withAudio) {
  const audio = withAudio ? {
    bgm: { id: 'bgm', src: `${fixtureUrl}audio/bgm.wav`, gainDb: -18, ducking: true },
    sfx: [
      { id: 'sfx-1', src: `${fixtureUrl}audio/sfx.wav`, t: 1, gainDb: -6 },
      { id: 'sfx-missing', src: `${fixtureUrl}audio/missing.wav`, t: 3.5, gainDb: 0 }
    ],
    narration: [
      { id: 'n-0001', src: `${fixtureUrl}audio/narration.wav`, t: 2, gainDb: 0 }
    ]
  } : undefined;
  const initial = {
    summary: {
      output: { width: 320, height: 180, fps: 30 },
      overlays: [],
      cuts: [{ in: 0, out: withAudio ? 6 : 3 }],
      ...(audio ? { audio } : {})
    },
    captions: [],
    editPath: withAudio ? 'fixture/edit.json' : 'fixture/no-audio/edit.json',
    videoUri: withAudio ? 'fixture-video.mp4' : 'no-audio-video.mp4',
    muted: false,
    captionsVisible: true,
    hiddenTracks: []
  };
  const videoUrl = withAudio ? `${fixtureUrl}fixture-video.mp4` : `${fixtureUrl}no-audio/no-audio-video.mp4`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#eee}.workspace{display:grid}.preview-pane{width:640px;height:360px}
#preview-wrapper,#zoom-layer{position:relative;width:640px;height:360px}#preview-video{width:640px;height:360px}
#overlay-stage{position:absolute;inset:0}.transport-waveform{width:640px;height:56px}.transport{display:block}
</style></head><body>
<main class="workspace"><section class="preview-pane"><div id="preview-wrapper"><div id="zoom-layer">
<video id="preview-video" src="${videoUrl}" preload="metadata"></video>
<div id="overlay-stage"><div id="caption-plate"></div></div></div>
<div id="zoom-minimap" hidden><div id="zoom-minimap-viewport"></div></div>
<div id="preview-message" hidden></div></div></section>
<aside id="inspector" hidden><h2 id="inspector-title"></h2><div id="inspector-fields"></div></aside></main>
<div class="transport"><div class="transport-waveform" hidden><canvas id="waveform-canvas"></canvas>
<div class="transport-waveform-playhead"></div></div>
<input id="seek" type="range" min="0" max="0" step="0.001" value="0"><span id="time-label"></span>
<button id="play-toggle"></button><button id="frame-back"></button><button id="frame-forward"></button>
<button id="skip-back"></button><button id="skip-forward"></button><button id="waveform-toggle"></button>
<button id="zoom-toggle"></button><button id="fullscreen-toggle"></button>
<div id="zoom-popup" hidden><input id="zoom-slider" value="0"><span id="zoom-value"></span></div></div>
<script>window.__akariPreview=${JSON.stringify(initial)};window.acquireVsCodeApi=()=>({postMessage:()=>{}});</script>
<script>${hostScript.replace(/<\/script/gi, '<\\/script')}</script>
<script>window.akari.runtime={mount:async()=>{},tick:()=>{}};</script>
<script>${bootstrapScript.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
}

async function main() {
  const source = await readFile(sourcePath, 'utf8');
  const hostScript = methodTemplate(source, 'hostAdapterScript', 'previewBootstrapScript');
  const bootstrapScript = methodTemplate(source, 'previewBootstrapScript', 'async isInsideWorkspace');
  const fixtureUrl = pathToFileURL(`${fixture}${path.sep}`).href;
  const audioHarnessPath = path.join(here, 'harness.html');
  const noAudioHarnessPath = path.join(here, 'harness-no-audio.html');
  await writeFile(audioHarnessPath, previewHtml(hostScript, bootstrapScript, fixtureUrl, true));
  await writeFile(noAudioHarnessPath, previewHtml(hostScript, bootstrapScript, fixtureUrl, false));

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files']
  });
  try {
    const page = await browser.newPage();
    page.on('console', async message => {
      const values = [];
      for (const argument of message.args()) {
        values.push(await argument.jsonValue().catch(() => argument.toString()));
      }
      consoleEntries.push({ type: message.type(), text: message.text(), values });
    });
    await page.goto(pathToFileURL(audioHarnessPath).href, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.akari.previewAudioDebug().decoded?.narration?.length === 1);
    const decoded = await page.evaluate(() => window.akari.previewAudioDebug());
    record('chromium-audio-decoded', decoded);
    assert(decoded.decoded.bgm && decoded.decoded.sfx.length === 1 && decoded.decoded.narration.length === 1,
      'valid BGM/SFX/narration were not independently decoded', decoded);
    const missingWarning = consoleEntries.find(entry => entry.text.includes('sfx-missing')
      && entry.text.includes('fetch/decode failed'));
    record('chromium-missing-file-degradation', { observed: Boolean(missingWarning), warning: missingWarning || null });
    assert(missingWarning, 'missing SFX did not warn and skip', { consoleEntries });

    await page.click('#play-toggle');
    await new Promise(resolve => setTimeout(resolve, 650));
    const scheduled = await page.evaluate(() => window.akari.previewAudioDebug());
    record('chromium-audio-scheduled', scheduled);
    assert(scheduled.contextState === 'running', 'AudioContext did not resume from the playback gesture', scheduled);
    assert(scheduled.active.bgm === 1 && scheduled.active.sfx === 1 && scheduled.active.narration === 1,
      'audio sources were not scheduled together', scheduled);
    assert(scheduled.duckGainDb === 0, 'BGM ducked outside narration interval', scheduled);

    await page.evaluate(() => { document.getElementById('preview-video').currentTime = 2.2; });
    await new Promise(resolve => setTimeout(resolve, 350));
    const ducked = await page.evaluate(() => window.akari.previewAudioDebug());
    const expectedLinear = Math.pow(10, (-18 - 12) / 20);
    record('chromium-bgm-ducked', { ...ducked, expectedLinear });
    assert(ducked.duckGainDb === -12, 'ducking was not fixed -12dB in narration interval', ducked);
    assert(Math.abs(ducked.bgmGainLinear - expectedLinear) < 0.00001,
      'BGM gain did not equal -18dB base plus -12dB duck', { ducked, expectedLinear });

    const mirror = await page.evaluate(() => {
      const video = document.getElementById('preview-video');
      video.volume = 0.4;
      const volume = window.akari.previewAudioDebug().masterGainLinear;
      video.muted = true;
      const muted = window.akari.previewAudioDebug().masterGainLinear;
      video.pause();
      return { volume, muted };
    });
    record('chromium-master-gain-mirror', mirror);
    assert(Math.abs(mirror.volume - 0.4) < 0.0001 && mirror.muted === 0,
      'video volume/mute did not mirror to supplemental master gain', mirror);
    await page.screenshot({ path: path.join(here, '01-headless-audio-preview.png') });

    await page.goto(pathToFileURL(noAudioHarnessPath).href, { waitUntil: 'networkidle0' });
    const noAudioInitial = await page.evaluate(() => window.akari.previewAudioDebug());
    assert(noAudioInitial.disabled === true, 'audio-less preview created an AudioContext', noAudioInitial);
    await page.click('#play-toggle');
    await new Promise(resolve => setTimeout(resolve, 450));
    const noAudioPlaying = await page.evaluate(() => {
      const video = document.getElementById('preview-video');
      const state = { paused: video.paused, currentTime: video.currentTime, audio: window.akari.previewAudioDebug() };
      video.pause();
      return state;
    });
    record('chromium-no-audio-regression', noAudioPlaying);
    assert(!noAudioPlaying.paused && noAudioPlaying.currentTime > 0.1 && noAudioPlaying.audio.disabled,
      'audio-less preview playback regressed', noAudioPlaying);
    await page.screenshot({ path: path.join(here, '02-headless-no-audio.png') });

    record('ALL-PASS', {
      graph: 'BGM+SFX+narration',
      duckGainDb: ducked.duckGainDb,
      missingFileSkipped: true,
      noAudioRegression: true,
      observation: 'headless Chromium against scripts extracted from the edited source'
    });
    await writeFile(path.join(here, 'headless-run-log.json'), JSON.stringify({ records, consoleEntries }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(async error => {
  console.error(error);
  await writeFile(path.join(here, 'headless-run-log.json'), JSON.stringify({ records, consoleEntries, error: String(error) }, null, 2)).catch(() => undefined);
  process.exitCode = 1;
});
