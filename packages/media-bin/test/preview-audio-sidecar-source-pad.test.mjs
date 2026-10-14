import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveFfmpeg } from '../src/index.mjs';
import { PREVIEW_AUDIO_PCM_RECIPE, buildPreviewAudioFilterChain, ensurePreviewAudioSidecar,
  previewAudioSidecarKey, previewAudioSidecarStatus } from '../src/preview-audio-sidecar.mjs';

test('cache keys change only when speed changes a requested source pad', () => {
  const sourcePath = path.resolve('source.wav');
  const oldKey = options => crypto.createHash('sha1').update([
    sourcePath, options.size, options.mtimeMs, String(options.inSec), String(options.outSec),
    String(options.speed), String(options.padBeforeSec), String(options.padAfterSec),
    ...buildPreviewAudioFilterChain(options), PREVIEW_AUDIO_PCM_RECIPE,
    'pcm-s16le', 24000, 1, 2,
  ].join('|')).digest('hex');
  const base = { sourcePath, size: 100, mtimeMs: 123, inSec: 1, outSec: 3,
    speed: 1, padBeforeSec: 0, padAfterSec: 0, format: 'pcm-s16le' };
  assert.equal(previewAudioSidecarKey(base), oldKey(base));
  const fastWithoutPads = { ...base, speed: 2 };
  assert.equal(previewAudioSidecarKey(fastWithoutPads), oldKey(fastWithoutPads));
  const fastWithPads = { ...fastWithoutPads, padBeforeSec: 1 };
  assert.notEqual(previewAudioSidecarKey(fastWithPads), oldKey(fastWithPads));
});

test('speed-two source pads return the clamped start on creation and cache reuse', async t => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); } catch { return t.skip('ffmpeg unavailable'); }
  if (spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status !== 0) return t.skip('ffmpeg unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const sourcePath = path.join(root, 'source.wav');
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000:duration=4', '-c:a', 'pcm_s16le', '-y', sourcePath],
  { encoding: 'utf8', windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  const options = { sourcePath, cacheDir: root, inSec: 0.25, outSec: 2.25,
    speed: 2, padBeforeSec: 2, padAfterSec: 1, format: 'pcm-s16le' };
  const stat = fs.statSync(sourcePath);
  const keyInput = { ...options, size: stat.size, mtimeMs: stat.mtimeMs };
  const oldKey = crypto.createHash('sha1').update([
    sourcePath, stat.size, stat.mtimeMs, '0.25', '2.25', '2', '2', '1',
    ...buildPreviewAudioFilterChain(options), PREVIEW_AUDIO_PCM_RECIPE, 'pcm-s16le', 24000, 1, 2,
  ].join('|')).digest('hex');
  assert.notEqual(previewAudioSidecarKey(keyInput), oldKey,
    'source-second pads must not reuse the older output-second cache');
  const first = await ensurePreviewAudioSidecar({ ...options, ffmpeg });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.skipped, false);
  assert.equal(first.actualStartSeconds, 0);
  assert.ok(Math.abs(first.durationSec - 1.625) < 0.02, `duration ${first.durationSec}`);
  const reused = await ensurePreviewAudioSidecar({ ...options, ffmpeg });
  assert.equal(reused.ok, true, reused.reason);
  assert.equal(reused.skipped, true);
  assert.equal(reused.actualStartSeconds, 0);
  const status = previewAudioSidecarStatus(options);
  assert.equal(status.state, 'ready');
  assert.equal(status.actualStartSeconds, 0);
});
