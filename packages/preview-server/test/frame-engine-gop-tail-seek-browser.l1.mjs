import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
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

test('frame engine random-seeks 300 exact frames plus every frame in the final GOP', { timeout: 180_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the deterministic seek fixture');
  }
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-gop-seek-'));
  const sourcePath = path.join(project, 'source.mp4');
  const generated = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=13',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0', '-movflags', '+faststart',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30_000 });
  if (generated.status !== 0) {
    fs.rmSync(project, { recursive: true, force: true });
    throw new Error(`seek fixture generation failed: ${generated.stderr || `exit ${generated.status}`}`);
  }
  const edit = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'main', path: 'source.mp4', proxy: null }],
    tracks: [{
      id: 'base', lane: 'visual', items: [{
        id: 'base-cut', at: 0, duration: 390,
        source: { kind: 'media', src: 'main', in: 0, out: 13 },
      }],
    }],
  };
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2));

  const previewDirectory = path.resolve(import.meta.dirname, '..');
  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: previewDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    await waitForServer(`${base}/api/codec-info`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/?frameEngine=1`, { waitUntil: 'load' });
    await page.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 25_000 });

    const mismatches = [];
    const existingFrames = Array.from({ length: 300 }, (_unused, index) => (index * 137) % 300);
    const finalGopFrames = Array.from({ length: 30 }, (_unused, index) => 360 + ((index * 17) % 30));
    assert.equal(new Set(finalGopFrames).size, 30);
    const frames = [...existingFrames, ...finalGopFrames];
    for (const frameNumber of frames) {
      const seconds = frameNumber / 30;
      const requestedUs = Math.round(seconds * 1e6);
      await page.locator('#seek').evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, seconds);
      await page.waitForFunction(expected =>
        document.querySelector('#frame-engine-metrics')?.getAttribute('data-requested-time-us') === String(expected),
      requestedUs, { timeout: 10_000 });
      const observation = await page.locator('#frame-engine-metrics').evaluate(element => ({
        timestampUs: Number(element.dataset.baseFrameTimestampUs),
        durationUs: Number(element.dataset.baseFrameDurationUs),
      }));
      const actualFrame = Math.round(observation.timestampUs * 30 / 1e6);
      if (actualFrame !== frameNumber) mismatches.push({ frameNumber, actualFrame, ...observation });
    }

    assert.deepEqual(mismatches, []);
    assert.equal(await page.locator('#frame-engine-error').isHidden(), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
