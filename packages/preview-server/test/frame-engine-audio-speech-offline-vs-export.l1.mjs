import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildWebAudioSchedule, projectSpeechDeclarations } from '../../edit-store/lib/index.js';

const FPS = 30;
const SAMPLE_RATE = 48_000;
const DURATION_SEC = 6;
const FIXTURE_ORIGIN = 'http://127.0.0.1';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: options.binary ? null : 'utf8',
    timeout: options.timeout ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function generate(args, label) {
  const result = run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...args,
  ]);
  assert.equal(result.status, 0, `${label}: ${result.stderr || `exit ${result.status}`}`);
}

function durationSec(filePath) {
  const result = run(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  return Number(String(result.stdout).trim());
}

function writeMonoWav(filePath, samples) {
  const output = Buffer.allocUnsafe(44 + samples.length * 2);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + samples.length * 2, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    output.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + index * 2);
  });
  fs.writeFileSync(filePath, output);
}

function speechEnvelope(filePath) {
  const result = run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-af', 'highpass=f=800,lowpass=f=2200',
    '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1',
  ], { binary: true });
  assert.equal(result.status, 0, String(result.stderr));
  const values = new Float32Array(
    result.stdout.buffer,
    result.stdout.byteOffset,
    Math.floor(result.stdout.byteLength / 4),
  );
  const window = SAMPLE_RATE / 10;
  const envelope = [];
  for (let offset = 0; offset + window <= values.length; offset += window) {
    let sum = 0;
    for (let index = offset; index < offset + window; index += 1) sum += values[index] ** 2;
    envelope.push(Math.sqrt(sum / window));
  }
  return envelope.slice(0, DURATION_SEC * 10);
}

function correlation(left, right) {
  assert.equal(left.length, right.length);
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftSquares += a * a;
    rightSquares += b * b;
  }
  return numerator / Math.sqrt(leftSquares * rightSquares);
}

async function routeMediaFixtures(page, fixtures) {
  const urls = Object.fromEntries(Object.keys(fixtures).map(key => [
    key,
    `${FIXTURE_ORIGIN}/${encodeURIComponent(key)}`,
  ]));
  const pathsByUrl = new Map(Object.entries(urls).map(([key, url]) => [url, fixtures[key]]));
  await page.route(`${FIXTURE_ORIGIN}/**`, async route => {
    const filePath = pathsByUrl.get(route.request().url());
    if (!filePath) return route.fulfill({ status: 404, body: 'fixture not found' });
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(filePath),
    });
  });
  return urls;
}

function editDocument() {
  return {
    version: 2,
    output: { width: 320, height: 180, fps: FPS },
    sources: [
      { id: 'source-a', path: 'source-a.mp4', proxy: null },
      { id: 'source-b', path: 'source-b.mp4', proxy: null },
      { id: 'bgm', path: 'bgm.wav', proxy: null },
      { id: 'sfx', path: 'sfx.wav', proxy: null },
    ],
    tracks: [
      {
        id: 'visual-main', lane: 'visual', items: [
          { id: 'cut-a1', at: 0, duration: 60,
            source: { kind: 'media', src: 'source-a', in: 0.5, out: 2.5 } },
          { id: 'cut-b', at: 60, duration: 60,
            source: { kind: 'media', src: 'source-b', in: 0.5, out: 2.8, speed: 1.15 } },
          { id: 'cut-a2', at: 120, duration: 60,
            source: { kind: 'media', src: 'source-a', in: 2.5, out: 4.5 } },
        ],
      },
      {
        id: 'audio-bgm', lane: 'audio', items: [{
          id: 'bed', at: 0, duration: 0, role: 'bgm',
          source: { kind: 'media', src: 'bgm', in: 0 }, gain_db: -30,
        }],
      },
      {
        id: 'audio-sfx', lane: 'audio', items: [{
          id: 'hit', at: 90, duration: 0, role: 'sfx',
          source: { kind: 'media', src: 'sfx', in: 0 }, gain_db: -30,
        }],
      },
    ],
  };
}

async function offlineRender(page, schedule, files, speechById) {
  return await page.evaluate(async ({ scheduleValue, files, speechSources }) => {
    const decode = new AudioContext({ sampleRate: 48_000 });
    const buffers = {};
    for (const [key, url] of Object.entries(files)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fixture fetch failed: ${response.status} ${url}`);
      buffers[key] = await decode.decodeAudioData(await response.arrayBuffer());
    }
    await decode.close();
    const offline = new OfflineAudioContext(1, 6 * 48_000, 48_000);
    const apply = (param, events, startTime) => {
      for (const event of events) {
        const at = startTime + event.offsetSec;
        if (event.method === 'linear') param.linearRampToValueAtTime(event.value, at);
        else param.setValueAtTime(event.value, at);
      }
    };
    for (const item of scheduleValue.items) {
      const source = offline.createBufferSource();
      const gain = offline.createGain();
      const key = item.kind === 'speech' ? speechSources[item.id] : item.id;
      source.buffer = buffers[key];
      source.loop = item.loop;
      source.playbackRate.value = item.playbackRate;
      source.connect(gain).connect(offline.destination);
      apply(gain.gain, item.gainEvents, item.delaySec);
      source.start(item.delaySec, item.sourceOffsetSec, item.sourceDurationSec);
    }
    const rendered = await offline.startRendering();
    return Array.from(rendered.getChannelData(0));
  }, { scheduleValue: schedule, files, speechSources: speechById });
}

test('speech 2 sources / 3 cuts の OfflineAudioContext 包絡は render-cut と一致する', {
  timeout: 4 * 60_000,
}, async t => {
  if (run(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status !== 0) return t.skip('ffmpeg unavailable');
  if (run(process.env.FFPROBE_PATH || 'ffprobe', ['-version']).status !== 0) return t.skip('ffprobe unavailable');
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return t.skip('playwright unavailable');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-speech-compare-'));
  const sourceA = path.join(root, 'source-a.mp4');
  const sourceB = path.join(root, 'source-b.mp4');
  const bgm = path.join(root, 'bgm.wav');
  const sfx = path.join(root, 'sfx.wav');
  const preview = path.join(root, 'preview.wav');
  const output = path.join(root, 'exports', 'master.mp4');
  let browser;
  try {
    generate([
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
      '-f', 'lavfi', '-i', "aevalsrc=0.35*sin(2*PI*1200*t)*if(lt(mod(t\\,0.5)\\,0.3)\\,1\\,0.12):s=48000:d=5",
      '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', sourceA,
    ], 'source A');
    generate([
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
      '-f', 'lavfi', '-i', "aevalsrc=0.3*sin(2*PI*1800*t)*if(lt(mod(t\\,0.4)\\,0.18)\\,1\\,0.1):s=48000:d=5",
      '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', sourceB,
    ], 'source B');
    generate(['-f', 'lavfi', '-i', 'sine=frequency=200:sample_rate=48000:duration=6',
      '-c:a', 'pcm_s16le', bgm], 'BGM');
    generate(['-f', 'lavfi', '-i', 'sine=frequency=3200:sample_rate=48000:duration=0.2',
      '-c:a', 'pcm_s16le', sfx], 'SFX');
    fs.mkdirSync(path.join(root, '.akari'), { recursive: true });
    fs.mkdirSync(path.join(root, 'exports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'edit.json'), `${JSON.stringify(editDocument(), null, 2)}\n`);
    fs.writeFileSync(path.join(root, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

    const cuts = [
      { id: 'cut-a1', src: 'source-a', in: 0.5, out: 2.5 },
      { id: 'cut-b', src: 'source-b', in: 0.5, out: 2.8, speed: 1.15 },
      { id: 'cut-a2', src: 'source-a', in: 2.5, out: 4.5 },
    ];
    const projected = projectSpeechDeclarations(cuts, { fps: FPS });
    assert.deepEqual(projected.map(item => item.atSec), [0, 2, 4]);
    assert.ok(projected.every((item, index) =>
      Math.abs(item.atSec - index * 2) <= 1 / FPS), 'speech boundary exceeds one frame');
    const sourceDurations = {
      'source-a': durationSec(sourceA),
      'source-b': durationSec(sourceB),
    };
    const speech = projected.map(item => ({
      ...item, materialDurationSec: sourceDurations[item.src],
    }));
    const schedule = buildWebAudioSchedule({
      timelineDurationSec: DURATION_SEC,
      startAtSec: 0,
      audio: {
        bgm: { id: 'bed', durationSec: durationSec(bgm), gain_db: -30 },
        sfx: [{ id: 'hit', durationSec: durationSec(sfx), t: 3, gain_db: -30 }],
        speech,
      },
    });
    assert.equal(schedule.warnings.length, 0, schedule.warnings.join('\n'));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const files = await routeMediaFixtures(page, {
      'source-a': sourceA,
      'source-b': sourceB,
      bed: bgm,
      hit: sfx,
    });
    const speechById = Object.fromEntries(projected.map(item => [item.id, item.src]));
    writeMonoWav(preview, await offlineRender(page, schedule, files, speechById));

    const renderCut = path.resolve(import.meta.dirname, '../../render-cut/bin/render-cut.mjs');
    const rendered = run(process.execPath, [
      renderCut, root, '--force', '--out', 'exports/master.mp4', '--quality', 'light',
    ], { timeout: 180_000 });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
    const previewEnvelope = speechEnvelope(preview);
    const exportEnvelope = speechEnvelope(output);
    const rmsCorrelation = correlation(previewEnvelope, exportEnvelope);
    process.stdout.write(`${JSON.stringify({ rmsCorrelation, bins: previewEnvelope.length })}\n`);
    assert.ok(rmsCorrelation >= 0.95, `speech RMS correlation ${rmsCorrelation.toFixed(4)} < 0.95`);

    const silent = path.join(root, 'silent.mp4');
    generate(['-f', 'lavfi', '-i', 'color=size=64x64:rate=30:duration=1', '-an',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent], 'silent source');
    const runtimeBundle = path.resolve(import.meta.dirname,
      '../../../apps/shell/extensions/akari-preview/generated/frame-engine.js');
    const probe = await browser.newPage();
    const probeFiles = await routeMediaFixtures(probe, {
      silent,
      good: sourceA,
      bgm,
    });
    await probe.setContent('<button id="start" type="button">start</button>');
    await probe.addScriptTag({ path: runtimeBundle });
    await probe.evaluate(files => {
      document.querySelector('#start').addEventListener('click', async () => {
        const warnings = [];
        const supply = window.AkariFrameEngine.createPreviewAudioSupply({
          timelineDurationSec: 1,
          contextFactory: () => new AudioContext(),
          fetchImpl: url => fetch(url),
          onWarning: message => warnings.push(message),
          declarations: [{ kind: 'bgm', id: 'bed', url: files.bgm, spec: { durationSec: 0 } }],
          speech: [
            { id: 'silent-1', src: 'silent', url: files.silent, atSec: 0, durationSec: 0.5,
              inSec: 0, outSec: 0.5, speed: 1, materialDurationSec: 1 },
            { id: 'silent-2', src: 'silent', url: files.silent, atSec: 0.5, durationSec: 0.5,
              inSec: 0, outSec: 0.5, speed: 1, materialDurationSec: 1 },
            { id: 'good', src: 'good', url: files.good, atSec: 0, durationSec: 1,
              inSec: 0, outSec: 1, speed: 1, materialDurationSec: 5 },
          ],
        });
        supply.playFrom(0);
        const deadline = performance.now() + 10_000;
        while (performance.now() < deadline && !supply.debug().playing) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const debug = supply.debug();
        supply.dispose();
        window.noAudioResult = { warnings, debug };
      }, { once: true });
    }, probeFiles);
    await probe.click('#start');
    await probe.waitForFunction(() => window.noAudioResult, null, { timeout: 15_000 });
    const noAudioResult = await probe.evaluate(() => window.noAudioResult);
    assert.equal(noAudioResult.warnings.filter(message => /speech silent unavailable/u.test(message)).length, 1);
    assert.equal(noAudioResult.debug.scheduled.bgm, 1);
    assert.equal(noAudioResult.debug.scheduled.speech, 1);
    assert.equal(noAudioResult.debug.playing, true);
  } finally {
    await browser?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
