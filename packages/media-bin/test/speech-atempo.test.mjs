import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildAtempoChain, ensureSpeechAtempo } from '../src/speech-atempo.mjs';

test('buildAtempoChain は render-cut と共有する範囲分解を保つ', () => {
  assert.deepEqual(buildAtempoChain(1), []);
  assert.deepEqual(buildAtempoChain(1.2), [1.2]);
  assert.deepEqual(buildAtempoChain(4.8), [2, 2, 1.2]);
  assert.deepEqual(buildAtempoChain(0.2), [0.5, 0.5, 0.8]);
});

test('speech atempo は同一キーを合流し、WAV を冪等に再利用する', async t => {
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
    assert.equal(path.dirname(first.path), path.join(root, '.akari', 'cache', 'speech-atempo'));
    assert.ok([first.skipped, joined.skipped].includes(false));

    const second = await ensureSpeechAtempo(options);
    assert.equal(second.ok, true, second.reason);
    assert.equal(second.skipped, true);
    assert.equal(second.path, first.path);
    assert.ok(Math.abs(second.durationSec - 1) < 1e-9);
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
