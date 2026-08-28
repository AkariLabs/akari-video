import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';

const baseline = process.env.AKARI_BOUNDARY_WARMUP_BASELINE === '1';
const headed = process.env.AKARI_FRAME_ENGINE_HEADED === '1';

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function p90(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.9) - 1)] ?? 0;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
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

function runFfmpeg(ffmpeg, args, label) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8', timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || `exit ${result.status}`}`);
}

function makeFixture(ffmpeg, project) {
  const main = path.join(project, 'main.mp4');
  const colorTemplate = path.join(project, 'layer-color-template.mp4');
  const maskTemplate = path.join(project, 'layer-mask-template.mp4');
  runFfmpeg(ffmpeg, [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=12',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart', '-y', main,
  ], 'main fixture generation failed');
  runFfmpeg(ffmpeg, [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1',
    '-vf', 'hue=h=75:s=1.4', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
    '-movflags', '+faststart', '-y', colorTemplate,
  ], 'layer color fixture generation failed');
  runFfmpeg(ffmpeg, [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1',
    '-vf', 'format=gray', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
    '-movflags', '+faststart', '-y', maskTemplate,
  ], 'layer mask fixture generation failed');
  runFfmpeg(ffmpeg, [
    '-f', 'lavfi', '-i', 'color=c=orange:size=320x180:rate=1', '-frames:v', '1',
    '-threads', '1', '-y', path.join(project, 'still.png'),
  ], 'still fixture generation failed');

  const sources = [{ id: 'main', path: 'main.mp4' }, { id: 'still', path: 'still.png' }];
  const tracks = [{
    id: 'base', lane: 'visual', items: Array.from({ length: 6 }, (_unused, index) => ({
      id: `cut-${index + 1}`,
      at: index * 60,
      duration: 60,
      source: { kind: 'media', src: 'main', in: index * 2, out: index * 2 + 2 },
    })),
  }];
  for (let index = 0; index < 6; index += 1) {
    const colorName = `layer-${index + 1}.color.mp4`;
    const maskName = `layer-${index + 1}.mask.mp4`;
    fs.copyFileSync(colorTemplate, path.join(project, colorName));
    fs.copyFileSync(maskTemplate, path.join(project, maskName));
    const colorId = `layer-color-${index + 1}`;
    const maskId = `layer-mask-${index + 1}`;
    sources.push({ id: colorId, path: colorName }, { id: maskId, path: maskName });
    tracks.push({
      id: `matte-track-${index + 1}`,
      lane: 'visual',
      items: [{
        id: `matte-${index + 1}`,
        at: index * 60 + 30,
        duration: 24,
        mask: maskId,
        transform: { x: (index - 2.5) * 35, y: (index % 2) * 35 - 18, scale: 0.42 },
        source: { kind: 'media', src: colorId, in: 0, out: 0.8 },
      }],
    });
  }
  tracks.push({
    id: 'still-track', lane: 'visual', items: [{
      id: 'still-layer', at: 15, duration: 30,
      transform: { x: 180, y: 90, scale: 0.3 },
      source: { kind: 'media', src: 'still', in: 0, out: 1 },
    }],
  });
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify({
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources,
    tracks,
  }, null, 2));
}

test('adaptive scheduler warms every cut/layer boundary and preserves random seek latency', {
  timeout: 240_000,
}, async t => {
  let ffmpeg;
  try {
    ffmpeg = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the boundary warmup fixture');
  }
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-boundary-warmup-'));
  makeFixture(ffmpeg, project);
  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/api/codec-info`);
    const summaryMs = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      const response = await fetch(`${base}/api/summary`);
      assert.equal(response.ok, true);
      await response.arrayBuffer();
      summaryMs.push(performance.now() - started);
    }

    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    context.setDefaultNavigationTimeout(60_000);
    const page = await context.newPage();
    const pageErrors = [];
    const recentConsole = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      recentConsole.push(`[${message.type()}] ${message.text()}`);
      if (recentConsole.length > 40) recentConsole.splice(0, recentConsole.length - 40);
    });
    await page.goto(`${base}/?frameEngine=1&frameEngineMetrics=1`, { waitUntil: 'load' });
    await page.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 60_000 });

    const playbackBoundaries = Array.from({ length: 12 }, (_unused, index) => ({
      boundarySeconds: index,
      kind: index % 2 === 0 ? 'cut' : 'layer',
    }));
    const playback = await page.evaluate(async boundaries => new Promise(resolve => {
      const metrics = document.querySelector('#frame-engine-metrics');
      const seek = document.querySelector('#seek');
      const play = document.querySelector('#play-toggle');
      const samples = boundaries.map(boundary => ({
        ...boundary,
        delayMs: null,
        warmState: null,
        boundaryLateBefore: null,
        boundaryLateAfter: null,
      }));
      const bucketTotal = value => Number(String(value ?? '0/0').split('/')[1]) || 0;
      let previousBuckets = { before: '0/0', after: '0/0' };
      const health = [];
      let nextHealthSampleMs = 1_000;
      const captureBoundary = (sample, sampledAt, start) => {
        const before = metrics?.dataset.boundaryLateBefore ?? '0/0';
        const after = metrics?.dataset.boundaryLateAfter ?? '0/0';
        const beforeDelta = bucketTotal(before) - bucketTotal(previousBuckets.before);
        const afterDelta = bucketTotal(after) - bucketTotal(previousBuckets.after);
        sample.delayMs = Math.max(0, sampledAt - start - sample.boundarySeconds * 1000);
        sample.warmState = sample.kind === 'cut'
          ? afterDelta > 0 ? 'warm' : beforeDelta > 0 ? 'cold' : 'unchanged'
          : '—';
        sample.boundaryLateBefore = before;
        sample.boundaryLateAfter = after;
        if (sample.kind === 'cut') previousBuckets = { before, after };
      };
      seek.value = '0';
      seek.dispatchEvent(new Event('input', { bubbles: true }));
      const start = performance.now();
      captureBoundary(samples[0], start, start);
      play.click();
      const timer = setInterval(() => {
        const presentedSeconds = Number(metrics?.dataset.requestedTimeUs) / 1e6;
        const sampledAt = performance.now();
        while (sampledAt - start >= nextHealthSampleMs && nextHealthSampleMs <= 11_000) {
          health.push({
            elapsedMs: nextHealthSampleMs,
            fps: Number(metrics?.dataset.fps),
            requestedTimeUs: Number(metrics?.dataset.requestedTimeUs),
          });
          nextHealthSampleMs += 1_000;
        }
        for (const sample of samples) {
          if (sample.delayMs === null && presentedSeconds >= sample.boundarySeconds) {
            captureBoundary(sample, sampledAt, start);
          }
        }
        if (sampledAt - start < 13_000) return;
        clearInterval(timer);
        resolve({
          samples,
          health,
          metrics: {
            boundaryLateBefore: metrics?.dataset.boundaryLateBefore,
            boundaryLateAfter: metrics?.dataset.boundaryLateAfter,
            lateFrames: metrics?.dataset.lateFrames,
            warmupCoverage: metrics?.dataset.warmupCoverage,
            liveDecoders: metrics?.dataset.liveDecoders,
            leadInSec: metrics?.dataset.leadInSec,
          },
        });
      }, 4);
    }), playbackBoundaries);

    const playToggle = page.locator('#play-toggle');
    if (await playToggle.getAttribute('aria-label') === '一時停止') {
      await playToggle.click();
    }
    await page.waitForFunction(() => document.querySelector('#play-toggle')?.getAttribute('aria-label') === '再生');

    const seekOnce = async seconds => {
      try {
        await page.locator('#seek').evaluate((input, value) => {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, seconds);
        await page.waitForFunction(value => {
          const requested = Number(document.querySelector('#frame-engine-metrics')?.dataset.requestedTimeUs);
          return Number.isFinite(requested) && Math.abs(requested / 1e6 - value) <= 1 / 30 + 0.002;
        }, seconds, { timeout: 30_000 });
        await page.waitForTimeout(40);
        return Number(await page.locator('#frame-engine-metrics').getAttribute('data-seek-ms'));
      } catch (error) {
        const frameEngineError = await page.locator('#frame-engine-error').textContent().catch(() => null);
        throw new Error(
          `seek ${seconds.toFixed(3)}s failed; frame-engine-error=${JSON.stringify(frameEngineError)}; `
            + `recent console:\n${recentConsole.join('\n')}`,
          { cause: error },
        );
      }
    };
    const cold = [];
    const cache = [];
    for (let index = 0; index < 30; index += 1) {
      const seconds = 0.2 + ((index * 2.173) % 11.5);
      cold.push(await seekOnce(seconds));
      cache.push(await seekOnce(seconds));
    }

    const rows = playback.samples.map(sample => ({
      boundary: `${sample.boundarySeconds.toFixed(2)}s`,
      kind: sample.kind,
      presentationDelayMs: sample.delayMs == null ? 'missing' : sample.delayMs.toFixed(2),
      warm: sample.warmState,
    }));
    console.table(rows);
    console.table(playback.health);
    console.table({
      summary: {
        summaryMedianMs: median(summaryMs).toFixed(2),
        coldSeekMedianMs: median(cold).toFixed(2),
        cacheSeekMedianMs: median(cache).toFixed(2),
        ...playback.metrics,
      },
    });

    assert.deepEqual(pageErrors, []);
    assert.equal(await page.locator('#frame-engine-error').isHidden(), true);
    assert.equal((await page.locator('#frame-engine-error').textContent()) ?? '', '');
    const cutSamples = playback.samples.filter(sample => sample.kind === 'cut');
    assert.ok(cutSamples.every(sample => Number.isFinite(sample.delayMs)), JSON.stringify(rows));
    assert.ok(playback.health.length >= 10, `playback health samples were ${JSON.stringify(playback.health)}`);
    const steadyFps = playback.health.slice(1).map(sample => sample.fps);
    assert.ok(median(steadyFps) >= 25 && steadyFps.every(fps => fps >= 20),
      `playback fps after startup was unstable: ${JSON.stringify(playback.health)}`);
    for (let index = 1; index < playback.health.length; index += 1) {
      assert.ok(playback.health[index].requestedTimeUs > playback.health[index - 1].requestedTimeUs,
        `requestedTimeUs stopped: ${JSON.stringify(playback.health)}`);
    }
    assert.ok([...cold, ...cache].every(value => Number.isFinite(value) && value < 1_000),
      `seek exceeded 1s: cold=${cold.join(',')} cache=${cache.join(',')}`);
    assert.ok(median(cache) <= median(cold), `cache ${median(cache)}ms exceeded cold ${median(cold)}ms`);
    if (!baseline) {
      const boundaryP90 = p90(cutSamples.map(sample => sample.delayMs));
      assert.ok(boundaryP90 <= 33, `boundary presentation delay p90 was ${boundaryP90}ms`);
      const [lateAfter, totalAfter] = String(playback.metrics.boundaryLateAfter).split('/').map(Number);
      assert.ok(totalAfter >= 5, `warm boundary count was ${playback.metrics.boundaryLateAfter}`);
      assert.ok(lateAfter <= 1, `boundary late after was ${playback.metrics.boundaryLateAfter}`);
      assert.match(playback.metrics.warmupCoverage ?? '', /^\d+\/\d+$/u);
      const [live, maximum] = String(playback.metrics.liveDecoders).split('/').map(Number);
      assert.ok(live <= maximum, `live decoders was ${playback.metrics.liveDecoders}`);
      const leadIn = Number(playback.metrics.leadInSec);
      assert.ok(leadIn >= 1.5 && leadIn <= 4, `lead-in was ${playback.metrics.leadInSec}`);
    }
    await context.close();
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
