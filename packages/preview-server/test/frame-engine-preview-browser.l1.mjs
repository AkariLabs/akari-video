import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';

const headed = process.env.AKARI_FRAME_ENGINE_HEADED === '1';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
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

test('real browser runs the cuts-only frame engine field project outside the parallel unit suite', { timeout: 45_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the deterministic moving fixture');
  }
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-field-'));
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const sourcePath = path.join(project, 'source.mp4');
  const generated = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-g', '25', '-keyint_min', '25', '-sc_threshold', '0', '-movflags', '+faststart',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30_000 });
  if (generated.status !== 0) {
    fs.rmSync(project, { recursive: true, force: true });
    throw new Error(`moving fixture generation failed: ${generated.stderr || `exit ${generated.status}`}`);
  }
  const edit = JSON.parse(fs.readFileSync(path.join(repoRoot, 'test-project', 'edit.json'), 'utf8'));
  edit.output = { width: 1280, height: 720, fps: 30 };
  edit.sources = edit.sources.filter(source => source.id === 'main');
  edit.tracks = [{
    id: 'cuts',
    lane: 'visual',
    items: [
      {
        id: 'cut-a', at: 0, duration: 45,
        source: {
          kind: 'media', src: 'main', in: 0, out: 1,
          freeze: { at_sec: 0.4, duration_sec: 0.5 },
          transition_out: { type: 'dissolve', duration: 0.2 },
        },
      },
      { id: 'cut-b', at: 39, duration: 30, source: { kind: 'media', src: 'main', in: 1, out: 2 } },
    ],
  }];
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2));

  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    await waitForServer(`${base}/api/codec-info`);
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

    const off = await context.newPage();
    const offRequests = [];
    off.on('request', request => offRequests.push(request.url()));
    await off.goto(base, { waitUntil: 'load' });
    await off.waitForTimeout(500);
    assert.equal(await off.locator('#frame-engine-preview').count(), 0);
    assert.equal(offRequests.some(url => url.endsWith('/frame-engine.bundle.js')), false);
    await off.close();

    const page = await context.newPage();
    const onRequests = [];
    const pageErrors = [];
    page.on('request', request => onRequests.push(request.url()));
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/?frameEngine=1`, { waitUntil: 'load' });
    await page.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 20_000 });

    assert.equal(onRequests.some(url => url.endsWith('/frame-engine.bundle.js')), true);
    assert.equal(await page.locator('#frame-engine-canvas').count(), 1);
    assert.match(await page.locator('#frame-engine-unsupported-banner').textContent(), /layers \/ overlays \/ 字幕 \/ 音声/u);
    assert.equal(await page.locator('#preview-video').evaluate(element => getComputedStyle(element).display), 'none');
    assert.deepEqual(await page.locator('#frame-engine-canvas').evaluate(canvas => [canvas.width, canvas.height]), [1280, 720]);

    const duration = Number(await page.locator('#seek').getAttribute('max'));
    assert.ok(duration > 2.2 && duration < 2.4, `freeze-adjusted duration was ${duration}`);

    const rapidSeeks = Array.from({ length: 30 }, (_unused, index) => 0.1 + ((index * 0.37) % 1.9));
    rapidSeeks.push(0.35);
    for (const value of rapidSeeks) {
      await page.locator('#seek').evaluate((input, next) => {
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    }
    await page.waitForTimeout(900);
    const seekMetrics = await page.locator('#frame-engine-metrics').evaluate(element => ({
      latest: element.dataset.seekMs,
      before: element.dataset.seekBeforeMs,
      after: element.dataset.seekAfterMs,
      late: element.dataset.lateFrames,
    }));
    const numericMetric = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value);
    assert.ok(numericMetric(seekMetrics.latest), `seek latest metric was ${seekMetrics.latest}`);
    assert.ok(numericMetric(seekMetrics.before), `seek cold metric was ${seekMetrics.before}`);
    assert.ok(numericMetric(seekMetrics.after), `seek cache metric was ${seekMetrics.after}`);
    assert.ok(numericMetric(seekMetrics.late), `late metric was ${seekMetrics.late}`);

    const playbackStart = Number(await page.locator('#seek').inputValue());
    const canvasBeforePlayback = await page.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
    await page.click('#play-toggle');
    await page.waitForTimeout(1_500);
    const playbackMetrics = await page.locator('#frame-engine-metrics').evaluate(element => ({
      fps: element.dataset.fps,
      boundaryBefore: element.dataset.boundaryLateBefore,
      boundaryAfter: element.dataset.boundaryLateAfter,
    }));
    const boundaryTotal = value => Number(String(value).split('/')[1]);
    assert.ok(/^\d+$/u.test(playbackMetrics.fps ?? ''), `fps metric was ${playbackMetrics.fps}`);
    const measuredFps = Number(playbackMetrics.fps);
    if (headed) assert.ok(measuredFps >= 24, `headed 1280x720 presented fps was ${measuredFps}`);
    const playbackEnd = Number(await page.locator('#seek').inputValue());
    assert.ok(playbackEnd > playbackStart + 0.5, `playback clock did not advance: ${playbackStart} -> ${playbackEnd}`);
    const canvasAfterPlayback = await page.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
    assert.notEqual(canvasAfterPlayback, canvasBeforePlayback, 'playback did not present a different frame');
    assert.ok(boundaryTotal(playbackMetrics.boundaryBefore) >= 1, `cold boundary record was ${playbackMetrics.boundaryBefore}`);
    assert.ok(boundaryTotal(playbackMetrics.boundaryAfter) >= 1, `warm boundary record was ${playbackMetrics.boundaryAfter}`);
    assert.equal(await page.locator('#frame-engine-error').isHidden(), true);
    assert.deepEqual(pageErrors, []);
    await page.click('#play-toggle');
    await context.close();
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
