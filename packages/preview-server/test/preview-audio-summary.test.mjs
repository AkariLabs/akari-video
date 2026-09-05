import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { prepareFrameEngineAudioSummary } from '../src/preview-audio-summary.mjs';

function fixture(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-audio-summary-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const heavy = path.join(projectRoot, 'heavy.WAV');
  const fd = fs.openSync(heavy, 'w');
  fs.ftruncateSync(fd, 8 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  const deps = { projectRoot, cacheDir: path.join(projectRoot, '.akari', 'cache'), ffmpeg: 'fake' };
  const data = {
    output: { fps: 30 }, sources: [{ id: 'video', path: 'video.mp4' }],
    cuts: [{ id: 'opening', src: 'video', in: 0, out: 2 }],
    audio: {
      bgm: { id: 'bed', path: 'heavy.WAV' },
      sfx: [{ id: 'hit', path: 'hit.mp3', t: 3, lowcut_hz: 100, out: 1 },
        { id: 'light', path: 'light.mp3', t: 2, out: 1 }],
      narration: [{ id: 'voice', path: 'heavy.WAV', t: 1, out: 2, lowcut_hz: 100 }],
    },
  };
  return { data, deps };
}

test('summary は同期で first-use 順に要求し ready / queued / no-audio / unavailable を宣言する', t => {
  const { data, deps } = fixture(t);
  const original = structuredClone(data);
  const calls = [];
  const results = [
    { state: 'ready', key: 'speech-key', path: path.join(deps.cacheDir, 'preview-audio', 'speech-key.flac'), durationSec: 2, bytes: 64 },
    { state: 'queued', key: null, probe: 'pending' },
    { state: 'no-audio', key: 'voice-key', reason: 'no audio stream' },
    { state: 'failed', key: 'hit-key', reason: 'busy' },
  ];
  const result = prepareFrameEngineAudioSummary(data, { ...deps, requestSidecar: options => {
    calls.push(options);
    return results[calls.length - 1];
  } });
  assert.notEqual(prepareFrameEngineAudioSummary.constructor.name, 'AsyncFunction');
  const source = fs.readFileSync(new URL('../src/preview-audio-summary.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bawait\b/u);
  assert.equal(result.then, undefined);
  assert.deepEqual(result.items, [
    { kind: 'speech', id: 'opening-speech', key: 'speech-key', state: 'ready', at: 0, durationSec: 2 },
    { kind: 'bgm', id: 'bed', key: null, state: 'queued', at: 0 },
    { kind: 'narration', id: 'voice', key: 'voice-key', state: 'no-audio', at: 1, durationSec: 2 },
    { kind: 'sfx', id: 'hit', key: 'hit-key', state: 'unavailable', at: 3, durationSec: 1 },
  ]);
  assert.deepEqual(calls.map(value => path.basename(value.sourcePath)), ['video.mp4', 'heavy.WAV', 'heavy.WAV', 'hit.mp3']);
  assert.equal(calls[1].outSec, undefined, 'BGM endpoint is resolved by background probe');
  assert.equal(calls[2].outSec, 2);
  assert.deepEqual(result.keepKeys, ['speech-key', 'voice-key', 'hit-key']);
  assert.deepEqual(result.audio.speech[0].sidecar, {
    path: '.akari/cache/preview-audio/speech-key.flac', durationSec: 2,
    padBeforeSec: 0, padAfterSec: 0, skipped: true, bytes: 64,
  });
  assert.equal(result.audio.bgm.sidecarState, 'queued');
  assert.equal(Object.hasOwn(result.audio.bgm, 'sidecar'), false);
  assert.equal(result.audio.narration[0].sidecarState, 'no-audio');
  assert.equal(Object.hasOwn(result.audio.narration[0], 'sidecar'), false);
  assert.equal(result.audio.sfx[0].sidecarWarningEmitted, true);
  assert.equal(result.audio.sfx[1].sidecarState, undefined);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[1], /using source fallback \(preview approximation will differ from export\): busy/u);
  assert.deepEqual(data, original);
});

test('summary は要求結果の probe fingerprint を keepProbes に重複なく集める', t => {
  const { data, deps } = fixture(t);
  delete data.audio.narration[0].out;
  const result = prepareFrameEngineAudioSummary(data, { ...deps, requestSidecar: options => (
    options.outSec === undefined
      ? { state: 'queued', key: null, probe: { fingerprint: 'shared-source', pending: true } }
      : { state: 'queued', key: 'sidecar-key' }
  ) });
  assert.deepEqual(result.keepProbes, ['shared-source']);
  assert.deepEqual(result.keepKeys, ['sidecar-key']);
});

test('generating・invalid・ffmpeg 不在も即時の状態で返す', t => {
  const { data, deps } = fixture(t);
  const result = prepareFrameEngineAudioSummary(data, { ...deps, requestSidecar: () => ({ state: 'generating', key: 'key' }) });
  assert.equal(result.audio.bgm.sidecarState, 'generating');
  assert.equal(result.audio.bgm.sidecar, undefined);
  assert.deepEqual(result.keepKeys, ['key']);
  for (const override of [
    { requestSidecar: () => ({ state: 'invalid', reason: 'bad source' }) },
    { ffmpeg: null, requestSidecar: () => assert.fail('must not request without ffmpeg') },
  ]) {
    const failed = prepareFrameEngineAudioSummary(data, { ...deps, ...override });
    assert.equal(failed.audio.speech[0].sidecarState, 'unavailable');
    assert.equal(failed.audio.speech[0].sidecarWarningEmitted, true);
    assert.equal(failed.warnings.length, 4);
    assert.match(failed.warnings[0], /using source fallback/u);
  }
});

test('long m4a BGM requests PCM, short mp3 SFX requests nothing, short WAV FX stays FLAC', t => {
  const { deps } = fixture(t);
  const calls = [];
  const pcm = { format: 'pcm-s16le', sampleRate: 24000, channels: 1,
    frames: 88 * 60 * 24000, bytesPerSample: 2 };
  const result = prepareFrameEngineAudioSummary({ audio: {
    bgm: { id: 'long', path: 'bed.m4a', in: 0, out: 88 * 60 },
    sfx: [{ id: 'short', path: 'hit.mp3', in: 0, out: 3 },
      { id: 'fx', path: 'short.wav', in: 0, out: 3, lowcut_hz: 100, t: 1 }],
  } }, { ...deps, requestSidecar: options => {
    calls.push(options);
    return { state: 'ready', key: String(calls.length),
      path: path.join(deps.cacheDir, 'preview-audio', `${calls.length}.pcm`),
      durationSec: options.outSec - options.inSec, bytes: pcm.frames * 2,
      ...(options.format === 'pcm-s16le' ? pcm : { format: 'flac', sampleRate: 48000, channels: 2 }) };
  } });
  assert.deepEqual(calls.map(call => [path.basename(call.sourcePath), call.format]),
    [['bed.m4a', 'pcm-s16le'], ['short.wav', 'flac']]);
  assert.equal(result.audio.sfx[0].sidecar, undefined);
  for (const [field, value] of Object.entries(pcm)) assert.equal(result.audio.bgm.sidecar[field], value);
  assert.equal(result.audio.sfx[1].sidecar.format, 'flac');
});

test('decoded threshold is strict, extension independent, and uses speech trim plus pads', t => {
  const { deps } = fixture(t);
  const thresholdSec = 64 * 1024 * 1024 / (48000 * 2 * 4);
  const calls = [];
  const result = prepareFrameEngineAudioSummary({
    output: { fps: 30 }, sources: [{ id: 'v', path: 'video.mp4' }],
    cuts: [{ id: 'long-speech', src: 'v', in: 60, out: 60 + 24 * 60 }],
    audio: { narration: [{ id: 'exact', path: 'exact.wav', in: 1, out: 1 + thresholdSec },
      { id: 'over', path: 'over.mp3', in: 1, out: 1 + thresholdSec + 1 / 48000 }] },
  }, { ...deps, requestSidecar: options => { calls.push(options); return { state: 'queued', key: 'k' }; } });
  assert.deepEqual(calls.map(call => path.basename(call.sourcePath)), ['video.mp4', 'over.mp3']);
  assert.ok(calls.every(call => call.format === 'pcm-s16le'));
  assert.equal(result.audio.narration[0].sidecarState, undefined);
  assert.equal(result.audio.speech[0].sidecar, undefined);
});

test('duration-less requests delegate selection to background probe and retain its fingerprint', t => {
  const { deps } = fixture(t);
  const calls = [];
  const result = prepareFrameEngineAudioSummary({ audio: {
    bgm: { path: 'long.m4a' }, sfx: [{ path: 'short.mp3', t: 1 }],
  } }, { ...deps, requestSidecar: options => {
    calls.push(options);
    return { state: 'not-needed', key: null, probe: { fingerprint: path.basename(options.sourcePath) } };
  } });
  assert.ok(calls.every(call => call.outSec === undefined && call.decodedBytesThreshold === 64 * 1024 * 1024));
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.keepProbes, ['long.m4a', 'short.mp3']);
  assert.equal(result.audio.sfx[0].sidecarState, undefined);
});

test('Web audio and speech declarations preserve PCM metadata and their source fallback URLs', () => {
  const source = fs.readFileSync(new URL('../src/frame-engine-client.ts', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function mediaUrl('), source.indexOf('function resolvedItemAdjust('));
  const js = stripTypeScriptTypes(functions);
  const { audioDeclarations, speechDeclarations } = vm.runInNewContext(
    `${js}\n({ audioDeclarations, speechDeclarations })`, { normalizedCuts: () => [] });
  const sidecar = { path: '.akari/cache/preview-audio/test.pcm', durationSec: 12,
    padBeforeSec: 0, padAfterSec: 0, format: 'pcm-s16le', sampleRate: 24000,
    channels: 1, frames: 288000, bytesPerSample: 2 };
  const edit = { audio: { bgm: { path: 'bed.m4a', sidecar, sidecarState: 'ready' },
    speech: [{ id: 'speech', src: 'v', sidecar, sidecarState: 'ready' }] } };
  const regular = audioDeclarations(edit)[0];
  const spoken = speechDeclarations(edit, 30, new Map([['v', { url: '/source.mp4' }]]))[0];
  for (const value of [regular.spec.sidecar, spoken.sidecar]) {
    assert.deepEqual(JSON.parse(JSON.stringify(value)), { ...sidecar, path: `/${sidecar.path}` });
  }
  assert.equal(regular.sourceUrl, '/bed.m4a');
  assert.equal(spoken.url, '/source.mp4');
});
