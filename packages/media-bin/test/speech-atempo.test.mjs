import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildAtempoChain, ensureSpeechAtempo } from '../src/speech-atempo.mjs';
import {
  ensurePreviewAudioSidecar,
  sweepPreviewAudioSidecars,
} from '../src/preview-audio-sidecar.mjs';

test('buildAtempoChain は render-cut と共有する範囲分解を保つ', () => {
  assert.deepEqual(buildAtempoChain(1), []);
  assert.deepEqual(buildAtempoChain(1.2), [1.2]);
  assert.deepEqual(buildAtempoChain(4.8), [2, 2, 1.2]);
  assert.deepEqual(buildAtempoChain(0.2), [0.5, 0.5, 0.8]);
});

test('互換 speech atempo は同一キーを合流し、FLAC を冪等に再利用する', async t => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  if (spawnSync(ffmpeg, ['-version']).status !== 0) return t.skip('ffmpeg unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-speech-atempo-'));
  const source = path.join(root, 'source.wav');
  try {
    const generated = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=200:sample_rate=48000:duration=2',
      '-c:a', 'pcm_s16le', source,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const options = {
      sourcePath: source, inSec: 0.25, outSec: 1.45, speed: 1.2,
      ffmpeg, cacheDir: path.join(root, '.akari', 'cache'),
    };
    const [first, joined] = await Promise.all([
      ensureSpeechAtempo(options), ensureSpeechAtempo(options),
    ]);
    assert.equal(first.ok, true, first.reason);
    assert.equal(joined.ok, true, joined.reason);
    assert.equal(first.path, joined.path);
    assert.ok(fs.statSync(first.path).size > 44);
    assert.equal(path.dirname(first.path), path.join(root, '.akari', 'cache', 'preview-audio'));
    assert.equal(path.extname(first.path), '.flac');
    assert.equal(first.sampleRate, 48000);
    assert.equal(first.channels, 1);
    assert.ok([first.skipped, joined.skipped].includes(false));

    const second = await ensureSpeechAtempo(options);
    assert.equal(second.ok, true, second.reason);
    assert.equal(second.skipped, true);
    assert.equal(second.path, first.path);
    assert.ok(Math.abs(second.durationSec - 1) < 0.03);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('統合サイドカーは pad を atempo 前に含め、別キーと旧 WAV を sweep する', async t => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  if (spawnSync(ffmpeg, ['-version']).status !== 0) return t.skip('ffmpeg unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-audio-'));
  const source = path.join(root, 'stereo.wav');
  const cacheDir = path.join(root, '.akari', 'cache');
  try {
    assert.equal(spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
      '-filter_complex', '[0:a]pan=stereo|c0=c0|c1=c0[a]', '-map', '[a]',
      '-c:a', 'pcm_s16le', source,
    ]).status, 0);
    const first = await ensurePreviewAudioSidecar({
      sourcePath: source, inSec: 1, outSec: 2, speed: 1.25,
      padBeforeSec: 0.25, padAfterSec: 0.5, ffmpeg, cacheDir,
    });
    const orphan = await ensurePreviewAudioSidecar({
      sourcePath: source, inSec: 1.1, outSec: 2, speed: 1.25,
      padBeforeSec: 0.25, padAfterSec: 0.5, ffmpeg, cacheDir,
    });
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.channels, 2);
    assert.ok(Math.abs(first.durationSec - 1.4) < 0.04, String(first.durationSec));
    const legacy = path.join(cacheDir, 'speech-atempo');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'old.wav'), Buffer.alloc(64));
    const swept = sweepPreviewAudioSidecars({ cacheDir, keepKeys: [first.key] });
    assert.equal(fs.existsSync(first.path), true);
    assert.equal(fs.existsSync(orphan.path), false);
    assert.equal(fs.existsSync(path.join(legacy, 'old.wav')), false);
    assert.equal(swept.removed, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('speech atempo の ffmpeg 失敗は throw せず reason を返す', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-speech-atempo-fail-'));
  const source = path.join(root, 'source.bin');
  try {
    fs.writeFileSync(source, 'not media');
    const result = await ensureSpeechAtempo({
      sourcePath: source, inSec: 0, outSec: 1, speed: 1.2,
      ffmpeg: path.join(root, 'missing-ffmpeg'), cacheDir: path.join(root, '.akari', 'cache'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.match(result.reason, /ENOENT|spawn|ffmpeg/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
