import assert from 'node:assert/strict';
import test from 'node:test';

import { detectOpenIntervals } from '../bin/finger-frame/gesture.mjs';

function sample(t, leftDist, rightDist) {
  return {
    t,
    left: leftDist === null ? null : { dist: leftDist },
    right: rightDist === null ? null : { dist: rightDist },
  };
}

test('detectOpenIntervals: 両手が openThreshold を超えた区間だけを検出する', () => {
  const samples = [
    sample(0, 0.05, 0.05),
    sample(0.5, 0.2, 0.2), // open
    sample(1.0, 0.22, 0.21),
    sample(1.5, 0.05, 0.05), // close
  ];
  const intervals = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0,
  });
  assert.deepEqual(intervals, [{ startT: 0.5, endT: 1.5 }]);
});

test('detectOpenIntervals: ヒステリシスの不感帯（close〜open 間）はバタつきを起こさない', () => {
  // open (0.5) してから、close 未満には落ちず不感帯をうろつく -> 閉じない。
  const samples = [
    sample(0, 0.2, 0.2), // open
    sample(0.5, 0.13, 0.13), // 不感帯（close=0.11 は下回らない）-> open のまま
    sample(1.0, 0.2, 0.2),
    sample(1.5, 0.09, 0.2), // left が close 未満 -> close
  ];
  const intervals = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0,
  });
  assert.deepEqual(intervals, [{ startT: 0, endT: 1.5 }]);
});

test('detectOpenIntervals: 片手でも消失したら即座に close する（不感帯を無視）', () => {
  const samples = [
    sample(0, 0.2, 0.2), // open
    sample(0.5, 0.2, null), // 右手ロスト -> 即 close（distance が close 未満でなくても）
    sample(1.0, 0.2, 0.2), // 再度 open
    sample(1.5, 0.2, 0.2), // まだ open のまま続く
  ];
  const intervals = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0,
  });
  assert.deepEqual(intervals, [{ startT: 0, endT: 0.5 }, { startT: 1.0, endT: 1.5 }]);
});

test('detectOpenIntervals: minOpenDuration 未満の短い区間は捨てる', () => {
  const samples = [
    sample(0, 0.05, 0.05),
    sample(0.5, 0.2, 0.2),
    sample(0.6, 0.05, 0.05), // 0.1s だけの短い open
    sample(2.0, 0.2, 0.2),
    sample(3.0, 0.05, 0.05), // 1.0s の長い open
  ];
  const intervals = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0.5, maxGap: 0,
  });
  assert.deepEqual(intervals, [{ startT: 2.0, endT: 3.0 }]);
});

test('detectOpenIntervals: トラック末尾で open のまま終わる場合は最終サンプルまでを区間にする', () => {
  const samples = [sample(0, 0.05, 0.05), sample(0.5, 0.2, 0.2), sample(1.5, 0.22, 0.22)];
  const intervals = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0,
  });
  assert.deepEqual(intervals, [{ startT: 0.5, endT: 1.5 }]);
});

test('detectOpenIntervals: openThreshold <= closeThreshold は拒否する', () => {
  assert.throws(() => detectOpenIntervals([], { openThreshold: 0.1, closeThreshold: 0.1, maxGap: 0 }));
  assert.throws(() => detectOpenIntervals([], { openThreshold: 0.05, closeThreshold: 0.1, maxGap: 0 }));
});

test('detectOpenIntervals: 空配列は空配列を返す', () => {
  assert.deepEqual(detectOpenIntervals([], {
    openThreshold: 0.16, closeThreshold: 0.11, maxGap: 0,
  }), []);
});

test('detectOpenIntervals: 瞬間的な手の消失を maxGap 内で橋渡しする', () => {
  // 両手検出 11/16 サンプル。短い片手ロストと閾値割れが複数回挟まる固定系列。
  const samples = [
    sample(0.00, 0.20, 0.20),
    sample(0.05, 0.21, 0.20),
    sample(0.10, 0.20, null),
    sample(0.15, 0.21, 0.20),
    sample(0.20, 0.20, 0.20),
    sample(0.25, 0.08, 0.20),
    sample(0.30, 0.20, 0.21),
    sample(0.35, 0.20, 0.20),
    sample(0.40, null, 0.20),
    sample(0.45, null, 0.20),
    sample(0.50, 0.20, 0.20),
    sample(0.55, 0.21, 0.20),
    sample(0.60, 0.20, 0.08),
    sample(0.65, 0.20, 0.20),
    sample(0.70, 0.21, 0.21),
    sample(0.75, 0.20, 0.20),
  ];

  const immediateClose = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0,
  });
  const bridged = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0.15,
  });

  assert.equal(immediateClose.length, 5);
  assert.deepEqual(bridged, [{ startT: 0, endT: 0.75 }]);
});

test('detectOpenIntervals: maxGap 超過時は gap 開始時刻で閉じて再検出時刻から開き直す', () => {
  const samples = [
    sample(0.0, 0.20, 0.20),
    sample(0.1, 0.20, null), // gap 開始
    sample(0.2, 0.20, null),
    sample(0.4, 0.20, 0.20), // gap 超過を検出後、同じサンプルで再 open
    sample(0.5, 0.21, 0.20),
  ];

  const intervals = detectOpenIntervals(samples, {
    openThreshold: 0.16, closeThreshold: 0.11, minOpenDuration: 0, maxGap: 0.15,
  });

  assert.deepEqual(intervals, [
    { startT: 0, endT: 0.1 },
    { startT: 0.4, endT: 0.5 },
  ]);
});
