import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveFfmpeg } from '../src/index.mjs';
import {
  PREVIEW_AUDIO_RECIPE, PREVIEW_AUDIO_PCM_RECIPE, pcmWindowByteRange,
  previewAudioSidecarKey, previewAudioSidecarStatus, requestPreviewAudioSidecar,
  ensurePreviewAudioSidecar, sweepPreviewAudioSidecars, subscribePreviewAudioSidecarEvents,
} from '../src/preview-audio-sidecar.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-pcm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.wav');
  fs.writeFileSync(sourcePath, 'fixture');
  const options = { sourcePath, cacheDir: root, inSec: 0, outSec: 12, speed: 1, format: 'pcm-s16le' };
  const directory = path.join(root, 'preview-audio');
  fs.mkdirSync(directory);
  const key = previewAudioSidecarStatus(options).key;
  return { root, options, directory, key, pcm: path.join(directory, `${key}.pcm`),
    json: path.join(directory, `${key}.json`) };
}

test('PCM windows round outward, align interleaved samples, clamp and reject empty ranges', () => {
  const metadata = { sampleRate: 24000, channels: 1, bytesPerSample: 2, frames: 288000 };
  assert.deepEqual(pcmWindowByteRange(metadata, 0, 2),
    { startByte: 0, endByte: 95999, startFrame: 0, frameCount: 48000 });
  assert.deepEqual(pcmWindowByteRange({ ...metadata, channels: 2 }, 1.25 / 24000, 2.25 / 24000),
    { startByte: 4, endByte: 11, startFrame: 1, frameCount: 2 });
  assert.deepEqual(pcmWindowByteRange(metadata, -1, 20),
    { startByte: 0, endByte: 575999, startFrame: 0, frameCount: 288000 });
  for (const [start, end] of [[12, 15], [-3, -1], [2, 1], [0.1, 0.1], [NaN, 1]]) {
    assert.equal(pcmWindowByteRange(metadata, start, end), null);
  }
  assert.equal(pcmWindowByteRange({ ...metadata, frames: 0 }, 0, 1), null);
});

test('PCM has its own recipe and format key while the exact legacy FLAC hash stays unchanged', t => {
  const f = fixture(t);
  const stat = fs.statSync(f.options.sourcePath);
  const base = { ...f.options, size: stat.size, mtimeMs: stat.mtimeMs, format: undefined };
  const legacyTokens = [f.options.sourcePath, stat.size, stat.mtimeMs, '0', '12', '1', '0', '0', 'asetpts=PTS-STARTPTS'];
  const hash = tokens => crypto.createHash('sha1').update(tokens.join('|')).digest('hex');
  assert.equal(previewAudioSidecarKey(base), hash([...legacyTokens, PREVIEW_AUDIO_RECIPE]));
  assert.equal(previewAudioSidecarKey({ ...base, format: 'flac' }), previewAudioSidecarKey(base));
  assert.equal(f.key, hash([...legacyTokens, PREVIEW_AUDIO_PCM_RECIPE, 'pcm-s16le', 24000, 1, 2]));
  assert.notEqual(f.key, previewAudioSidecarKey(base));
  assert.equal(previewAudioSidecarStatus({ ...base, format: 'wav' }).state, 'invalid');
});

test('PCM metadata is reconstructed without ffprobe, round-trips ready APIs and sweeps as a pair', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.pcm, Buffer.alloc(576000));
  const options = { ...f.options, probeAudio: () => assert.fail('raw PCM must never be probed') };
  const result = await ensurePreviewAudioSidecar(options);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.format, 'pcm-s16le');
  assert.equal(result.frames, 288000);
  const metadata = JSON.parse(fs.readFileSync(f.json, 'utf8'));
  assert.equal(metadata.recipe, PREVIEW_AUDIO_PCM_RECIPE);
  assert.equal(metadata.bytes, metadata.frames * 2);
  assert.equal(metadata.durationSec, 12);
  assert.equal(metadata.sampleRate, 24000);
  assert.equal(metadata.channels, 1);
  assert.equal(metadata.bytesPerSample, 2);
  const status = requestPreviewAudioSidecar(options);
  assert.equal(status.state, 'ready');
  for (const field of ['format', 'sampleRate', 'channels', 'frames', 'bytesPerSample', 'durationSec', 'bytes']) {
    assert.equal(status[field], metadata[field]);
  }
  assert.equal(sweepPreviewAudioSidecars({ cacheDir: f.root, keepKeys: [`${f.key}.pcm`] }).removed, 0);
  assert.equal(sweepPreviewAudioSidecars({ cacheDir: f.root, keepKeys: [] }).removed, 2);
});

test('old format-less FLAC metadata remains readable as flac', async t => {
  const f = fixture(t);
  const options = { ...f.options, format: undefined, probeAudio: () => assert.fail('cached FLAC must not be probed') };
  const key = previewAudioSidecarStatus(options).key;
  fs.writeFileSync(path.join(f.directory, `${key}.flac`), Buffer.alloc(64));
  fs.writeFileSync(path.join(f.directory, `${key}.json`), JSON.stringify({
    recipe: PREVIEW_AUDIO_RECIPE, key, durationSec: 12, sampleRate: 48000, channels: 2, bytes: 64,
  }));
  assert.equal(previewAudioSidecarStatus(options).format, 'flac');
  assert.equal((await ensurePreviewAudioSidecar(options)).format, 'flac');
});

test('invalid or empty PCM output cannot become ready', async t => {
  const f = fixture(t);
  for (const bytes of [0, 3]) {
    fs.writeFileSync(f.pcm, Buffer.alloc(bytes));
    const result = await ensurePreviewAudioSidecar(f.options);
    assert.equal(result.ok, false);
    assert.match(result.reason, /complete nonempty s16le frames/u);
    assert.equal(fs.existsSync(f.json), false);
  }
});

test('duration-less selection uses cached probe duration and generates no sidecar for short audio', t => {
  const f = fixture(t);
  const { outSec, ...options } = f.options;
  options.decodedBytesThreshold = 64 * 1024 * 1024;
  const status = previewAudioSidecarStatus(options);
  const probePath = path.join(f.directory, `probe-${status.probe.fingerprint}.json`);
  fs.writeFileSync(probePath, JSON.stringify({ durationSec: 3 }));
  assert.equal(requestPreviewAudioSidecar(options).state, 'not-needed');
  fs.writeFileSync(probePath, JSON.stringify({ durationSec: 88 * 60 }));
  const long = previewAudioSidecarStatus(options);
  assert.equal(long.state, 'missing');
  assert.equal(long.key, previewAudioSidecarStatus({ ...f.options, outSec: 88 * 60 }).key);
  assert.equal(previewAudioSidecarStatus({ ...options, outSec: 3, clipFx: { lowcut_hz: 100 } }).key,
    previewAudioSidecarStatus({ ...f.options, format: 'flac', outSec: 3, clipFx: { lowcut_hz: 100 } }).key);
});

test('a short background probe settles with an event and no transcode', async t => {
  const f = fixture(t);
  const { outSec, ...options } = f.options;
  const events = [];
  t.after(subscribePreviewAudioSidecarEvents(event => events.push(event)));
  const result = requestPreviewAudioSidecar({ ...options, decodedBytesThreshold: 64 * 1024 * 1024,
    ffprobe: 'unused', probeAudio: () => ({ durationSec: 3, sampleRate: 48000, channels: 2 }) });
  assert.equal(result.state, 'queued');
  for (let i = 0; i < 100 && !events.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(events.length, 1);
  assert.equal(events[0].state, 'not-needed');
  assert.deepEqual(fs.readdirSync(f.directory).filter(name => !name.startsWith('probe-')), []);
});

test('real ffmpeg makes 12 seconds of mono s16le PCM with a nonzero first-second RMS', async t => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); } catch { return t.skip('ffmpeg unavailable'); }
  const available = spawnSync(ffmpeg, ['-version'], { windowsHide: true });
  if (available.status !== 0) return t.skip(`ffmpeg unavailable: ${available.error?.code ?? available.status}`);
  const f = fixture(t);
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000:duration=12', '-ac', '2', '-c:a', 'pcm_s16le', '-y', f.options.sourcePath],
  { encoding: 'utf8', windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  const result = await ensurePreviewAudioSidecar({ ...f.options, ffmpeg,
    probeAudio: () => assert.fail('PCM output must not be probed') });
  assert.equal(result.ok, true, result.reason);
  const status = previewAudioSidecarStatus(f.options);
  assert.equal(status.bytes, status.frames * 2);
  assert.ok(Math.abs(status.durationSec - 12) < 1 / 24000);
  const range = pcmWindowByteRange(status, 0, 1);
  const bytes = fs.readFileSync(result.path).subarray(range.startByte, range.endByte + 1);
  const samples = Float32Array.from({ length: range.frameCount }, (_, index) => bytes.readInt16LE(index * 2) / 32768);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  assert.ok(rms > 0.01 && rms < 1, `RMS ${rms}`);
});
