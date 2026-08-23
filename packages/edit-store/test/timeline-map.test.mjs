import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineMap, outputToSource, transitionProgressAt } from '../lib/timeline-map.js';

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
  assert.equal(map.transitionWindows.length, 0);
});

test('トランジション窓は前後 2 cut・source 時刻・0→1 の進行度を保持する', () => {
  const map = buildTimelineMap([
    { in: 0, out: 4, transitionOut: { type: 'fade-black', duration: 1 } },
    { in: 10, out: 14 }
  ]);
  approx(map.segments[1].outStart, 4);
  approx(map.segments[1].outEnd, 7);
  approx(map.totalDuration, 7);
  assert.equal(map.transitionPlates.length, 1);
  assert.equal(map.transitionPlates[0].color, '#000');
  assert.equal(map.transitionWindows.length, 1);
  const window = map.transitionWindows[0];
  assert.equal(window.type, 'fade-black');
  approx(window.start, 3);
  approx(window.end, 4);
  approx(window.outgoing.in, 3);
  approx(window.outgoing.out, 4);
  approx(window.incoming.in, 10);
  approx(window.incoming.out, 11);
  approx(transitionProgressAt(window, 3), 0);
  approx(transitionProgressAt(window, 3.5), 0.5);
  approx(transitionProgressAt(window, 4), 1);

  // dissolve は plate を持たず、2 映像窓だけを持つ。
  const dissolve = buildTimelineMap([
    { in: 0, out: 4, transitionOut: { type: 'dissolve', duration: 1 } },
    { in: 10, out: 14 }
  ]);
  approx(dissolve.segments[1].outStart, 4);
  assert.equal(dissolve.transitionPlates.length, 0);
  assert.equal(dissolve.transitionWindows[0].type, 'dissolve');
});

test('5 種すべてが同尺の transition window になり、明示 overlap は実尺へ clamp される', () => {
  for (const type of ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up']) {
    const map = buildTimelineMap([
      { in: 0, out: 4, at: 0, transitionOut: { type, duration: 1 } },
      { in: 10, out: 14, at: 3.4 }
    ]);
    assert.equal(map.transitionWindows.length, 1, type);
    approx(map.transitionWindows[0].start, 3.4);
    approx(map.transitionWindows[0].end, 4);
    approx(map.transitionWindows[0].duration, 0.6);
  }
});

test('宣言尺を超える無関係な重なりには transition window を作らない', () => {
  const map = buildTimelineMap([
    { in: 0, out: 4, at: 0, transitionOut: { type: 'dissolve', duration: 0.5 } },
    { in: 10, out: 14, at: 2 }
  ]);
  assert.deepEqual(map.transitionWindows, []);
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
  // 窓後は従来どおり incoming の 1 秒経過地点へ対応する。
  const after = outputToSource(overlap.segments, 4.5);
  assert.equal(after.segment.cutIndex, 1);
  approx(after.sourceT, 11.5);
});
