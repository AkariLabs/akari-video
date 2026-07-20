// duckingGain.ts の純粋関数テスト（DOM 非依存 — dist/ ビルド後の plain JS を直接 import できる）。
// preview-narration の受け入れ条件「ducking:true のとき
// narration 区間の BGM ゲインが -12dB になることの観測記録（ユニットテストでのゲイン計算検証でも可）」
// を満たす検証。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_GAIN_DB_MIN,
  AUDIO_GAIN_DB_MAX,
  STATIC_DUCK_GAIN_DB,
  clampGainDb,
  dbToLinear,
  computeDuckIntervals,
  isWithinDuckInterval,
  computeBgmDuckGainDb,
} from '../dist/duckingGain.js';

test('clampGainDb: 省略時は既定 0', () => {
  assert.equal(clampGainDb(undefined), 0);
});

test('clampGainDb: 範囲内はそのまま', () => {
  assert.equal(clampGainDb(-6), -6);
  assert.equal(clampGainDb(0), 0);
});

test('clampGainDb: 範囲外の有限値はクランプする（棄却しない — 契約 §4）', () => {
  assert.equal(clampGainDb(20), AUDIO_GAIN_DB_MAX);
  assert.equal(clampGainDb(-100), AUDIO_GAIN_DB_MIN);
});

test('clampGainDb: 非有限値は null（呼び出し側が要素を無視する契機）', () => {
  assert.equal(clampGainDb(NaN), null);
  assert.equal(clampGainDb(Infinity), null);
  assert.equal(clampGainDb(-Infinity), null);
});

test('dbToLinear: 0dB は等倍', () => {
  assert.equal(dbToLinear(0), 1);
});

test('dbToLinear: -12dB は約 0.251 倍（静的ダッキング近似量の実効値）', () => {
  assert.ok(Math.abs(dbToLinear(STATIC_DUCK_GAIN_DB) - 0.2512) < 0.001);
});

test('computeDuckIntervals: narration の t/実尺から [t, t+duration) 区間を作る', () => {
  const intervals = computeDuckIntervals([
    { t: 2.5, durationSec: 3.0 },
    { t: 10.0, durationSec: 1.5 },
  ]);
  assert.deepEqual(intervals, [
    { startSec: 2.5, endSec: 5.5 },
    { startSec: 10.0, endSec: 11.5 },
  ]);
});

test('computeDuckIntervals: 不正な尺（非有限・0以下）は区間化しない', () => {
  const intervals = computeDuckIntervals([
    { t: 1, durationSec: 0 },
    { t: 2, durationSec: -1 },
    { t: 3, durationSec: NaN },
    { t: -1, durationSec: 1 },
  ]);
  assert.deepEqual(intervals, []);
});

test('isWithinDuckInterval: 区間内/外を正しく判定する', () => {
  const intervals = [{ startSec: 2.5, endSec: 5.5 }];
  assert.equal(isWithinDuckInterval(intervals, 2.5), true); // 開始点は含む
  assert.equal(isWithinDuckInterval(intervals, 4.0), true);
  assert.equal(isWithinDuckInterval(intervals, 5.5), false); // 終了点は含まない（半開区間）
  assert.equal(isWithinDuckInterval(intervals, 6.0), false);
});

test('computeBgmDuckGainDb: ducking:true かつ区間内なら固定 -12dB（契約 §3 の静的近似値）', () => {
  const intervals = computeDuckIntervals([{ t: 12.5, durationSec: 2.0 }]);
  assert.equal(computeBgmDuckGainDb(intervals, true, 13.0), STATIC_DUCK_GAIN_DB);
});

test('computeBgmDuckGainDb: 区間外は元に戻す（0dB。契約 §3「区間外は元に戻す」）', () => {
  const intervals = computeDuckIntervals([{ t: 12.5, durationSec: 2.0 }]);
  assert.equal(computeBgmDuckGainDb(intervals, true, 20.0), 0);
});

test('computeBgmDuckGainDb: ducking:false のときは区間内でも 0（no-op）', () => {
  const intervals = computeDuckIntervals([{ t: 12.5, durationSec: 2.0 }]);
  assert.equal(computeBgmDuckGainDb(intervals, false, 13.0), 0);
});

test('computeBgmDuckGainDb: 複数 narration の区間が重なっていても値は変わらない（静的近似 = 二重に下げない）', () => {
  const intervals = computeDuckIntervals([
    { t: 0, durationSec: 5 },
    { t: 2, durationSec: 5 },
  ]);
  assert.equal(computeBgmDuckGainDb(intervals, true, 3), STATIC_DUCK_GAIN_DB);
});
