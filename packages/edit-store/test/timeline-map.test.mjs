import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineMap, outputToSource } from '../lib/timeline-map.js';

function approx(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} !~ ${expected}`);
}

test('v2 単一モード: speed 込みの出力区間と総尺', () => {
  const map = buildTimelineMap([
    { in: 0, out: 5 },
    { in: 5, out: 10, speed: 2 }
  ]);
  assert.equal(map.usesGapsOrTracks, true);
  assert.equal(map.segments.length, 2);
  approx(map.segments[0].outStart, 0);
  approx(map.segments[0].outEnd, 5);
  approx(map.segments[1].outStart, 5);
  approx(map.segments[1].outEnd, 7.5);
  approx(map.totalDuration, 7.5);
  assert.equal(map.transitionPlates.length, 0);
});

test('トランジション重なりは絶対配置の平坦化で先行カットを優先する', () => {
  const map = buildTimelineMap([
    { in: 0, out: 4, transitionOut: { type: 'fade-black', duration: 1 } },
    { in: 10, out: 14 }
  ]);
  approx(map.segments[1].outStart, 4);
  approx(map.segments[1].outEnd, 7);
  approx(map.totalDuration, 7);
  assert.equal(map.transitionPlates.length, 0);

  // dissolve は尺計算のみ（プレートなし）— §2.6
  const dissolve = buildTimelineMap([
    { in: 0, out: 4, transitionOut: { type: 'dissolve', duration: 1 } },
    { in: 10, out: 14 }
  ]);
  approx(dissolve.segments[1].outStart, 4);
  assert.equal(dissolve.transitionPlates.length, 0);
});

test('at 指定でギャップが出力セグメントとして現れる', () => {
  const map = buildTimelineMap([{ in: 0, out: 5, at: 2 }]);
  assert.equal(map.usesGapsOrTracks, true);
  assert.deepEqual(map.segments.map(s => s.kind), ['gap', 'src']);
  approx(map.segments[0].outStart, 0);
  approx(map.segments[0].outEnd, 2);
  approx(map.segments[1].outStart, 2);
  approx(map.segments[1].outEnd, 7);
  approx(map.totalDuration, 7);
});

test('マルチトラック平坦化: 既定は小さい track 番号が勝つ / trackZ で上書き可', () => {
  const cuts = [
    { in: 0, out: 10 },
    { in: 0, out: 4, at: 3, track: 1 }
  ];
  const byDefault = buildTimelineMap(cuts);
  assert.equal(byDefault.segments.length, 1);
  assert.equal(byDefault.segments[0].cutIndex, 0);
  approx(byDefault.totalDuration, 10);

  const higherWins = buildTimelineMap(cuts, { trackZ: track => track });
  assert.deepEqual(higherWins.segments.map(s => s.cutIndex), [0, 1, 0]);
  approx(higherWins.segments[1].outStart, 3);
  approx(higherWins.segments[1].outEnd, 7);
  approx(higherWins.segments[1].in, 0);
  approx(higherWins.segments[1].out, 4);
  // 復帰後の track0 はソース秒 7 から再開する
  approx(higherWins.segments[2].in, 7);
  approx(higherWins.segments[2].out, 10);
});

test('outputToSource: src 写像 / gap は null / 末尾超えはクランプ / 重なりは先行が勝つ', () => {
  const map = buildTimelineMap([{ in: 0, out: 5, at: 2 }]);
  assert.equal(outputToSource(map.segments, 1).sourceT, null);
  approx(outputToSource(map.segments, 4).sourceT, 2);
  approx(outputToSource(map.segments, 99).sourceT, 5);

  const overlap = buildTimelineMap([
    { in: 0, out: 4, transitionOut: { type: 'fade-black', duration: 1 } },
    { in: 10, out: 14 }
  ]);
  // 出力 3.5 秒は両セグメントに含まれるが先行（cut 0）が勝つ
  const mapped = outputToSource(overlap.segments, 3.5);
  assert.equal(mapped.segment.cutIndex, 0);
  approx(mapped.sourceT, 3.5);
});
