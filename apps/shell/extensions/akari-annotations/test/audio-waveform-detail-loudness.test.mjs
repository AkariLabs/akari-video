import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUDIO_LOUDNESS_BASE,
  AUDIO_LOUDNESS_RED,
  AUDIO_LOUDNESS_YELLOW,
  AudioWaveformDebounceGate,
  AudioWaveformTierLru,
  audioLoudnessBucketColors,
  audioLoopWaveformVisibleWindowPlan,
  audioWaveformBandLayout,
  audioWaveformMasterKey,
  audioWaveformTierBucketCount,
  audioWaveformTierCacheKey,
  audioWaveformVisibleSourceWindow,
  clampWaveformBucketCount,
  nextAudioWaveformTier,
  quantizeAudioWaveformWindow,
} from '../lib/common/filmstrip-geometry.js';

const widgetSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8',
);

const peakAtDb = db => 10 ** (db / 20);

test('裁定1: clipHeader は18pxから14pxへ詰め、上1px・行高12pxを使う', () => {
  assert.match(widgetSource, /const CLIP_HEADER_HEIGHT = 14;/u);
  const start = widgetSource.indexOf('.akari-annotations-strip-clip-header {');
  const end = widgetSource.indexOf('.akari-annotations-strip-clip-header-label', start);
  const css = widgetSource.slice(start, end);
  assert.match(css, /padding: 1px 3px 0;/u);
  assert.match(css, /line-height: 12px;/u);
  assert.match(css, /align-items: flex-start;/u);
});

test('裁定1: segmentLabel は上1pxを残し行高22pxから12pxへ詰める', () => {
  const start = widgetSource.indexOf('.akari-annotations-segment-label {');
  const end = widgetSource.indexOf('}', start);
  const css = widgetSource.slice(start, end);
  assert.match(css, /padding: 1px 3px;/u);
  assert.match(css, /font-size: 11px;/u);
  assert.match(css, /line-height: 12px;/u);
  assert.doesNotMatch(css, /line-height: \$\{SUBROW_HEIGHT\}px;/u);
});

test('裁定2: ラベル高さ14pxへの変更に波形の中央配置が追随する', () => {
  assert.deepEqual(audioWaveformBandLayout(52, 14), { topPx: 16, heightPx: 34 });
  assert.deepEqual(audioWaveformBandLayout(52, 18), { topPx: 19.5, heightPx: 31 });
});

test('裁定3: -3 dBちょうどは赤になる', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-3)], { durationSeconds: 1 }), [AUDIO_LOUDNESS_RED]);
});

test('裁定3: -3 dBをわずかに下回ると黄になる', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-3.01)], { durationSeconds: 1 }), [AUDIO_LOUDNESS_YELLOW]);
});

test('裁定3: -9 dBちょうどは黄になる', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-9)], { durationSeconds: 1 }), [AUDIO_LOUDNESS_YELLOW]);
});

test('裁定3: -9 dBをわずかに下回ると現行白になる', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-9.01)], { durationSeconds: 1 }), [AUDIO_LOUDNESS_BASE]);
});

test('裁定3: gain_dbを実効dBへ加算する', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-12)], {
    gainDb: 6,
    durationSeconds: 1,
  }), [AUDIO_LOUDNESS_YELLOW]);
});

test('裁定3: キーフレームで-12 dBを入れると赤から白へ落ちる', () => {
  const peaks = [peakAtDb(-1)];
  assert.deepEqual(audioLoudnessBucketColors(peaks, { durationSeconds: 1 }), [AUDIO_LOUDNESS_RED]);
  assert.deepEqual(audioLoudnessBucketColors(peaks, {
    durationSeconds: 1,
    keyframes: [{ t: 0.5, gain_db: -12 }],
  }), [AUDIO_LOUDNESS_BASE]);
});

test('裁定3: キーフレームは区間内を線形補間し範囲外は端値保持する', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-1), peakAtDb(-1)], {
    durationSeconds: 2,
    keyframes: [{ t: 0, gain_db: 0 }, { t: 2, gain_db: -12 }],
  }), [AUDIO_LOUDNESS_YELLOW, AUDIO_LOUDNESS_BASE]);
});

test('裁定3: holdキーフレームは次の点まで始点値を保持する', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-1), peakAtDb(-1)], {
    durationSeconds: 2,
    keyframes: [{ t: 0, gain_db: 0, easing: 'hold' }, { t: 2, gain_db: -12 }],
  }), [AUDIO_LOUDNESS_RED, AUDIO_LOUDNESS_RED]);
});

test('裁定3: v2のframe timebaseをfpsで秒へ直して補間する', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-1), peakAtDb(-1)], {
    durationSeconds: 2,
    keyframeFrames: true,
    fps: 30,
    keyframes: [{ t: 0, gain_db: 0 }, { t: 60, gain_db: -12 }],
  }), [AUDIO_LOUDNESS_YELLOW, AUDIO_LOUDNESS_BASE]);
});

test('裁定3: fade-inを実効dBへ適用する', () => {
  assert.deepEqual(audioLoudnessBucketColors([peakAtDb(-1), peakAtDb(-1)], {
    durationSeconds: 2,
    fadeInSeconds: 2,
  }), [AUDIO_LOUDNESS_BASE, AUDIO_LOUDNESS_YELLOW]);
});

test('裁定3: master keyはgain変更で変わる', () => {
  const base = { durationSeconds: 2, gainDb: 0 };
  assert.notEqual(audioWaveformMasterKey(1, 'slice', 20, base),
    audioWaveformMasterKey(1, 'slice', 20, { ...base, gainDb: -1 }));
});

test('裁定3: master keyはキーフレーム変更で変わる', () => {
  const base = { durationSeconds: 2, keyframes: [{ t: 0, gain_db: 0 }] };
  assert.notEqual(audioWaveformMasterKey(1, 'slice', 20, base), audioWaveformMasterKey(1, 'slice', 20, {
    ...base,
    keyframes: [{ t: 0, gain_db: -12 }],
  }));
});

test('裁定3: master keyはfade変更で変わる', () => {
  const base = { durationSeconds: 2 };
  assert.notEqual(audioWaveformMasterKey(1, 'slice', 20, base),
    audioWaveformMasterKey(1, 'slice', 20, { ...base, fadeInSeconds: 1 }));
});

test('裁定3/4: master keyはpeaks識別変更で変わりティア上昇時に再生成される', () => {
  const envelope = { durationSeconds: 2 };
  assert.notEqual(audioWaveformMasterKey(1, 'slice', 20, envelope),
    audioWaveformMasterKey(2, 'slice', 20, envelope));
});

test('裁定3: master keyは同じキーフレーム内容の順序差を正規化する', () => {
  const left = { durationSeconds: 2, keyframes: [{ t: 2, gain_db: -2 }, { t: 0, gain_db: 0 }] };
  const right = { durationSeconds: 2, keyframes: [{ t: 0, gain_db: 0 }, { t: 2, gain_db: -2 }] };
  assert.equal(audioWaveformMasterKey(1, 'slice', 20, left), audioWaveformMasterKey(1, 'slice', 20, right));
});

test('裁定4: bucketCount省略と明示200は既存の200を保つ', () => {
  assert.equal(clampWaveformBucketCount(undefined, 0.25), 200);
  assert.equal(clampWaveformBucketCount(200, 0.25), 200);
});

test('裁定4: bucketCountは1リクエスト4000で上限を切る', () => {
  assert.equal(clampWaveformBucketCount(9000, 100), 4000);
});

test('裁定4: bucketCountは秒あたり200で上限を切る', () => {
  assert.equal(clampWaveformBucketCount(4000, 2.001), 401);
});

test('裁定4: 不正bucketCountは後方互換の200へ戻す', () => {
  assert.equal(clampWaveformBucketCount(0, 10), 200);
  assert.equal(clampWaveformBucketCount(Number.NaN, 10), 200);
});

test('裁定4: T1は全尺20/s、T2は窓尺200/sでbucketCountを決める', () => {
  assert.equal(audioWaveformTierBucketCount('T0', 30), 200);
  assert.equal(audioWaveformTierBucketCount('T1', 30), 600);
  assert.equal(audioWaveformTierBucketCount('T2', 30, 1.25), 250);
  assert.equal(audioWaveformTierBucketCount('T1', 500), 4000);
});

test('裁定4: 可視窓を0.5秒単位で外向きに量子化する', () => {
  assert.deepEqual(quantizeAudioWaveformWindow(1.24, 2.26, 10), {
    startSeconds: 1,
    endSeconds: 2.5,
  });
});

test('裁定4: 量子化窓は素材の0秒と実尺を越えない', () => {
  assert.deepEqual(quantizeAudioWaveformWindow(-1, 10.4, 10.2), {
    startSeconds: 0,
    endSeconds: 10.2,
  });
});

test('裁定4: px/バケットが3pxちょうどならT0を維持し、超えたらT1へ進む', () => {
  assert.equal(nextAudioWaveformTier('T0', 600, 200), 'T0');
  assert.equal(nextAudioWaveformTier('T0', 600.01, 200), 'T1');
});

test('裁定4: T1でも3pxを超えればT2へ進み、T2より先は無い', () => {
  assert.equal(nextAudioWaveformTier('T1', 301, 100), 'T2');
  assert.equal(nextAudioWaveformTier('T2', 10000, 1), 'T2');
});

test('裁定4: タイムライン可視域をsource窓へ線形写像する', () => {
  assert.deepEqual(audioWaveformVisibleSourceWindow({
    clipStartSeconds: 10,
    displayDurationSeconds: 4,
    sourceStartSeconds: 2,
    sourceEndSeconds: 10,
    viewStartSeconds: 11,
    viewEndSeconds: 13,
  }), { startSeconds: 4, endSeconds: 8 });
});

test('裁定4: BGM可視域は現在のループ周回のsource窓へ写す', () => {
  assert.deepEqual(audioLoopWaveformVisibleWindowPlan(30, 10, 12, 14), {
    visibleSourceWindow: { startSeconds: 2, endSeconds: 4 },
    sourceOriginTimelineSeconds: 10,
    sourceSecondsPerTimelineSecond: 1,
  });
});

test('裁定4: BGM可視域がループ境界をまたぐ場合はT2連続窓を作らない', () => {
  assert.equal(audioLoopWaveformVisibleWindowPlan(30, 10, 9, 11), undefined);
});

test('裁定4: T1/T2 cache keyはtier・量子化窓・bucketCountを含む', () => {
  assert.equal(audioWaveformTierCacheKey('audio/se.wav', 'T2', {
    startSeconds: 1,
    endSeconds: 2.5,
  }, 300), 'sfxwave:audio/se.wav:T2:1.000-2.500:300');
});

test('裁定4: LRUは200件を上限にする', () => {
  const lru = new AudioWaveformTierLru(200);
  for (let index = 0; index < 201; index += 1) lru.set(`t1-${index}`, 'T1', index);
  assert.equal(lru.size, 200);
  assert.equal(lru.has('t1-0'), false);
  assert.equal(lru.has('t1-200'), true);
});

test('裁定4: LRU超過時は新旧に関係なくT2から先に破棄する', () => {
  const lru = new AudioWaveformTierLru(3);
  lru.set('t1-old', 'T1', 1);
  lru.set('t0', 'T0', 2);
  lru.set('t2-new', 'T2', 3);
  lru.set('t1-new', 'T1', 4);
  assert.deepEqual(lru.keys(), ['t1-old', 't0', 't1-new']);
});

test('裁定4: LRUのgetは同一ティア内の最近使用順を更新する', () => {
  const lru = new AudioWaveformTierLru(2);
  lru.set('a', 'T1', 1);
  lru.set('b', 'T1', 2);
  assert.equal(lru.get('a'), 1);
  lru.set('c', 'T1', 3);
  assert.deepEqual(lru.keys(), ['a', 'c']);
});

test('裁定4: debounceは同じT2キーを200ms待って1回だけ許可する', () => {
  const gate = new AudioWaveformDebounceGate(200);
  assert.deepEqual(gate.consider('window-a', 0), {
    shouldFetch: false, waitMs: 200, pendingChanged: true,
  });
  assert.equal(gate.consider('window-a', 199).shouldFetch, false);
  assert.equal(gate.consider('window-a', 200).shouldFetch, true);
  assert.equal(gate.consider('window-a', 400).shouldFetch, false);
});

test('裁定4: debounceは量子化窓が変わると待機開始時刻を更新する', () => {
  const gate = new AudioWaveformDebounceGate(200);
  gate.consider('window-a', 0);
  const changed = gate.consider('window-b', 100);
  assert.deepEqual(changed, { shouldFetch: false, waitMs: 200, pendingChanged: true });
  assert.equal(gate.consider('window-b', 299).shouldFetch, false);
  assert.equal(gate.consider('window-b', 300).shouldFetch, true);
});

test('裁定4: 同一窓の連続ズームは量子化+debounce+LRUでT2取得1回に収まる', () => {
  const lru = new AudioWaveformTierLru(200);
  const gate = new AudioWaveformDebounceGate(200);
  let fetchCount = 0;
  for (let index = 0; index < 20; index += 1) {
    const window = quantizeAudioWaveformWindow(1.01 + index * 0.005, 2.01 + index * 0.005, 10);
    const bucketCount = audioWaveformTierBucketCount('T2', 10, window.endSeconds - window.startSeconds);
    const key = audioWaveformTierCacheKey('same.wav', 'T2', window, bucketCount);
    if (lru.has(key)) continue;
    const decision = gate.consider(key, index * 25);
    if (decision.shouldFetch) {
      fetchCount += 1;
      lru.set(key, 'T2', [1]);
      gate.release(key);
    }
  }
  assert.equal(fetchCount, 1);
  assert.equal(lru.size, 1);
});
