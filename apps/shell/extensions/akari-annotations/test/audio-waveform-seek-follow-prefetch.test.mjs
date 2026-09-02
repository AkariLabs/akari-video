import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AudioWaveformDebounceGate,
  AudioWaveformPanScheduleGate,
  audioWaveformPrefetchWindow,
  audioWaveformTierBucketCount,
  audioWaveformWindowContains,
} from '../lib/common/filmstrip-geometry.js';

const widgetSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url),
  'utf8',
);

function method(startNeedle, endNeedle) {
  const start = widgetSource.indexOf(startNeedle);
  const end = widgetSource.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return widgetSource.slice(start, end);
}

function panRefreshCount(starts, visibleDuration = 10) {
  const sourceWindow = { startSeconds: 0, endSeconds: 100 };
  let coverage = audioWaveformPrefetchWindow({
    visibleWindow: { startSeconds: starts[0], endSeconds: starts[0] + visibleDuration },
    sourceWindow,
    fullDurationSeconds: 100,
  });
  assert.ok(coverage);
  let refreshCount = 0;
  for (const startSeconds of starts.slice(1)) {
    const visibleWindow = {
      startSeconds,
      endSeconds: startSeconds + visibleDuration,
    };
    if (audioWaveformWindowContains(coverage, visibleWindow)) continue;
    coverage = audioWaveformPrefetchWindow({
      visibleWindow,
      sourceWindow,
      fullDurationSeconds: 100,
    });
    assert.ok(coverage);
    refreshCount += 1;
  }
  return refreshCount;
}

test('裁定1: 先読み窓は可視窓幅100%を前後へ足す', () => {
  assert.deepEqual(audioWaveformPrefetchWindow({
    visibleWindow: { startSeconds: 10.2, endSeconds: 12.2 },
    sourceWindow: { startSeconds: 0, endSeconds: 30 },
    fullDurationSeconds: 30,
  }), { startSeconds: 8, endSeconds: 14.5 });
});

test('裁定1: 先読み窓はトリム済みsource範囲の左右端を越えない', () => {
  const sourceWindow = { startSeconds: 9.3, endSeconds: 13.7 };
  assert.deepEqual(audioWaveformPrefetchWindow({
    visibleWindow: { startSeconds: 9.5, endSeconds: 10.5 },
    sourceWindow,
    fullDurationSeconds: 20,
  }), { startSeconds: 9.3, endSeconds: 11.5 });
  assert.deepEqual(audioWaveformPrefetchWindow({
    visibleWindow: { startSeconds: 12.7, endSeconds: 13.7 },
    sourceWindow,
    fullDurationSeconds: 20,
  }), { startSeconds: 11.5, endSeconds: 13.7 });
});

test('裁定1: 先読み窓は既存0.5秒量子へ外向きに揃う', () => {
  assert.deepEqual(audioWaveformPrefetchWindow({
    visibleWindow: { startSeconds: 2.2, endSeconds: 3.1 },
    sourceWindow: { startSeconds: 0, endSeconds: 10 },
    fullDurationSeconds: 10,
  }), { startSeconds: 1, endSeconds: 4 });
});

test('裁定1: bucketCountはマージン込み窓長で計算して4000を上限にする', () => {
  const coverage = audioWaveformPrefetchWindow({
    visibleWindow: { startSeconds: 100, endSeconds: 130 },
    sourceWindow: { startSeconds: 0, endSeconds: 500 },
    fullDurationSeconds: 500,
  });
  assert.deepEqual(coverage, { startSeconds: 70, endSeconds: 160 });
  assert.equal(
    audioWaveformTierBucketCount('T2', 500, coverage.endSeconds - coverage.startSeconds),
    4000,
  );
});

test('裁定1: coverage端点まではマージン内、越えた時だけ窓跨ぎになる', () => {
  const coverage = { startSeconds: 10, endSeconds: 40 };
  assert.equal(audioWaveformWindowContains(
    coverage,
    { startSeconds: 30, endSeconds: 40 },
  ), true);
  assert.equal(audioWaveformWindowContains(
    coverage,
    { startSeconds: 30.01, endSeconds: 40.01 },
  ), false);
});

test('裁定3: 可視窓1個ぶんを60ステップでパンしても追加取得は0回', () => {
  const starts = Array.from({ length: 61 }, (_, index) => 20 + 10 * index / 60);
  assert.equal(panRefreshCount(starts), 0);
});

test('裁定3: 60ステップのパンが先読み窓を跨いでも追加取得は1〜2回以内', () => {
  const withinMargin = Array.from({ length: 61 }, (_, index) => 20 + 10 * index / 60);
  const acrossMargin = Array.from({ length: 60 }, (_, index) => 30 + 10 * (index + 1) / 60);
  const refreshCount = panRefreshCount([...withinMargin, ...acrossMargin]);
  assert.ok(refreshCount >= 1 && refreshCount <= 2, `refreshCount=${refreshCount}`);
});

test('裁定2: パン中のT2評価は100ms未満の呼び出しをスロットルする', () => {
  const gate = new AudioWaveformPanScheduleGate(100);
  const evaluatedAt = [];
  for (let nowMs = 0; nowMs <= 960; nowMs += 16) {
    if (gate.shouldEvaluate(nowMs)) evaluatedAt.push(nowMs);
  }
  assert.ok(evaluatedAt.length < 60);
  assert.ok(evaluatedAt.every((value, index) => index === 0 || value - evaluatedAt[index - 1] >= 100));
});

test('裁定2: パンスロットル後の同一量子化キーは200msデバウンスで取得1回になる', () => {
  const throttle = new AudioWaveformPanScheduleGate(100);
  const debounce = new AudioWaveformDebounceGate(200);
  let fetchCount = 0;
  for (let nowMs = 0; nowMs <= 960; nowMs += 16) {
    if (!throttle.shouldEvaluate(nowMs)) continue;
    if (debounce.consider('quantized-window', nowMs).shouldFetch) fetchCount += 1;
  }
  assert.equal(fetchCount, 1);
});

test('裁定2: transformパンの軽量フックは描画せず既存量子化・LRU・デバウンス経路へ配線される', () => {
  const applyPan = method('protected applyPanTransform(', 'protected scheduleAudioWaveformT2DuringPan(');
  const panHook = method('protected scheduleAudioWaveformT2DuringPan(', 'protected schedulePanSettle(');
  const coverage = method('protected audioWaveformT2Coverage(', 'protected fetchAudioWaveformTier(');
  const debounce = method('protected scheduleAudioWaveformT2(', 'protected updateBgmWaveform(');

  assert.ok(applyPan.includes('this.scheduleAudioWaveformT2DuringPan()'));
  assert.ok(panHook.includes('this.waveformPanScheduleGate.shouldEvaluate(Date.now())'));
  assert.ok(panHook.includes('this.waveformT2PanTargets.values()'));
  assert.ok(!panHook.includes('this.renderStrip()'));
  assert.ok(coverage.includes('audioWaveformPrefetchWindow({'));
  assert.ok(coverage.includes('this.waveformTierCache.has(coverage.key)'));
  assert.ok(coverage.includes('this.scheduleAudioWaveformT2(path, key, audioUri, window, bucketCount)'));
  assert.ok(debounce.includes('new AudioWaveformDebounceGate(200)'));
  assert.ok(debounce.includes('gate.consider(key, Date.now())'));
  assert.ok(debounce.includes('window.setTimeout('));
});
