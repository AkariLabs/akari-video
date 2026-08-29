import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const [source, supplySource, bundle, syncHarness, comparisonHarness] = await Promise.all([
  readFile(path.join(root, 'src/frame-engine-client.ts'), 'utf8'),
  readFile(path.join(root, '../frame-engine/src/audio/preview-audio-supply.ts'), 'utf8'),
  readFile(path.join(root, 'public/frame-engine.bundle.js'), 'utf8'),
  readFile(path.join(root, 'test/frame-engine-audio-sync.l1.mjs'), 'utf8'),
  readFile(path.join(root, 'test/frame-engine-audio-offline-vs-export.l1.mjs'), 'utf8'),
]);

test('frame-engine Web UI は共有 audio schedule を Web Audio ノードへ供給する', () => {
  assert.match(source, /createPreviewAudioSupply\(/u);
  assert.match(source, /projectSpeechDeclarations\(cuts/u);
  assert.doesNotMatch(source, /class FrameEngineAudioSupply|createBufferSource\(\)/u);
  assert.match(supplySource, /buildWebAudioSchedule/u);
  assert.match(supplySource, /createBufferSource\(\)/u);
  assert.match(supplySource, /createGain\(\)/u);
  assert.match(supplySource, /source\.playbackRate\.value = item\.playbackRate/u);
  assert.match(supplySource, /item\.sourceDurationSec/u);
  assert.match(supplySource, /item\.duckingEvents/u);
  assert.doesNotMatch(source, /\b-12\b/u, 'glue に ducking 値を再定義しない');
  assert.match(bundle, /function buildWebAudioSchedule/u);
  assert.equal([...bundle.matchAll(/function createPreviewAudioSupply\(/gu)].length, 1,
    'frame-engine bundle の音声供給実装は一つだけ');
  assert.match(bundle, /AudioContext unavailable|Web Audio unavailable/u);
});

test('AudioContext.currentTime が描画クロックを支配し、観測窓が同期差を返す', () => {
  assert.match(supplySource, /anchorTimelineSec \+ Math\.max\(0, context\.currentTime - anchorContextSec\)/u);
  assert.match(source, /const audioClockSeconds = this\.audio\.playbackTime\(seconds\)/u);
  assert.match(source, /pauseWatchdogMs: 150/u);
  assert.match(source, /akariFrameEngineAudioDebug/u);
  assert.match(supplySource, /lastAudioPositionAtRenderSec = context && playing/u);
  assert.match(supplySource, /const audioPositionSec = lastAudioPositionAtRenderSec/u);
  assert.match(supplySource, /lastRenderedTimelineSec - audioPositionSec/u);
});

test('評価台バナーを撤去し、計測値だけを明示フラグで表示する', () => {
  assert.doesNotMatch(source, /Frame engine 評価台|frame-engine-unsupported-banner/u);
  assert.match(source, /get\('frameEngineMetrics'\) !== '1'/u);
  assert.match(source, /metrics\.dataset\.fps/u);
  assert.match(source, /metrics\.dataset\.audioSpeech/u);
  assert.match(source, /metrics\.dataset\.speechDecodeMs/u);
});

test('L1 fixtures are tracks-first v2 and reject silent false positives', () => {
  for (const harness of [syncHarness, comparisonHarness]) {
    assert.match(harness, /version:\s*2/u);
    assert.match(harness, /lane:\s*'audio'/u);
    assert.doesNotMatch(harness, /version:\s*0/u);
  }
  assert.match(syncHarness, /scheduled\?\.itemCount > 0/u);
  assert.match(syncHarness, /scheduled\.bgm >= 1/u);
  assert.match(syncHarness, /scheduled\.narration >= 1/u);
  assert.match(syncHarness, /scheduled\.sfx >= 1/u);
  assert.match(comparisonHarness, /ffprobeDurationSec/u);
  assert.match(comparisonHarness, /id:\s*'mix-only'/u);
  assert.match(comparisonHarness, /id:\s*'mastered'/u);
  assert.match(comparisonHarness, /denoise:\s*'off',\s*loudnorm:\s*-14/u);
});
