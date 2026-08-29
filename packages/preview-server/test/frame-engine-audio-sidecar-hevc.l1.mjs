import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensurePreviewAudioSidecar } from '../../media-bin/src/preview-audio-sidecar.mjs';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options,
  });
}

test('10bit HEVC 200 MB 原本だけでも speech は FLAC sidecar から全数 decode する', {
  timeout: 3 * 60_000,
}, async t => {
  if (run(ffmpeg, ['-version']).status !== 0 || run(ffprobe, ['-version']).status !== 0) {
    return t.skip('ffmpeg/ffprobe unavailable');
  }
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return t.skip('playwright unavailable'); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-hevc-sidecar-'));
  const source = path.join(root, 'hevc-main10.mp4');
  let browser;
  try {
    const generated = run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=900:sample_rate=48000:duration=2',
      '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-preset', 'ultrafast',
      '-c:a', 'aac', '-shortest', '-movflags', '+faststart', source,
    ]);
    assert.equal(generated.status, 0, generated.stderr);
    fs.truncateSync(source, 205 * 1024 * 1024);
    const codec = run(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'json', source,
    ]);
    assert.equal(codec.status, 0, codec.stderr);
    const stream = JSON.parse(codec.stdout).streams[0];
    assert.equal(stream.codec_name, 'hevc');
    assert.match(stream.pix_fmt, /10/u);
    assert.ok(fs.statSync(source).size >= 200 * 1024 * 1024);

    const sidecar = await ensurePreviewAudioSidecar({
      sourcePath: source, inSec: 0.25, outSec: 1.75, speed: 1,
      padBeforeSec: 0, padAfterSec: 0, ffmpeg,
      cacheDir: path.join(root, '.akari', 'cache'),
    });
    assert.equal(sidecar.ok, true, sidecar.reason);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let originalRequests = 0;
    await page.route('http://127.0.0.1/**', route => {
      if (route.request().url().endsWith('/source')) {
        originalRequests += 1;
        return route.fulfill({
          status: 200,
          headers: { 'content-length': String(fs.statSync(source).size), 'access-control-allow-origin': '*' },
          body: Buffer.alloc(0),
        });
      }
      const body = fs.readFileSync(sidecar.path);
      return route.fulfill({
        status: 200, contentType: 'audio/flac',
        headers: { 'content-length': String(body.length), 'access-control-allow-origin': '*' }, body,
      });
    });
    await page.setContent('<button id="start">start</button>');
    await page.addScriptTag({
      path: path.resolve(import.meta.dirname,
        '../../../apps/shell/extensions/akari-preview/generated/frame-engine.js'),
    });
    await page.evaluate(meta => {
      document.querySelector('#start').addEventListener('click', async () => {
        const supply = window.AkariFrameEngine.createPreviewAudioSupply({
          timelineDurationSec: 1.5,
          speech: [{
            id: 'hevc-speech', src: 'hevc', url: 'http://127.0.0.1/source',
            atSec: 0, durationSec: 1.5, inSec: 0.25, outSec: 1.75, speed: 1,
            materialDurationSec: meta.durationSec,
            sidecar: {
              path: 'http://127.0.0.1/sidecar', durationSec: meta.durationSec,
              padBeforeSec: 0, padAfterSec: 0, skipped: false, bytes: meta.bytes,
            },
          }],
        });
        supply.prime();
        const deadline = performance.now() + 10_000;
        while (performance.now() < deadline && supply.debug().prefetch.pending > 0) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        supply.playFrom(0);
        while (performance.now() < deadline && !supply.debug().playing) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        window.result = supply.debug();
        supply.dispose();
      }, { once: true });
    }, { durationSec: sidecar.durationSec, bytes: fs.statSync(sidecar.path).size });
    await page.click('#start');
    await page.waitForFunction(() => window.result, null, { timeout: 15_000 });
    const debug = await page.evaluate(() => window.result);
    assert.equal(debug.speechDecode.sources, 1);
    assert.equal(debug.speechDecode.okSources, 1);
    assert.equal(debug.scheduled.speech, 1);
    assert.equal(debug.playing, true);
    assert.equal(originalRequests, 0, 'large HEVC source must not be fetched when sidecar succeeds');
  } finally {
    await browser?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
