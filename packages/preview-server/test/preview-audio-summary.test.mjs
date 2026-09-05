import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
        { id: 'light', path: 'light.mp3', t: 2 }],
      narration: [{ id: 'voice', path: 'heavy.WAV', t: 1, out: 2 }],
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
    { kind: 'speech', id: 'opening-speech', key: 'speech-key', state: 'ready' },
    { kind: 'bgm', id: 'bed', key: null, state: 'queued' },
    { kind: 'narration', id: 'voice', key: 'voice-key', state: 'no-audio' },
    { kind: 'sfx', id: 'hit', key: 'hit-key', state: 'unavailable' },
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
