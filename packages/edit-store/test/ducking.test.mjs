import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATIC_DUCK_GAIN_DB,
  computeBgmDuckGainDb,
  computeDuckIntervals,
  isWithinDuckInterval,
} from '../lib/ducking.js';

test('computeDuckIntervals: narration の t と実尺から半開区間を作る', () => {
  assert.deepEqual(computeDuckIntervals([
    { t: 2.5, durationSec: 3 },
    { t: 10, durationSec: 1.5 },
  ]), [
    { startSec: 2.5, endSec: 5.5 },
    { startSec: 10, endSec: 11.5 },
  ]);
});

test('computeDuckIntervals: 不正な開始時刻と実尺は区間化しない', () => {
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

test('isWithinDuckInterval: 開始点を含み終了点を含まない', () => {
  const intervals = [{ startSec: 2.5, endSec: 5.5 }];
  assert.equal(isWithinDuckInterval(intervals, 2.5), true);
  assert.equal(isWithinDuckInterval(intervals, 4), true);
  assert.equal(isWithinDuckInterval(intervals, 5.5), false);
  assert.equal(isWithinDuckInterval(intervals, 6), false);
});

test('computeBgmDuckGainDb: 有効時の区間内だけ固定ゲインを返す', () => {
  const intervals = computeDuckIntervals([{ t: 12.5, durationSec: 2 }]);
  assert.equal(computeBgmDuckGainDb(intervals, true, 12.5), STATIC_DUCK_GAIN_DB);
  assert.equal(computeBgmDuckGainDb(intervals, true, 14.5), 0);
  assert.equal(computeBgmDuckGainDb(intervals, false, 13), 0);
});

test('computeBgmDuckGainDb: narration 区間が重なっても減衰量を重ねない', () => {
  const intervals = computeDuckIntervals([
    { t: 0, durationSec: 5 },
    { t: 2, durationSec: 5 },
  ]);
  assert.equal(computeBgmDuckGainDb(intervals, true, 3), STATIC_DUCK_GAIN_DB);
});

test('旧 Web UI / shell 規則と 2,002 点で一致する', () => {
  const sources = [
    { t: 0.75, durationSec: 1.25 },
    { t: 1.5, durationSec: 2.5 },
    { t: 7.25, durationSec: 1.5 },
  ];
  const webNodes = sources.map(source => ({ t: source.t, _buffer: { duration: source.durationSec } }));
  const shellItems = sources.map(source => ({ ...source }));
  const webIntervals = computeDuckIntervals(webNodes
    .filter(node => node._buffer)
    .map(node => ({ t: node.t, durationSec: node._buffer.duration })));
  const shellIntervals = computeDuckIntervals(shellItems);
  let compared = 0;

  for (const ducking of [false, true]) {
    for (let step = 0; step <= 1000; step += 1) {
      const atSec = step / 100;
      const legacyWeb = ducking && webNodes.some(node => atSec >= node.t
        && atSec < node.t + node._buffer.duration) ? STATIC_DUCK_GAIN_DB : 0;
      const legacyShell = ducking && shellItems.some(item => atSec >= item.t
        && atSec < item.t + item.durationSec) ? STATIC_DUCK_GAIN_DB : 0;
      assert.equal(computeBgmDuckGainDb(webIntervals, ducking, atSec), legacyWeb);
      assert.equal(computeBgmDuckGainDb(shellIntervals, ducking, atSec), legacyShell);
      compared += 1;
    }
  }

  assert.equal(compared, 2002);
});
