import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCutRanges,
  buildTimelineMap,
  detectEditVersion,
  projectLegacyEdit,
  readInternalEdit,
} from '../lib/index.js';

const text = value => `${JSON.stringify(value, null, 2)}\n`;
const range = (inside, kind = 'silence', extra = {}) => ({ in: inside[0], out: inside[1], kind, ...extra });

function legacy(version = 1, cuts = [{ src: 'base', in: 0, out: 10 }]) {
  return text({ version, fps: 30, source: 'base.mp4', cuts, overlays: [], audio: { sfx: [], narration: [] } });
}

function media(id, at, duration, sourceIn, sourceOut, src = 'main') {
  return { id, at, duration, source: { kind: 'media', src, in: sourceIn, out: sourceOut } };
}

function v2(items = [media('main-1', 0, 300, 0, 10)], extraTracks = []) {
  return text({
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4' }, { id: 'other', path: 'other.mp4' }],
    tracks: [{ id: 'v-main', lane: 'visual', items }, ...extraTracks],
  });
}

test('detectEditVersion は v0 を返す', () => assert.equal(detectEditVersion(legacy(0)), 0));
test('detectEditVersion は v1 を返す', () => assert.equal(detectEditVersion(legacy(1)), 1));
test('detectEditVersion は v2 を返す', () => assert.equal(detectEditVersion(v2()), 2));
test('detectEditVersion は未知版を拒否する', () => assert.throws(() => detectEditVersion('{"version":3}'), /0・1・2/));

test('legacy v0 の中央レンジを二分割して除去する', () => {
  const result = applyCutRanges(legacy(0), [range([3, 5])], { fps: 30 });
  const cuts = JSON.parse(result.source).cuts;
  assert.deepEqual(cuts.map(cut => [cut.in, cut.out]), [[0, 3], [5, 10]]);
  assert.equal(result.removedFrames, 60);
});

test('legacy v1 の中央レンジを二分割して除去する', () => {
  const cuts = JSON.parse(applyCutRanges(legacy(1), [range([2, 8])], { fps: 30 }).source).cuts;
  assert.deepEqual(cuts.map(cut => [cut.in, cut.out]), [[0, 2], [8, 10]]);
});

test('legacy の左端一致は分割せずトリムする', () => {
  const cuts = JSON.parse(applyCutRanges(legacy(), [range([0, 2])], { fps: 30 }).source).cuts;
  assert.deepEqual(cuts.map(cut => [cut.in, cut.out]), [[2, 10]]);
});

test('legacy の右端一致は分割せずトリムする', () => {
  const cuts = JSON.parse(applyCutRanges(legacy(), [range([8, 10])], { fps: 30 }).source).cuts;
  assert.deepEqual(cuts.map(cut => [cut.in, cut.out]), [[0, 8]]);
});

test('legacy の端から 0.15 秒以内は split 制約を踏まずトリムする', () => {
  const cuts = JSON.parse(applyCutRanges(legacy(), [range([0.05, 4])], { fps: 30 }).source).cuts;
  assert.deepEqual(cuts.map(cut => [cut.in, cut.out]), [[4, 10]]);
});

test('legacy の全域レンジは要素を削除する', () => {
  const result = applyCutRanges(legacy(), [range([0, 10])], { fps: 30 });
  assert.deepEqual(JSON.parse(result.source).cuts, []);
  assert.equal(result.removedFrames, 300);
});

test('legacy の暗黙 at は削除後に対象トラックだけ詰まる', () => {
  const source = legacy(1, [
    { src: 'base', in: 0, out: 2 },
    { src: 'base', in: 2, out: 4 },
    { src: 'base', in: 4, out: 6 },
  ]);
  const cuts = JSON.parse(applyCutRanges(source, [range([2, 4])], { fps: 30 }).source).cuts;
  assert.equal(cuts.length, 2);
  assert.equal(Object.hasOwn(cuts[1], 'at'), false);
});

test('legacy は対象外 track の明示 at を 1 ビットも変えない', () => {
  const other = { src: 'base', in: 20, out: 22, at: 17.25, track: 1 };
  const source = legacy(1, [{ src: 'base', in: 0, out: 10 }, other]);
  const cuts = JSON.parse(applyCutRanges(source, [range([2, 4])], { fps: 30 }).source).cuts;
  assert.deepEqual(cuts.find(cut => cut.track === 1), other);
});

test('legacy の speed を removedFrames に反映する', () => {
  const source = legacy(1, [{ src: 'base', in: 0, out: 10, speed: 2 }]);
  assert.equal(applyCutRanges(source, [range([2, 6])], { fps: 30 }).removedFrames, 60);
});

test('legacy の複数レンジ一括は降順の逐次適用と同じ cuts になる', () => {
  const source = legacy();
  const ranges = [range([1, 2]), range([6, 8])];
  const together = JSON.parse(applyCutRanges(source, ranges, { fps: 30 }).source).cuts;
  let sequential = source;
  for (const candidate of [...ranges].sort((a, b) => b.in - a.in)) {
    sequential = applyCutRanges(sequential, [candidate], { fps: 30 }).source;
  }
  assert.deepEqual(together, JSON.parse(sequential).cuts);
});

test('legacy で重ならないレンジは warning を返す', () => {
  const result = applyCutRanges(legacy(), [range([20, 21])], { fps: 30 });
  assert.equal(result.warnings.length, 1);
  assert.equal(result.removedFrames, 0);
});

test('空レンジは入力バイトをそのまま返す', () => {
  const source = legacy();
  assert.equal(applyCutRanges(source, [], { fps: 30 }).source, source);
});

test('不正レンジは拒否する', () => {
  assert.throws(() => applyCutRanges(legacy(), [range([3, 3])], { fps: 30 }), /不正/);
});

test('v2 の中央レンジは source と duration を同じ比率で二分する', () => {
  const result = applyCutRanges(v2(), [range([3, 5])], { fps: 30 });
  const items = JSON.parse(result.source).tracks[0].items;
  assert.deepEqual(items.map(item => [item.at, item.duration, item.source.in, item.source.out]), [
    [0, 90, 0, 3], [90, 150, 5, 10],
  ]);
  assert.equal(result.removedFrames, 60);
});

test('v2 の左端レンジは先頭を除去して残りを 0 へリップルする', () => {
  const item = JSON.parse(applyCutRanges(v2(), [range([0, 2])], { fps: 30 }).source).tracks[0].items[0];
  assert.deepEqual([item.at, item.duration, item.source.in, item.source.out], [0, 240, 2, 10]);
});

test('v2 の右端レンジは末尾を除去する', () => {
  const item = JSON.parse(applyCutRanges(v2(), [range([8, 10])], { fps: 30 }).source).tracks[0].items[0];
  assert.deepEqual([item.at, item.duration, item.source.in, item.source.out], [0, 240, 0, 8]);
});

test('v2 の全域レンジは item を削除する', () => {
  const result = applyCutRanges(v2(), [range([0, 10])], { fps: 30 });
  assert.deepEqual(JSON.parse(result.source).tracks[0].items, []);
  assert.equal(result.removedFrames, 300);
});

test('v2 は後続 media item の at だけを整数フレームで詰める', () => {
  const source = v2([media('a', 0, 150, 0, 5), media('b', 150, 150, 5, 10)]);
  const items = JSON.parse(applyCutRanges(source, [range([2, 3])], { fps: 30 }).source).tracks[0].items;
  assert.equal(items.at(-1).at, 120);
  assert.ok(items.every(item => Number.isInteger(item.at) && Number.isInteger(item.duration)));
});

test('v2 は narration audio item を変更しない', () => {
  const audio = { id: 'a-narr', lane: 'audio', items: [{ id: 'n1', at: 75, duration: 90, role: 'narration', source: { kind: 'media', src: 'main', in: 2, out: 5 } }] };
  const source = v2(undefined, [audio]);
  const before = JSON.parse(source).tracks[1];
  const after = JSON.parse(applyCutRanges(source, [range([2, 4])], { fps: 30 }).source).tracks[1];
  assert.deepEqual(after, before);
});

test('v2 は対象外 visual track を変更しない', () => {
  const other = { id: 'v-other', lane: 'visual', items: [media('other-1', 77, 60, 20, 22, 'other')] };
  const source = v2(undefined, [other]);
  const before = JSON.parse(source).tracks[1];
  const after = JSON.parse(applyCutRanges(source, [range([2, 4], 'row', { captionId: 'main' })], { fps: 30 }).source).tracks[1];
  assert.deepEqual(after, before);
});

test('v2 は captionId と同名 source があればその素材だけを対象にする', () => {
  const source = v2([media('a', 0, 300, 0, 10), media('b', 300, 300, 0, 10, 'other')]);
  const items = JSON.parse(applyCutRanges(source, [range([2, 4], 'filler', { captionId: 'other' })], { fps: 30 }).source).tracks[0].items;
  assert.deepEqual(items.filter(item => item.source.src === 'main').map(item => [item.source.in, item.source.out]), [[0, 10]]);
  assert.deepEqual(items.filter(item => item.source.src === 'other').map(item => [item.source.in, item.source.out]), [[0, 2], [4, 10]]);
});

test('v2 は captionId と同名 source が無ければ重なる主映像へフォールバックする', () => {
  const result = applyCutRanges(v2(), [range([2, 4], 'filler', { captionId: 'c-0001' })], { fps: 30 });
  assert.equal(result.removedFrames, 60);
});

test('v2 の分割 id は既存 id と衝突しない', () => {
  const source = v2([media('clip', 0, 300, 0, 10), media('clip-split', 300, 30, 20, 21)]);
  const ids = JSON.parse(applyCutRanges(source, [range([2, 4])], { fps: 30 }).source).tracks[0].items.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('clip-split-2'));
});

test('v2 の複数レンジ一括は降順の逐次適用と同じ source 区間になる', () => {
  const source = v2();
  const ranges = [range([1, 2]), range([6, 8])];
  const intervals = value => JSON.parse(value).tracks[0].items.map(item => [item.at, item.duration, item.source.in, item.source.out]);
  const together = applyCutRanges(source, ranges, { fps: 30 }).source;
  let sequential = source;
  for (const candidate of [...ranges].sort((a, b) => b.in - a.in)) sequential = applyCutRanges(sequential, [candidate], { fps: 30 }).source;
  assert.deepEqual(intervals(together), intervals(sequential));
});

test('v2 適用結果は readInternalEdit と buildTimelineMap を通り総尺が縮む', () => {
  const result = applyCutRanges(v2(), [range([2, 4])], { fps: 30 });
  const internal = readInternalEdit(result.source);
  const legacyView = projectLegacyEdit(internal);
  const timeline = buildTimelineMap(legacyView.cuts);
  assert.equal(timeline.totalDuration, 8);
  assert.ok(timeline.segments.every(segment => segment.kind !== 'gap'));
});

test('v2 で重ならないレンジは warning を返す', () => {
  const result = applyCutRanges(v2(), [range([20, 21])], { fps: 30 });
  assert.equal(result.warnings.length, 1);
  assert.equal(result.removedFrames, 0);
});
