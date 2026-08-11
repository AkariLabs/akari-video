import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCornerKeyframes } from '../bin/finger-frame/keyframes.mjs';

const IDENTITY_TRANSFORM = (point) => point;
const IDENTITY_TIMELINE = (sourceT) => sourceT;

function handSample(t, corners) {
  const [leftThumb, leftIndex, rightThumb, rightIndex] = corners;
  return {
    t,
    left: { thumb: leftThumb, index: leftIndex },
    right: { thumb: rightThumb, index: rightIndex },
  };
}

// 中心を軸にゆっくり広がっていく素朴な 4 点（実際の四角形の形は重要でない -- 分岐カバレッジ用）。
function growingCorners(spread) {
  return [
    [0.5 - spread, 0.5 - spread * 0.9], // leftThumb
    [0.5 - spread, 0.5 + spread * 0.9], // leftIndex
    [0.5 + spread, 0.5 - spread * 0.9], // rightThumb
    [0.5 + spread, 0.5 + spread * 0.9], // rightIndex
  ];
}

test('buildCornerKeyframes: 区間内の両端点を保持しつつ 2 点以上を返す', () => {
  const samples = [0, 0.25, 0.5, 0.75, 1.0].map((t) => handSample(t, growingCorners(0.2 + t * 0.05)));
  const points = buildCornerKeyframes(samples, { startT: 0, endT: 1.0 }, {
    letterboxTransform: IDENTITY_TRANSFORM,
    mapTimelineTime: IDENTITY_TIMELINE,
    maxPointsPerSec: 4,
  });
  assert.ok(points.length >= 2);
  assert.equal(points[0].t, 0);
  assert.equal(points[points.length - 1].t, 1.0);
});

test('buildCornerKeyframes: maxPointsPerSec による間引きが効く（密なサンプルでも点数が抑えられる）', () => {
  const samples = [];
  for (let i = 0; i <= 100; i += 1) {
    const t = i * 0.01; // 0..1s を 0.01s 刻み（100Hz 相当の密なサンプル）
    samples.push(handSample(t, growingCorners(0.2 + t * 0.05)));
  }
  const points = buildCornerKeyframes(samples, { startT: 0, endT: 1.0 }, {
    letterboxTransform: IDENTITY_TRANSFORM,
    mapTimelineTime: IDENTITY_TIMELINE,
    maxPointsPerSec: 4,
  });
  // 1 秒区間・4 点/秒なら概ね 4-6 点程度に収まるはず（101 点そのままではない）。
  assert.ok(points.length < 10, `間引きが効いていない（${points.length} 点）`);
  assert.ok(points.length >= 2);
});

test('buildCornerKeyframes: サンプルが 1 個しかない区間は 2 点へパディングする', () => {
  const samples = [handSample(0.5, growingCorners(0.2))];
  const points = buildCornerKeyframes(samples, { startT: 0.4, endT: 0.6 }, {
    letterboxTransform: IDENTITY_TRANSFORM,
    mapTimelineTime: IDENTITY_TIMELINE,
    maxPointsPerSec: 4,
  });
  assert.equal(points.length, 2);
  assert.deepEqual(points[0].corners, points[1].corners);
  assert.ok(points[1].t > points[0].t);
});

test('buildCornerKeyframes: 全サンプルが退化（両手が同一点に潰れている）なら空配列を返す', () => {
  const degenerate = [0.5, 0.5, 0.5, 0.5].map(() => [0.5, 0.5]);
  const samples = [handSample(0, degenerate), handSample(0.5, degenerate)];
  const points = buildCornerKeyframes(samples, { startT: 0, endT: 0.5 }, {
    letterboxTransform: IDENTITY_TRANSFORM,
    mapTimelineTime: IDENTITY_TIMELINE,
    maxPointsPerSec: 4,
  });
  assert.deepEqual(points, []);
});

test('buildCornerKeyframes: letterboxTransform / mapTimelineTime を実際に適用する', () => {
  const samples = [handSample(0, growingCorners(0.2)), handSample(1, growingCorners(0.25))];
  const points = buildCornerKeyframes(samples, { startT: 0, endT: 1 }, {
    letterboxTransform: ([x, y]) => [x * 2, y * 2],
    mapTimelineTime: (sourceT) => sourceT + 100,
    maxPointsPerSec: 4,
  });
  assert.equal(points[0].t, 100);
  assert.equal(points[points.length - 1].t, 101);
  for (const point of points) {
    for (const [x, y] of point.corners) {
      assert.ok(x >= 0 && x <= 2 && y >= 0 && y <= 2);
    }
  }
});
