import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';

import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { migrateEditToV2 } = require('../../edit-store/lib/migrate/index.js');

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);

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

async function waitForServer(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* retry while the server starts */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`preview-server did not start within ${timeout}ms`);
}

function createFixture(project) {
  const legacy = {
    version: 0,
    source: { path: 'source.mp4' },
    output: { width: 320, height: 180, fps: 30 },
    // Automatic boundary at output 5s: same media jumps from source 5s to 15s.
    cuts: [{ in: 0, out: 5 }, { in: 15, out: 20 }],
  };
  const migrated = migrateEditToV2(legacy);
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(migrated.doc, null, 2));

  // Both halves are 440Hz, with a phase offset after the skipped middle. The
  // 5s -> 15s jump is therefore a deterministic worst-case waveform splice,
  // independent of AAC packet alignment on the host running the test.
  const tone = String.raw`aevalsrc=0.45*sin(2*PI*440*t+gte(t\,10)*PI/2):s=48000:d=20`;
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=20',
    '-f', 'lavfi', '-i', tone,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    path.join(project, 'source.mp4'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `ffmpeg fixture generation failed: ${result.stderr}`);
}

test('実 preview: seeked までミュートを維持して 5s→15s 境界の段差を除去する', {
  timeout: 30000,
}, async (t) => {
  if (!SYSTEM_CHROME || !fs.existsSync(SYSTEM_CHROME)) {
    t.skip('system Chrome is unavailable');
    return;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-declick-measurement-'));
  let server = null;
  let browser = null;
  try {
    createFixture(project);
    let port;
    try { port = await freePort(); }
    catch (error) {
      if (error?.code === 'EPERM') { t.skip('local listen is unavailable in this sandbox'); return; }
      throw error;
    }
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [
      'src/server.mjs', project, '--port', String(port), '--no-lint',
    ], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverError = '';
    server.stderr.on('data', chunk => { serverError += chunk; });
    await waitForServer(`${base}/api/codec-info`);

    browser = await chromium.launch({ headless: true, executablePath: SYSTEM_CHROME });
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.akari?.baseAudioDebug));

    await page.evaluate(() => {
      const debug = window.akari.baseAudioDebug;
      const video = document.getElementById('preview-video');
      const merger = debug.context.createChannelMerger(2);
      const processor = debug.context.createScriptProcessor(256, 2, 1);
      const silentSink = debug.context.createGain();
      silentSink.gain.value = 0;

      // One processor captures pre/post gain as two channels in the same render
      // quantum, avoiding alignment guesses between independent callback nodes.
      debug.mediaSource.connect(merger, 0, 0);
      debug.outputNode.connect(merger, 0, 1);
      merger.connect(processor);
      processor.connect(silentSink).connect(debug.context.destination);

      const capture = { blocks: [], seeking: [], seeked: [] };
      processor.onaudioprocess = (event) => {
        capture.blocks.push({
          at: event.playbackTime,
          raw: Float32Array.from(event.inputBuffer.getChannelData(0)),
          processed: Float32Array.from(event.inputBuffer.getChannelData(1)),
        });
      };
      video.addEventListener('seeking', () => capture.seeking.push({
        at: debug.context.currentTime,
        currentTime: video.currentTime,
        gain: debug.outputNode.gain.value,
      }));
      video.addEventListener('seeked', () => capture.seeked.push({
        at: debug.context.currentTime,
        currentTime: video.currentTime,
        gain: debug.outputNode.gain.value,
      }));
      window.__declickCapture = { capture, merger, processor, silentSink };
    });

    await page.click('#play-toggle');
    await page.waitForFunction(() => window.__declickCapture.capture.seeked
      .some(event => event.currentTime >= 14.9), null, { timeout: 10000 });
    await page.waitForTimeout(120);

    const measurement = await page.evaluate(() => {
      const debug = window.akari.baseAudioDebug;
      const { capture, merger, processor, silentSink } = window.__declickCapture;
      processor.onaudioprocess = null;
      debug.mediaSource.disconnect(merger);
      debug.outputNode.disconnect(merger);
      merger.disconnect();
      processor.disconnect();
      silentSink.disconnect();

      const sampleRate = debug.context.sampleRate;
      const length = capture.blocks.reduce((sum, block) => sum + block.raw.length, 0);
      const raw = new Float32Array(length);
      const processed = new Float32Array(length);
      let offset = 0;
      for (const block of capture.blocks) {
        raw.set(block.raw, offset);
        processed.set(block.processed, offset);
        offset += block.raw.length;
      }

      const firstAt = capture.blocks[0].at;
      const boundaryEvent = capture.seeked.find(event => event.currentTime >= 14.9);
      const seekingEvent = capture.seeking.find(event => event.currentTime >= 14.9);
      const boundary = Math.round((boundaryEvent.at - firstAt) * sampleRate);
      const radius = Math.round(sampleRate * 0.1);
      const from = Math.max(1, boundary - radius);
      const to = Math.min(length, boundary + radius);
      const steadyFrom = Math.max(1, from - Math.round(sampleRate * 0.5));
      const steadyTo = Math.max(steadyFrom + 1, from - Math.round(sampleRate * 0.05));

      function maxDelta(samples, start, end) {
        let max = 0;
        for (let i = start; i < end; i++) max = Math.max(max, Math.abs(samples[i] - samples[i - 1]));
        return max;
      }
      function rms(samples, start, end) {
        let sum = 0;
        for (let i = start; i < end; i++) sum += samples[i] * samples[i];
        return Math.sqrt(sum / Math.max(1, end - start));
      }

      const steadyRms = rms(processed, steadyFrom, steadyTo);
      const oneMs = Math.round(sampleRate / 1000);
      let lowRun = 0;
      let longestLowRun = 0;
      for (let start = from; start < to; start += oneMs) {
        if (rms(processed, start, Math.min(to, start + oneMs)) < steadyRms * 0.2) {
          lowRun += 1;
          longestLowRun = Math.max(longestLowRun, lowRun);
        } else {
          lowRun = 0;
        }
      }

      return {
        sampleRate,
        rawBoundaryMaxDelta: maxDelta(raw, from, to),
        processedBoundaryMaxDelta: maxDelta(processed, from, to),
        rawSteadyMaxDelta: maxDelta(raw, steadyFrom, steadyTo),
        processedSteadyMaxDelta: maxDelta(processed, steadyFrom, steadyTo),
        steadyRms,
        longestLowRmsMs: longestLowRun,
        seekLatencyMs: (boundaryEvent.at - seekingEvent.at) * 1000,
        gainAtSeeking: seekingEvent.gain,
        gainAtSeeked: boundaryEvent.gain,
      };
    });

    assert.ok(measurement.rawBoundaryMaxDelta > measurement.rawSteadyMaxDelta * 2,
      `fixture splice was not measurable: ${JSON.stringify(measurement)}`);
    assert.ok(measurement.processedBoundaryMaxDelta < measurement.rawBoundaryMaxDelta * 0.25,
      `processed click was not attenuated: ${JSON.stringify(measurement)}`);
    // `seeking` is dispatched after a wall-clock timer applies currentTime, while
    // the fade-out runs on the AudioContext clock. Their scheduling can differ by
    // a few milliseconds, so gainAtSeeking is diagnostic rather than an invariant.
    // `seeked` is the point where newly decoded media can become audible; keeping
    // gain at zero there is the actual de-click safety condition.
    assert.ok(measurement.gainAtSeeked < 0.01,
      `gain must remain zero at seeked: ${JSON.stringify(measurement)}`);
    assert.ok(measurement.steadyRms > 0.1 && measurement.longestLowRmsMs <= 250,
      `mute window is unexpectedly long: ${JSON.stringify(measurement)}`);
    console.log('AUDIO_DECLICK_MEASUREMENT', JSON.stringify(measurement));

    await page.click('#play-toggle');
    assert.equal(serverError, '', `preview-server stderr: ${serverError}`);
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => server.once('exit', resolve));
    }
    fs.rmSync(project, { recursive: true, force: true });
  }
});
