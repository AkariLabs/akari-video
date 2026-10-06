import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCutRanges,
  restoreCutRange,
  canRestoreCutRange,
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

test('legacy v1 は reason / label を残った cuts へ永続化する', () => {
  const cuts = JSON.parse(applyCutRanges(legacy(1), [range([2, 8], 'silence', { reason: 'silence', label: '長い無音' })], { fps: 30 }).source).cuts;
  assert.deepEqual(cuts.map(cut => [cut.reason, cut.label]), [['silence', '長い無音'], ['silence', '長い無音']]);
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

test('v2 は reason / label を残った media items へ永続化する', () => {
  const items = JSON.parse(applyCutRanges(v2(), [range([3, 5], 'row', { reason: 'word', label: '言い直し' })], { fps: 30 }).source).tracks[0].items;
  assert.deepEqual(items.map(item => [item.reason, item.label]), [['word', '言い直し'], ['word', '言い直し']]);
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

test('v2 の中央 1 か所は構造から戻して元の文字列と一致する', () => {
  const source = v2();
  const cut = range([3, 5], 'row', { captionId: 'main', label: '行' });
  const restored = restoreCutRange(applyCutRanges(source, [cut]).source, cut);
  assert.equal(restored.restored, true, restored.reason);
  assert.equal(restored.source, source);
});

test('v2 の reason / label 付き無音カットを戻すと元の文字列と一致する', () => {
  const source = v2();
  const cut = range([2, 4], 'silence', { captionId: 'main', reason: 'silence', label: '無音' });
  const restored = restoreCutRange(applyCutRanges(source, [cut]).source, cut);
  assert.equal(restored.restored, true, restored.reason);
  assert.equal(restored.source, source);
});

test('実時刻の 3 か所を切り最初だけ戻しても、残り 2 か所と後続位置を保つ', () => {
  const source = v2([media('cut-a', 0, 480, 0, 16)]);
  const cuts = [range([0.5, 0.9], 'filler', { captionId: 'main', label: 'えー' }),
    range([6.1, 6.5], 'unrecognized', { captionId: 'main', label: '??' }),
    range([11.966666666666667, 15.033333333333333], 'row', { captionId: 'main', label: '行' })];
  let edited = source;
  for (const cut of cuts) edited = applyCutRanges(edited, [cut]).source;
  assert.equal(canRestoreCutRange(edited, cuts[0]), undefined);
  const first = restoreCutRange(edited, cuts[0]);
  assert.equal(first.restored, true, first.reason);
  assert.deepEqual(JSON.parse(first.source).tracks[0].items.map(item =>
    [item.at, item.duration, item.source.in, item.source.out]), [
    [0, 183, 0, 6.1000000000000005],
    [183, 164, 6.5, 11.966666666666667],
    [347, 29, 15.033333333333333, 16],
  ]);
  edited = restoreCutRange(first.source, cuts[2]).source;
  edited = restoreCutRange(edited, cuts[1]).source;
  assert.deepEqual(JSON.parse(edited), JSON.parse(source));
});

test('実時刻の 3 か所を切り 2 か所目だけ戻せる', () => {
  const source = v2([media('cut-a', 0, 480, 0, 16)]);
  const cuts = [range([0.5, 0.9], 'filler', { captionId: 'main', label: 'えー' }),
    range([6.1, 6.5], 'unrecognized', { captionId: 'main', label: '??' }),
    range([11.966666666666667, 15.033333333333333], 'row', { captionId: 'main', label: '行' })];
  let edited = source;
  for (const cut of cuts) edited = applyCutRanges(edited, [cut]).source;
  assert.equal(canRestoreCutRange(edited, cuts[1]), undefined);
  const middle = restoreCutRange(edited, cuts[1]);
  assert.equal(middle.restored, true, middle.reason);
  assert.deepEqual(JSON.parse(middle.source).tracks[0].items.map(item =>
    [item.at, item.duration, item.source.in, item.source.out]), [
    [0, 15, 0, 0.5],
    [15, 332, 0.9, 11.966666666666667],
    [347, 29, 15.033333333333333, 16],
  ]);
  edited = restoreCutRange(middle.source, cuts[2]).source;
  edited = restoreCutRange(edited, cuts[0]).source;
  assert.deepEqual(JSON.parse(edited), JSON.parse(source));
});

test('3 か所の真ん中だけ戻しても他の切れ目と別トラックの item を維持する', () => {
  const source = v2([media('main-1', 0, 300, 0, 10)], [
    { id: 'v-other', lane: 'visual', items: [media('other-1', 50, 60, 20, 22, 'other')] },
    { id: 'v-anchored', lane: 'visual', items: [{ ...media('anchored', 75, 60, 20, 22, 'other'),
      anchor: { caption: 'c-0001' } }] },
  ]);
  const cuts = [range([1, 2], 'filler', { captionId: 'main', label: 'えー' }),
    range([4, 5], 'row', { captionId: 'main', label: '行 2' }),
    range([7, 8], 'row', { captionId: 'main', label: '行 3' })];
  let edited = source;
  for (const cut of cuts) edited = applyCutRanges(edited, [cut]).source;
  const middle = restoreCutRange(edited, cuts[1]);
  assert.equal(middle.restored, true, middle.reason);
  const parsed = JSON.parse(middle.source);
  assert.deepEqual(parsed.tracks[0].items.map(item =>
    [item.source.in, item.source.out, item.at, item.duration]),
  [[0, 1, 0, 30], [2, 7, 30, 150], [8, 10, 180, 60]]);
  assert.equal(parsed.tracks[1].items[0].at, 50);
  assert.equal(parsed.tracks[2].items[0].at, 75);
  edited = restoreCutRange(middle.source, cuts[2]).source;
  edited = restoreCutRange(edited, cuts[0]).source;
  assert.equal(edited, source);
});

test('切った順と違う順で 3 か所を戻しても元と一致する', () => {
  const source = v2();
  const cuts = [[1, 2], [4, 5], [7, 8]].map((inside, index) =>
    range(inside, 'row', { captionId: 'main', label: `行 ${index}` }));
  let edited = source;
  for (const cut of cuts) edited = applyCutRanges(edited, [cut]).source;
  for (const index of [0, 2, 1]) {
    const restored = restoreCutRange(edited, cuts[index]);
    assert.equal(restored.restored, true, restored.reason);
    edited = restored.source;
  }
  assert.equal(edited, source);
});

test('後ろから切った兄弟を任意の順に戻せる', () => {
  const source = v2([media('clip', 0, 600, 0, 20)]);
  const cuts = [[2, 2.5], [5, 5.5], [9, 9.5]].map((inside, index) =>
    range(inside, 'row', { captionId: 'main', label: `行 ${index}` }));
  let edited = source;
  for (const cut of [...cuts].reverse()) edited = applyCutRanges(edited, [cut]).source;
  for (const index of [1, 2, 0]) {
    assert.equal(canRestoreCutRange(edited, cuts[index]), undefined, `cut ${index}`);
    const restored = restoreCutRange(edited, cuts[index]);
    assert.equal(restored.restored, true, `cut ${index}: ${restored.reason}`);
    edited = restored.source;
  }
  assert.equal(edited, source);
});

test('まとめて 5 か所切ったとき任意の 1 か所だけ戻し、残りもすべて戻せる', () => {
  const source = v2([media('clip', 0, 600, 0, 20)]);
  const cuts = [[2, 2.5], [5, 5.5], [8, 8.5], [11, 11.5], [14, 14.5]].map((inside, index) =>
    range(inside, 'filler', { captionId: 'main', label: `w${index}` }));
  const cut = applyCutRanges(source, cuts).source;
  for (let first = 0; first < cuts.length; first++) {
    let edited = cut;
    for (const index of [first, ...cuts.map((_, index) => index).filter(index => index !== first)]) {
      assert.equal(canRestoreCutRange(edited, cuts[index]), undefined, `first ${first}, cut ${index}`);
      const restored = restoreCutRange(edited, cuts[index]);
      assert.equal(restored.restored, true, `first ${first}, cut ${index}: ${restored.reason}`);
      edited = restored.source;
    }
    assert.equal(edited, source, `first ${first}`);
  }
});

test('20 語中 5 語をランダム順に切って戻しても灰色 0 件で元とバイト一致する', () => {
  const source = v2([media('clip', 0, 600, 0, 20)]);
  const cuts = [2, 5, 8, 11, 14].map((start, index) =>
    range([start, start + 0.5], 'filler', { captionId: 'main', label: `w${index}` }));
  let seed = 20261006;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const shuffled = () => {
    const indices = cuts.map((_, index) => index);
    for (let index = indices.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [indices[index], indices[other]] = [indices[other], indices[index]];
    }
    return indices;
  };
  for (let trial = 0; trial < 50; trial++) {
    let edited = source;
    for (const index of shuffled()) edited = applyCutRanges(edited, [cuts[index]]).source;
    for (const index of shuffled()) {
      assert.equal(canRestoreCutRange(edited, cuts[index]), undefined, `trial ${trial}, cut ${index}`);
      const restored = restoreCutRange(edited, cuts[index]);
      assert.equal(restored.restored, true, `trial ${trial}, cut ${index}: ${restored.reason}`);
      edited = restored.source;
    }
    assert.equal(edited, source, `trial ${trial}`);
  }
});

test('無関係な別トラックへの item 追加後も切れ目だけを戻せる', () => {
  const source = v2();
  const cut = range([2, 4], 'row', { captionId: 'main', label: '行' });
  const edited = JSON.parse(applyCutRanges(source, [cut]).source);
  edited.tracks.push({ id: 'v-other', lane: 'visual', items: [media('new', 77, 60, 20, 22, 'other')] });
  const restored = restoreCutRange(text(edited), cut);
  assert.equal(restored.restored, true, restored.reason);
  assert.deepEqual(JSON.parse(restored.source).tracks[0].items.map(item => [item.source.in, item.source.out]), [[0, 10]]);
  assert.equal(JSON.parse(restored.source).tracks[1].items[0].at, 77);
});

const missingSettingsReason = '切った部分の元の設定が編集データに残っていないため 1 か所だけは戻せません。⌘Z の履歴から戻せます。';

test('隣の item の trim・位置・effect が変わったときは何も戻さない', () => {
  const cut = range([2, 4], 'row', { captionId: 'main', label: '行' });
  for (const [change, reason] of [
    [edit => { edit.tracks[0].items[0].source.out = 1.8; }, missingSettingsReason],
    [edit => { edit.tracks[0].items[1].at = 80; }, /編集がある/],
    [edit => { edit.tracks[0].items[0].adjust = { basic: { exposure: 0.2 } }; }, /動きや見た目/],
  ]) {
    const edited = JSON.parse(applyCutRanges(v2(), [cut]).source);
    change(edited);
    const source = text(edited);
    const restored = restoreCutRange(source, cut);
    assert.equal(restored.restored, false);
    assert.equal(restored.source, source);
    if (typeof reason === 'string') assert.equal(restored.reason, reason);
    else assert.match(restored.reason, reason);
    assert.equal(canRestoreCutRange(source, cut), restored.reason);
  }
});

test('item が丸ごと消えた行カットは見た目を推測せず理由を返す', () => {
  const source = v2([media('before', 0, 30, 0, 1), media('row', 30, 30, 1, 2),
    media('after', 60, 30, 2, 3)]);
  const cut = range([1, 2], 'row', { captionId: 'main' });
  const edited = applyCutRanges(source, [cut]).source;
  assert.deepEqual(JSON.parse(edited).tracks[0].items.map(item => item.id), ['before', 'after']);
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, edited);
  assert.equal(restored.reason, missingSettingsReason);
});

test('消えた item だけ scale 1.5・末尾 item・先頭 item の復元はすべて元の設定が不明と返す', () => {
  const cases = [
    { items: [media('a', 0, 30, 0, 1), { ...media('b', 30, 30, 1, 2), transform: { scale: 1.5 } },
      media('c', 60, 30, 2, 3)], inside: [1, 2] },
    { items: [media('a', 0, 30, 0, 1), { ...media('b', 30, 30, 1, 2), transform: { scale: 1.5 } }],
      inside: [1, 2] },
    { items: [{ ...media('a', 0, 30, 0, 1), transform: { scale: 1.5 } }, media('b', 30, 30, 1, 2)],
      inside: [0, 1] },
  ];
  for (const { items, inside } of cases) {
    const cut = range(inside, 'row', { captionId: 'main' });
    const edited = applyCutRanges(v2(items), [cut]).source;
    const restored = restoreCutRange(edited, cut);
    assert.equal(restored.restored, false);
    assert.equal(restored.source, edited);
    assert.equal(restored.reason, missingSettingsReason);
    assert.equal(canRestoreCutRange(edited, cut), missingSettingsReason);
  }
});

test('タイムライン分割したパンチイン item を丸ごと切っても両隣から見た目を推測しない', () => {
  const source = v2([
    media('clip', 0, 30, 0, 1),
    { ...media('clip-split', 30, 30, 1, 2), transform: { scale: 1.5 } },
    media('clip-split-2', 60, 30, 2, 3),
  ]);
  const cut = range([1, 2], 'row', { captionId: 'main', label: 'パンチインの行' });
  const edited = applyCutRanges(source, [cut]).source;
  assert.deepEqual(JSON.parse(edited).tracks[0].items.map(item => item.id), ['clip', 'clip-split-2']);
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, edited);
  assert.equal(restored.reason, missingSettingsReason);
  assert.equal(canRestoreCutRange(edited, cut), missingSettingsReason);
});

test('動くキーフレーム付き clip の複数カットは兄弟でも見た目の理由で戻さない', () => {
  const animated = { ...media('moving', 0, 300, 0, 10), keyframes: [
    { t: 0, transform: { scale: 1 } }, { t: 300, transform: { scale: 2 } },
  ] };
  const first = range([2, 3], 'row', { captionId: 'main', label: '行 1' });
  const second = range([6, 7], 'row', { captionId: 'main', label: '行 2' });
  const cut = applyCutRanges(v2([animated]), [first, second]).source;
  const restored = restoreCutRange(cut, second);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, cut);
  assert.match(restored.reason, /動きや見た目/);
  assert.equal(canRestoreCutRange(cut, second), restored.reason);
});

test('分割の家系が残るキーフレーム付き clip も見た目を推測して戻さない', () => {
  const animated = { ...media('moving', 0, 300, 0, 10), keyframes: [
    { t: 0, transform: { scale: 1 } }, { t: 300, transform: { scale: 2 } },
  ] };
  const cut = range([2, 3], 'row', { captionId: 'main', label: '行' });
  const edited = applyCutRanges(v2([animated]), [cut]).source;
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, edited);
  assert.match(restored.reason, /動きや見た目/);
  assert.equal(canRestoreCutRange(edited, cut), restored.reason);
});

test('家系の無い隣接 item の間で消えた行は推測して作らない', () => {
  const source = v2([
    { ...media('before', 0, 30, 0, 1), transform: { scale: 1 } },
    { ...media('row', 30, 30, 1, 2), transform: { scale: 1.5 } },
    { ...media('after', 60, 30, 2, 3), transform: { scale: 1.5 } },
  ]);
  const cut = range([1, 2], 'row', { captionId: 'main' });
  const edited = applyCutRanges(source, [cut]).source;
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, edited);
  assert.equal(restored.reason, missingSettingsReason);
});

test('戻せない理由は古い形式・見た目・後続編集を区別する', () => {
  assert.match(canRestoreCutRange(legacy(), range([2, 3])), /古い形式/);
  const cut = range([2, 4], 'row', { captionId: 'main', label: '行' });
  const edited = JSON.parse(applyCutRanges(v2(), [cut]).source);
  edited.tracks[0].items[1].at += 1;
  assert.match(canRestoreCutRange(text(edited), cut), /あとに編集/);
});

test('両隣の無い item 全体のカットは元設定不明の理由を返す', () => {
  const source = v2([media('only', 0, 30, 0, 1)]);
  const cut = range([0, 1], 'row', { captionId: 'main' });
  const edited = applyCutRanges(source, [cut]).source;
  assert.deepEqual(JSON.parse(edited).tracks[0].items, []);
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, edited);
  assert.equal(restored.reason, missingSettingsReason);
  assert.equal(canRestoreCutRange(edited, cut), missingSettingsReason);
});

test('同じ範囲を再度切っても既存 edit.json は変わらない', () => {
  const cut = range([2, 4], 'row', { captionId: 'main', label: '行' });
  const once = applyCutRanges(v2(), [cut]).source;
  const again = applyCutRanges(once, [cut]);
  assert.equal(again.removedFrames, 0);
  assert.equal(again.source, once);
  assert.equal(restoreCutRange(again.source, cut).restored, true);
});
