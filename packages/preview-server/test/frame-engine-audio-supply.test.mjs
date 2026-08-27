import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const [source, bundle, syncHarness, comparisonHarness] = await Promise.all([
  readFile(path.join(root, 'src/frame-engine-client.ts'), 'utf8'),
  readFile(path.join(root, 'public/frame-engine.bundle.js'), 'utf8'),
  readFile(path.join(root, 'test/frame-engine-audio-sync.l1.mjs'), 'utf8'),
  readFile(path.join(root, 'test/frame-engine-audio-offline-vs-export.l1.mjs'), 'utf8'),
]);

test('frame-engine Web UI は共有 audio schedule を Web Audio ノードへ供給する', () => {
  assert.match(source, /buildWebAudioSchedule/u);
  assert.match(source, /createBufferSource\(\)/u);
  assert.match(source, /createGain\(\)/u);
  assert.match(source, /source\.start\(contextStart \+ item\.delaySec/u);
  assert.match(source, /item\.duckingEvents/u);
  assert.doesNotMatch(source, /\b-12\b/u, 'glue に ducking 値を再定義しない');
  assert.match(bundle, /function buildWebAudioSchedule/u);
  assert.match(bundle, /AudioContext unavailable|Web Audio unavailable/u);
});

test('AudioContext.currentTime が描画クロックを支配し、観測窓が同期差を返す', () => {
  assert.match(source, /anchorTimelineSec \+ Math\.max\(0, context\.currentTime - this\.anchorContextSec\)/u);
  assert.match(source, /const audioClockSeconds = this\.audio\.playbackTime\(seconds\)/u);
  assert.match(source, /window\.setTimeout\([\s\S]*?150\)/u);
  assert.match(source, /akariFrameEngineAudioDebug/u);
  assert.match(source, /lastAudioPositionAtRenderSec = this\.context && this\.playing/u);
  assert.match(source, /const audioPositionSec = this\.lastAudioPositionAtRenderSec/u);
  assert.match(source, /lastRenderedTimelineSec - audioPositionSec/u);
});

test('音声対応バナーは overlays / 字幕だけを未対応として残す', () => {
  const bannerLine = source.split('\n').find(line => line.includes('Frame engine 評価台')) ?? '';
  assert.match(bannerLine, /cuts \+ layers \+ matte \+ 音声/u);
  assert.match(bannerLine, /未対応: overlays \/ 字幕/u);
  assert.doesNotMatch(bannerLine, /字幕 \/ 音声/u);
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
