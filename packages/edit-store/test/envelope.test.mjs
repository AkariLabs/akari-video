import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolateKeyframes } from '../../overlay-runtime/src/keyframes.mjs';
import {
  composeEnvelopesDb,
  computeDuckEnvelope,
  DEFAULT_DUCK_ATTACK_SEC,
  DEFAULT_DUCK_RELEASE_SEC,
  easingProgress,
  envelopeToGainEvents,
  evaluateEnvelopeDb,
  sampleEnvelopeLinear,
} from '../lib/envelope.js';

function approx(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !~= ${expected}`);
}

const EASINGS = [
  'linear', 'hold', 'ease-in-out',
  'in-quad', 'out-quad', 'in-out-quad',
  'in-cubic', 'out-cubic', 'in-out-cubic',
  'in-quart', 'out-quart', 'in-out-quart',
  'in-expo', 'out-expo', 'in-out-expo',
  'in-back', 'out-back', 'in-out-back',
  'out-bounce', 'out-elastic',
];

for (const easing of EASINGS) {
  test(`easingProgress(${easing}) は overlay-runtime と数値一致する`, () => {
    for (const progress of [0.01, 0.2, 0.5, 0.83, 0.99]) {
      const actual = easingProgress(easing, progress);
      const expected = interpolateKeyframes([
        { t: 0, opacity: 0, transform: { x: 0 } },
        { t: 1, opacity: 1, transform: { x: 1 }, easing },
      ], progress).x;
      approx(actual, expected, 5e-10);
    }
  });
}

test('cubic-bezier は overlay-runtime と複数点で数値一致する', () => {
  const easing = 'cubic-bezier(0.17, 0.67, 0.83, 0.67)';
  for (const progress of [0.125, 0.375, 0.625, 0.875]) {
    const expected = interpolateKeyframes([
      { t: 0, opacity: 0, transform: { x: 0 } },
      { t: 1, opacity: 1, transform: { x: 1 }, easing },
    ], progress).x;
    approx(easingProgress(easing, progress), expected, 5e-10);
  }
});

test('evaluateEnvelopeDb は区間外を端点へ固定する', () => {
  const points = [{ t: 1, gainDb: -6 }, { t: 2, gainDb: 0 }];
  assert.equal(evaluateEnvelopeDb(points, 0), -6);
  assert.equal(evaluateEnvelopeDb(points, 3), 0);
});

test('evaluateEnvelopeDb は線形補間と hold を区別する', () => {
  approx(evaluateEnvelopeDb([{ t: 0, gainDb: -12 }, { t: 2, gainDb: 0 }], 1), -6);
  assert.equal(evaluateEnvelopeDb([
    { t: 0, gainDb: -12 },
    { t: 2, gainDb: 0, easing: 'hold' },
  ], 1.99), -12);
});

test('composeEnvelopesDb は同時刻の dB を加算する', () => {
  const composed = composeEnvelopesDb(
    [{ t: 0, gainDb: -3 }, { t: 1, gainDb: -9 }],
    [{ t: 0, gainDb: -2 }, { t: 1, gainDb: -4 }],
  );
  assert.deepEqual(composed, [{ t: 0, gainDb: -5 }, { t: 1, gainDb: -13 }]);
});

test('composeEnvelopesDb は非線形区間を 20ms 以下で標本化する', () => {
  const composed = composeEnvelopesDb(
    [{ t: 0, gainDb: 0 }, { t: 0.1, gainDb: -12, easing: 'in-quad' }],
    [{ t: 0, gainDb: 0 }, { t: 0.1, gainDb: -3 }],
  );
  assert.ok(composed.length >= 6);
  assert.ok(composed.slice(1).every((point, index) => point.t - composed[index].t <= 0.020000001));
});

test('envelopeToGainEvents は dB 線形補間を指数ゲインイベントへ変換する', () => {
  const events = envelopeToGainEvents([{ t: 0, gainDb: 0 }, { t: 1, gainDb: -6 }]);
  assert.equal(events[0].method, 'set');
  assert.equal(events[1].method, 'exponential');
  approx(events[1].value, 10 ** (-6 / 20));
});

test('envelopeToGainEvents は hold 終端を set へ変換する', () => {
  const events = envelopeToGainEvents([
    { t: 0, gainDb: 0 },
    { t: 1, gainDb: -12, easing: 'hold' },
  ]);
  assert.deepEqual(events.map(event => event.method), ['set', 'set']);
});

test('envelopeToGainEvents は極小ゲインを安全な正値へ下限固定する', () => {
  const [event] = envelopeToGainEvents([{ t: 0, gainDb: -200 }]);
  assert.equal(event.value, 1e-4);
});

test('sampleEnvelopeLinear は指定 sampleRate と実尺で Float32Array を返す', () => {
  const samples = sampleEnvelopeLinear([{ t: 0, gainDb: 0 }], { sampleRate: 10, durationSec: 0.3 });
  assert.ok(samples instanceof Float32Array);
  assert.equal(samples.length, 3);
  assert.deepEqual([...samples], [1, 1, 1]);
});

test('computeDuckEnvelope は attack と release を含む', () => {
  const envelope = computeDuckEnvelope([{ startSec: 1, endSec: 2 }], {
    clipStartSec: 0, clipDurationSec: 3, duckDb: -12, attackSec: 0.1, releaseSec: 0.2,
  });
  assert.deepEqual(envelope.map(point => point.t), [0, 0.9, 1, 2, 2.2, 3]);
  assert.equal(evaluateEnvelopeDb(envelope, 1), -12);
  assert.equal(evaluateEnvelopeDb(envelope, 2), -12);
  assert.equal(evaluateEnvelopeDb(envelope, 2.2), 0);
});

test('既定値変更 2026-09-02: 宣言省略時は attack 0.3 / release 0.8 のランプになる', () => {
  const envelope = computeDuckEnvelope([{ startSec: 1, endSec: 2 }], {
    clipStartSec: 0, clipDurationSec: 3, duckDb: -12,
  });
  assert.equal(DEFAULT_DUCK_ATTACK_SEC, 0.3);
  assert.equal(DEFAULT_DUCK_RELEASE_SEC, 0.8);
  assert.deepEqual(envelope.map(point => point.t), [0, 0.7, 1, 2, 2.8, 3]);
  approx(evaluateEnvelopeDb(envelope, 0.85), -6);
  approx(evaluateEnvelopeDb(envelope, 2.4), -6);
});

test('computeDuckEnvelope は近接区間を統合して復帰の揺れを作らない', () => {
  const envelope = computeDuckEnvelope([
    { startSec: 1, endSec: 2 },
    { startSec: 2.1, endSec: 3 },
  ], { clipStartSec: 0, clipDurationSec: 4, attackSec: 0.05, releaseSec: 0.3 });
  assert.equal(envelope.filter(point => point.gainDb === 0 && point.t > 1 && point.t < 3).length, 0);
});

test('computeDuckEnvelope はクリップ外の時刻を相対化して切り詰める', () => {
  const envelope = computeDuckEnvelope([{ startSec: 10, endSec: 12 }], {
    clipStartSec: 11, clipDurationSec: 3, attackSec: 0.05, releaseSec: 0.3,
  });
  envelope.map(point => point.t).forEach((actual, index) => approx(actual, [0, 1, 1.3, 3][index]));
  assert.equal(envelope[0].gainDb, -12);
});

test('computeDuckEnvelope は無関係な区間なら空配列を返す', () => {
  assert.deepEqual(computeDuckEnvelope([{ startSec: 10, endSec: 12 }], {
    clipStartSec: 0, clipDurationSec: 1,
  }), []);
});

test('既定値変更 2026-09-02: computeDuckEnvelope は不正な設定値を既定値へ戻す', () => {
  const envelope = computeDuckEnvelope([{ startSec: 1, endSec: 2 }], {
    clipStartSec: 0, clipDurationSec: 3, duckDb: -99, attackSec: -1, releaseSec: 99,
  });
  assert.ok(envelope.some(point => point.t === 0.7));
  assert.ok(envelope.some(point => point.t === 2.8));
  assert.equal(evaluateEnvelopeDb(envelope, 1), -12);
});
