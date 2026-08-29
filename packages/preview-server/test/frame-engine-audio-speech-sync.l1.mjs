import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const FPS = 30;
const MAX_DRIFT_MS = 16.7;

function generate(args, label) {
  const result = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...args,
  ], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(result.status, 0, `${label}: ${result.stderr || `exit ${result.status}`}`);
}

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

function fixtureEdit() {
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
            source: { kind: 'media', src: 'source-a', in: 0, out: 2 } },
          { id: 'cut-b', at: 60, duration: 60,
            source: { kind: 'media', src: 'source-b', in: 0.5, out: 2.8, speed: 1.15 } },
          { id: 'cut-a2', at: 120, duration: 60,
            source: { kind: 'media', src: 'source-a', in: 2, out: 4 } },
        ],
      },
      {
        id: 'audio-bgm', lane: 'audio', items: [{
          id: 'bed', at: 0, duration: 0, role: 'bgm',
          source: { kind: 'media', src: 'bgm', in: 0 }, gain_db: -24,
        }],
      },
      {
        id: 'audio-sfx', lane: 'audio', items: [{
          id: 'hit', at: 90, duration: 0, role: 'sfx',
          source: { kind: 'media', src: 'sfx', in: 0 }, gain_db: -18,
        }],
      },
    ],
  };
}

test('speech 再生中も AudioContext master の drift は 1/2 frame 以内', {
  timeout: 2 * 60_000,
}, async t => {
  if (spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
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

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-speech-sync-'));
  generate([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=1200:sample_rate=48000:duration=5',
    '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', path.join(project, 'source-a.mp4'),
  ], 'source A');
  generate([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=1800:sample_rate=48000:duration=5',
    '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', path.join(project, 'source-b.mp4'),
  ], 'source B');
  generate([
    '-f', 'lavfi', '-i', 'sine=frequency=200:sample_rate=48000:duration=6',
    '-c:a', 'pcm_s16le', path.join(project, 'bgm.wav'),
  ], 'BGM');
  generate([
    '-f', 'lavfi', '-i', 'sine=frequency=3200:sample_rate=48000:duration=0.2',
    '-c:a', 'pcm_s16le', path.join(project, 'sfx.wav'),
  ], 'SFX');
  fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(fixtureEdit(), null, 2)}\n`);

  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/api/codec-info`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`${base}/?frameEngine=1`, { waitUntil: 'load' });
    await page.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 30_000 });
    await page.click('#play-toggle');
    await page.waitForFunction(() => {
      const debug = window.akariFrameEngineAudioDebug?.();
      return debug?.playing === true && debug.scheduled.speech >= 1;
    }, null, { timeout: 15_000 });

    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      await page.waitForTimeout(150);
      const debug = await page.evaluate(() => window.akariFrameEngineAudioDebug());
      if (Number.isFinite(debug.driftMs)) samples.push(debug.driftMs);
    }
    const debug = await page.evaluate(() => window.akariFrameEngineAudioDebug());
    assert.ok(debug.scheduled.speech >= 1, 'speech schedule is empty');
    assert.equal(debug.speechDecode.sources, 2);
    assert.equal(debug.speechDecode.okSources, 2);
    assert.ok(samples.length >= 8, `insufficient drift samples: ${samples.length}`);
    const maxDriftMs = Math.max(...samples.map(Math.abs));
    process.stdout.write(`${JSON.stringify({ maxDriftMs, scheduled: debug.scheduled })}\n`);
    assert.ok(maxDriftMs <= MAX_DRIFT_MS,
      `speech drift ${maxDriftMs.toFixed(3)}ms exceeds ${MAX_DRIFT_MS}ms`);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
