import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATIC_DUCK_GAIN_DB,
  computeDuckIntervals,
  isWithinDuckInterval,
} from '../lib/ducking.js';
import { DEFAULT_DUCK_DB } from '../lib/envelope.js';

test('computeDuckIntervals は narration の配置と実尺から区間を作る', () => {
  assert.deepEqual(computeDuckIntervals([
    { t: 2.5, durationSec: 3 },
    { t: 10, durationSec: 1.5 },
  ]), [
    { startSec: 2.5, endSec: 5.5 },
    { startSec: 10, endSec: 11.5 },
  ]);
});

test('computeDuckIntervals は不正な開始時刻と実尺を無視する', () => {
  assert.deepEqual(computeDuckIntervals([
    { t: -1, durationSec: 1 },
    { t: Number.NaN, durationSec: 1 },
    { t: Number.POSITIVE_INFINITY, durationSec: 1 },
    { t: 1, durationSec: 0 },
    { t: 2, durationSec: -1 },
    { t: 3, durationSec: Number.NaN },
    { t: 4, durationSec: Number.POSITIVE_INFINITY },
  ]), []);
});

test('isWithinDuckInterval は開始を含み終了を含まない', () => {
  const intervals = [{ startSec: 2.5, endSec: 5.5 }];
  assert.equal(isWithinDuckInterval(intervals, 2.5), true);
  assert.equal(isWithinDuckInterval(intervals, 4), true);
  assert.equal(isWithinDuckInterval(intervals, 5.5), false);
  assert.equal(isWithinDuckInterval(intervals, 6), false);
});

test('STATIC_DUCK_GAIN_DB は DEFAULT_DUCK_DB の互換 alias である', () => {
  assert.equal(STATIC_DUCK_GAIN_DB, DEFAULT_DUCK_DB);
  assert.equal(STATIC_DUCK_GAIN_DB, -12);
});
