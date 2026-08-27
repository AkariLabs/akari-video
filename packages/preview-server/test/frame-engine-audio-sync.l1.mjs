import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readInternalEdit } from '../../edit-store/lib/index.js';

const DURATION_SEC = 300;
const MAX_DRIFT_MS = 33;
const FPS = 30;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview server did not become ready');
}

function generate(ffmpeg, args, label) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(result.status, 0, `${label}: ${result.stderr || `exit ${result.status}`}`);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function readDebug(page, phase, timelineTargetSec) {
  const debug = await page.evaluate(() => window.akariFrameEngineAudioDebug?.() ?? null);
  assert.ok(debug, `${phase}: window.akariFrameEngineAudioDebug() is unavailable`);
  assert.equal(debug.playing, true, `${phase}: audio clock is not running`);
  assert.ok(Number.isFinite(debug.renderedTimelineSec), `${phase}: rendered timeline is missing`);
  assert.ok(Number.isFinite(debug.audioPositionSec), `${phase}: audio position is missing`);
  assert.ok(Number.isFinite(debug.driftMs), `${phase}: drift is missing`);
  return {
    phase,
    timelineTargetSec,
    renderedTimelineSec: debug.renderedTimelineSec,
    audioPositionSec: debug.audioPositionSec,
    driftMs: debug.driftMs,
    scheduled: debug.scheduled,
  };
}

test('5 minute AudioContext-master playback and 30 seeks stay within one 30fps frame', {
  timeout: 12 * 60_000,
}, async t => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  if (spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status !== 0) {
    return t.skip('ffmpeg is unavailable');
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return t.skip('playwright is unavailable');
  }
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-audio-sync-'));
  const sourcePath = path.join(project, 'source.mp4');
  const bgmPath = path.join(project, 'bgm.wav');
  const narrationPath = path.join(project, 'narration.wav');
  const sfxPath = path.join(project, 'sfx.wav');
  generate(ffmpeg, [
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', sourcePath,
  ], 'video fixture');
  generate(ffmpeg, [
    '-f', 'lavfi', '-i', 'sine=frequency=200:sample_rate=48000:duration=2',
    '-c:a', 'pcm_s16le', bgmPath,
  ], 'bgm fixture');
  generate(ffmpeg, [
    '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000:duration=1.25',
    '-c:a', 'pcm_s16le', narrationPath,
  ], 'narration fixture');
  generate(ffmpeg, [
    '-f', 'lavfi', '-i', 'sine=frequency=900:sample_rate=48000:duration=0.2',
    '-c:a', 'pcm_s16le', sfxPath,
  ], 'sfx fixture');

  const visualItems = Array.from({ length: DURATION_SEC }, (_unused, index) => ({
    id: `cut-${index + 1}`,
    at: index * FPS,
    duration: FPS,
    source: { kind: 'media', src: 'main', in: 0, out: 1 },
  }));
  const narrationItems = Array.from({ length: 10 }, (_unused, index) => ({
    id: `n-${String(index + 1).padStart(4, '0')}`,
    at: (15 + index * 27) * FPS,
    duration: 0,
    role: 'narration',
    source: { kind: 'media', src: 'a-nar', in: 0 },
    gain_db: -3,
    provenance: { provider: 'human' },
  }));
  const sfxItems = Array.from({ length: 20 }, (_unused, index) => ({
    id: `sfx-${index + 1}`,
    at: (5 + index * 14) * FPS,
    duration: 0,
    role: 'sfx',
    source: { kind: 'media', src: 'a-sfx', in: 0 },
    gain_db: -6,
    fade_in: 0.01,
    fade_out: 0.02,
  }));
  const edit = {
    version: 2,
    output: { width: 320, height: 180, fps: FPS },
    sources: [
      { id: 'main', path: 'source.mp4', proxy: null },
      { id: 'a-bgm', path: 'bgm.wav', proxy: null },
      { id: 'a-nar', path: 'narration.wav', proxy: null },
      { id: 'a-sfx', path: 'sfx.wav', proxy: null },
    ],
    tracks: [
      { id: 'audio-narration', lane: 'audio', items: narrationItems },
      {
        id: 'audio-bgm', lane: 'audio', items: [{
          id: 'bgm', at: 0, duration: 0, role: 'bgm',
          source: { kind: 'media', src: 'a-bgm', in: 0 },
          gain_db: -12, ducking: true,
        }],
      },
      { id: 'audio-sfx', lane: 'audio', items: sfxItems },
      { id: 'visual-main', lane: 'visual', items: visualItems },
    ],
  };
  assert.doesNotThrow(() => readInternalEdit(edit), 'sync fixture must satisfy the v2 reader');
  fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/api/codec-info`);
    const [summaryResponse, timelineResponse] = await Promise.all([
      fetch(`${base}/api/summary`),
      fetch(`${base}/api/timeline`),
    ]);
    if (!summaryResponse.ok) {
      assert.fail(`/api/summary rejected the v2 fixture: ${await summaryResponse.text()}`);
    }
    if (!timelineResponse.ok) {
      assert.fail(`/api/timeline rejected the v2 fixture: ${await timelineResponse.text()}`);
    }
    const projectedSummary = await summaryResponse.json();
    assert.ok(projectedSummary.audio?.bgm, 'v2 BGM did not project into summary.audio');
    assert.ok(projectedSummary.audio?.narration?.length > 0,
      'v2 narration did not project into summary.audio');
    assert.ok(projectedSummary.audio?.sfx?.length > 0, 'v2 SFX did not project into summary.audio');
    browser = await chromium.launch({ headless: process.env.AKARI_FRAME_ENGINE_HEADED !== '1' });
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`${base}/?frameEngine=1`, { waitUntil: 'load' });
    await page.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 30_000 });
    await page.click('#play-toggle');
    await page.waitForFunction(() => window.akariFrameEngineAudioDebug?.().playing === true, null, {
      timeout: 15_000,
    });
    await page.waitForFunction(() => {
      const scheduled = window.akariFrameEngineAudioDebug?.().scheduled;
      return scheduled?.itemCount > 0 && scheduled.bgm >= 1
        && scheduled.narration >= 1 && scheduled.sfx >= 1;
    }, null, { timeout: 15_000 });
    const initialScheduled = await page.evaluate(
      () => window.akariFrameEngineAudioDebug().scheduled,
    );
    assert.ok(initialScheduled.itemCount > 0, 'audio schedule is empty');
    assert.ok(initialScheduled.bgm >= 1, 'BGM was not scheduled');
    assert.ok(initialScheduled.narration >= 1, 'narration was not scheduled');
    assert.ok(initialScheduled.sfx >= 1, 'SFX was not scheduled');

    const continuous = [];
    const continuousTargets = Array.from({ length: 29 }, (_unused, index) => (index + 1) * 10);
    for (const target of continuousTargets) {
      await page.waitForFunction(expected => {
        const debug = window.akariFrameEngineAudioDebug?.();
        return debug?.playing === true && debug.audioPositionSec >= expected;
      }, target, { timeout: 15_000 });
      continuous.push(await readDebug(page, 'continuous', target));
    }
    await page.waitForFunction(duration => Number(document.querySelector('#seek')?.value) >= duration - 0.5,
      DURATION_SEC, { timeout: 30_000 });
    await page.waitForFunction(() => window.akariFrameEngineAudioDebug?.().playing === false, null, {
      timeout: 30_000,
    });
    const continuousEnd = await page.evaluate(() => {
      const debug = window.akariFrameEngineAudioDebug();
      return {
        wallClockSec: Number(document.querySelector('#seek')?.value),
        audioPositionSec: debug.audioPositionSec,
      };
    });
    const scheduleStartAtSec = initialScheduled.startAtSec;
    const wallClockOffsetSec = continuousEnd.wallClockSec - continuousEnd.audioPositionSec;
    assert.ok(Number.isFinite(scheduleStartAtSec), 'audio schedule start offset is missing');
    assert.ok(Number.isFinite(wallClockOffsetSec), 'wall/audio clock offset is missing');

    const afterSeek = [];
    const seekTargets = Array.from({ length: 30 }, (_unused, index) => 1 + ((index * 37.25) % 280));
    for (const target of seekTargets) {
      await page.locator('#seek').evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, target);
      await page.click('#play-toggle');
      await page.waitForFunction(() => window.akariFrameEngineAudioDebug?.().playing === true, null, {
        timeout: 10_000,
      });
      await page.waitForTimeout(350);
      afterSeek.push(await readDebug(page, 'after-seek', target));
      await page.click('#play-toggle');
    }

    const samples = [...continuous, ...afterSeek];
    const absoluteDrifts = samples.map(sample => Math.abs(sample.driftMs));
    const output = {
      fixtureDurationSec: DURATION_SEC,
      sampleIntervalSec: 10,
      continuousSamples: continuous,
      seekCount: seekTargets.length,
      afterSeekSamples: afterSeek,
      initialScheduled,
      scheduleStartAtSec,
      wallClockOffsetSec,
      maxDriftMs: Math.max(...absoluteDrifts),
      p95DriftMs: percentile(absoluteDrifts, 0.95),
      limitMs: MAX_DRIFT_MS,
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    assert.ok(output.maxDriftMs <= MAX_DRIFT_MS,
      `audio/video drift ${output.maxDriftMs.toFixed(3)}ms exceeds ${MAX_DRIFT_MS}ms`);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
