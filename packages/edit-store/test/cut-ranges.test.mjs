import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCutRanges,
  restoreCutRange,
  canRestoreCutRange,
  buildTimelineMap,
  detectEditVersion,
  projectLegacyEdit,
  projectLegacyAudioView,
  readInternalEdit,
  splitCutAudio,
  splitAtFrame,
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

function assertLinkedAudioVisibleSync(doc) {
  const fps = doc.output.fps;
  const visual = doc.tracks.filter(track => track.lane === 'visual').flatMap(track => track.items);
  for (const audio of doc.tracks.filter(track => track.lane === 'audio').flatMap(track => track.items)) {
    if (!audio.link) continue;
    const linked = visual.find(item => item.id === audio.link);
    assert.ok(linked, audio.id);
    const overlap = Math.max(audio.source.in, linked.source.in);
    if (overlap >= Math.min(audio.source.out, linked.source.out)) continue;
    const audioFrame = audio.at + Math.round((overlap - audio.source.in) * fps);
    const visualFrame = linked.at + Math.round((overlap - linked.source.in) * fps);
    assert.equal(audioFrame, visualFrame, audio.id);
  }
}

function assertNoAudioOverlap(doc) {
  for (const track of doc.tracks.filter(candidate => candidate.lane === 'audio')) {
    const items = [...track.items].sort((left, right) => left.at - right.at);
    for (let index = 1; index < items.length; index++) {
      assert.ok(items[index].at >= items[index - 1].at + items[index - 1].duration,
        `${items[index - 1].id} / ${items[index].id}`);
    }
  }
}

function separatedAdjacentPair({ tailAudio = false, otherSource = false } = {}) {
  const doc = JSON.parse(v2([
    media('c0', 0, 180, 0, 6),
    media('c1', 180, 180, otherSource ? 0 : 6, otherSource ? 6 : 12,
      otherSource ? 'other' : 'main'),
  ]));
  const first = splitCutAudio(doc, { cutId: 'c0', hasAudio: true }).document;
  const split = splitCutAudio(first, { cutId: 'c1', hasAudio: true }).document;
  const audio = split.tracks.find(track => track.lane === 'audio').items;
  if (tailAudio) {
    audio[0].duration = 210;
    audio[0].source.out = 7;
    audio[1].at = 210;
    audio[1].duration = 150;
    audio[1].source.in += 1;
  } else {
    audio[0].duration = 150;
    audio[0].source.out = 5;
    audio[1].at = 150;
    audio[1].duration = 210;
    audio[1].source.in = 5;
  }
  return text(split);
}

test('v2 cut range works with a captions-off media item on another track', () => {
  const source = v2([media('main-1', 0, 300, 0, 10)], [
    { id: 'other-track', lane: 'visual', items: [{ ...media('other-1', 0, 300, 0, 10, 'other'), captions: 'off' }] },
  ]);
  const result = applyCutRanges(source, [range([2, 3])], { fps: 30 });
  assert.equal(JSON.parse(result.source).tracks[1].items[0].captions, 'off');
});

test('detectEditVersion は v0 を返す', () => assert.equal(detectEditVersion(legacy(0)), 0));
test('detectEditVersion は v1 を返す', () => assert.equal(detectEditVersion(legacy(1)), 1));
test('detectEditVersion は v2 を返す', () => assert.equal(detectEditVersion(v2()), 2));
test('detectEditVersion は未知版を拒否する', () => assert.throws(() => detectEditVersion('{"version":3}'), /0・1・2/));

test('分割境界の前後 1 フレーム以内の語も正確な端を優先して戻す', () => {
  const original = text(splitAtFrame(JSON.parse(v2([media('clip', 0, 300, 0, 10)])), 150,
    { itemIds: ['clip'] }).edit);
  for (const [start, end] of [
    [4.5, 5 - 1 / 30], [4.5, 5 - 2 / 30], [5 + 1 / 30, 5.5], [4.5, 4.9],
  ]) {
    const cut = range([start, end], 'filler', { captionId: 'main', label: 'えー' });
    const edited = applyCutRanges(original, [cut]).source;
    const items = JSON.parse(edited).tracks[0].items;
    const kept = items.map(item => [item.source.in, item.source.out]).sort((a, b) => a[0] - b[0]);
    const gap = kept.slice(1).map((item, index) => [kept[index][1], item[0]])
      .find(([left, right]) => left < right);
    const restoreRange = { ...cut, in: gap[0], out: gap[1] };
    assert.equal(canRestoreCutRange(edited, restoreRange), undefined, `${start}–${end}`);
    assert.equal(restoreCutRange(edited, restoreRange).source, original, `${start}–${end}`);
  }
});

test('連動音声の尻から 1 フレーム外のカットは音声を変えずに戻す', () => {
  const doc = JSON.parse(v2([
    media('k0', 0, 72, 0, 3), media('k1', 72, 96, 3, 7),
  ], [{ id: 'a1', lane: 'audio', items: [
    { id: 'k0-audio', role: 'speech', link: 'k0', at: 0, duration: 72,
      source: { kind: 'media', src: 'main', in: 0, out: 3 } },
    { id: 'k1-audio', role: 'speech', link: 'k1', at: 72, duration: 83,
      source: { kind: 'media', src: 'main', in: 3, out: 6.458333333333333 } },
  ] }]));
  doc.output.fps = 24;
  const original = text(doc);
  const outside = range([6.5, 6.833333333333333], 'filler', { captionId: 'main', label: 'x' });
  const earlier = range([0.5, 1], 'row', { captionId: 'main', label: 'x' });
  for (const cuts of [[outside], [outside, earlier], [earlier, outside]]) {
    const edited = cuts.reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
    assert.equal(canRestoreCutRange(edited, outside), undefined, cuts.map(cut => cut.in).join(','));
    const restored = restoreCutRange(edited, outside);
    assert.equal(restored.restored, true);
    const expected = cuts.filter(cut => cut !== outside)
      .reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
    assert.equal(restored.source, expected);
    const audio = JSON.parse(restored.source).tracks.find(track => track.id === 'a1').items;
    assert.equal(audio.at(-1).source.out, 6.458333333333333);
  }
});

test('別区間でできた前方の空きを試し切りで詰め直さず通常のカットを戻す', () => {
  const doc = JSON.parse(v2([
    { ...media('k0', 0, 12, 0.895, 1.295), label: 'x' },
    { ...media('k0-split', 12, 165, 1.695, 7.195), label: 'x' },
    { id: 'sh0', at: 196, duration: 20, source: { kind: 'shape', shape: 'rect' } },
    { ...media('k1-split', 182, 138, 7.734666666666667, 12.334666666666667), label: 'x' },
    { ...media('k2', 320, 25, 13.632666666666667, 14.466), label: 'x' },
    { ...media('k2-split', 345, 138, 14.899333333333333, 19.499333333333333), label: 'x' },
  ], [{ id: 'a1', lane: 'audio', items: [
    { id: 'k0-audio-split', role: 'speech', link: 'k0-split', at: 12, duration: 165,
      source: { kind: 'media', src: 'main', in: 1.695, out: 7.195 } },
    { id: 'k1-audio-split', role: 'speech', link: 'k1-split', at: 182, duration: 138,
      source: { kind: 'media', src: 'main', in: 7.734666349425288, out: 12.334666666666667 } },
  ] }]));
  const cut = range([14.466, 14.899333333333333], 'row', { captionId: 'main', label: 'x' });
  const originalAudio = doc.tracks.find(track => track.id === 'a1').items;
  const restored = restoreCutRange(text(doc), cut);
  assert.equal(restored.restored, true);
  const after = JSON.parse(restored.source);
  assert.deepEqual(after.tracks.find(track => track.id === 'a1').items, originalAudio);
  assert.deepEqual(after.tracks[0].items.filter(item => item.id.startsWith('k2')).map(item =>
    [item.id, item.at, item.duration, item.source.in, item.source.out]),
  [['k2', 320, 176, 13.632666666666667, 19.499333333333333]]);
});

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

test('タイムライン分割済み clip のカットを戻しても label が残らない', () => {
  const source = v2([media('clip', 0, 150, 0, 5), media('clip-split', 150, 150, 5, 10)]);
  const cut = range([6, 7], 'filler', { captionId: 'main', reason: 'word', label: 'えー' });
  const result = restoreCutRange(applyCutRanges(source, [cut]).source, cut);
  assert.equal(result.restored, true, result.reason);
  assert.equal(result.source, source);
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

test('分離音声は映像と同じ素材区間を切り、3 か所の中央だけ戻せる', () => {
  const split = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
  split.tracks.push({ id: 'music', lane: 'audio', items: [
    { id: 'bgm', role: 'bgm', at: 0, duration: 300, source: { kind: 'media', src: 'other', in: 0, out: 10 } },
    { id: 'loose', role: 'speech', at: 30, duration: 90, source: { kind: 'media', src: 'main', in: 1, out: 4 } },
  ] });
  const original = text(split);
  const cuts = [range([1, 2], 'filler', { captionId: 'main', label: 'フィラー' }),
    range([4, 5], 'filler', { captionId: 'main', label: 'フィラー' }),
    range([7, 8], 'filler', { captionId: 'main', label: 'フィラー' })];
  const edited = JSON.parse(applyCutRanges(original, cuts).source);
  const visual = edited.tracks.find(track => track.lane === 'visual').items;
  const audio = edited.tracks.find(track => track.lane === 'audio' && track.id !== 'music').items;
  assert.deepEqual(visual.map(item => [item.at, item.duration, item.source.in, item.source.out]),
    [[0, 30, 0, 1], [30, 60, 2, 4], [90, 60, 5, 7], [150, 60, 8, 10]]);
  assert.deepEqual(audio.map(item => [item.at, item.duration, item.source.in, item.source.out]),
    visual.map(item => [item.at, item.duration, item.source.in, item.source.out]));
  assert.deepEqual(audio.map(item => item.link), visual.map(item => item.id));
  assert.deepEqual(edited.tracks.find(track => track.id === 'music'), split.tracks.find(track => track.id === 'music'));
  assert.equal(canRestoreCutRange(text(edited), cuts[1]), undefined);
  const restored = restoreCutRange(text(edited), cuts[1]);
  assert.equal(restored.restored, true, restored.reason);
  const middle = JSON.parse(restored.source);
  const middleVisual = middle.tracks.find(track => track.lane === 'visual').items;
  const middleAudio = middle.tracks.find(track => track.lane === 'audio' && track.id !== 'music').items;
  assert.deepEqual(middleVisual.map(item => [item.at, item.duration]),
    [[0, 30], [30, 150], [180, 60]]);
  assert.deepEqual(middleAudio.map(item => [item.at, item.duration]),
    middleVisual.map(item => [item.at, item.duration]));
  assert.deepEqual(middleAudio.map(item => item.link), middleVisual.map(item => item.id));
  assert.deepEqual(JSON.parse(original).tracks.find(track => track.lane === 'audio').items[0].source,
    { kind: 'media', src: 'main', in: 0, out: 10 });
  assert.deepEqual(JSON.parse(original).tracks.find(track => track.lane === 'visual').items.map(item => [item.at, item.duration]), [[0, 300]]);
  let whole = restored.source;
  for (const cut of [cuts[2], cuts[0]]) {
    const result = restoreCutRange(whole, cut);
    assert.equal(result.restored, true, result.reason);
    whole = result.source;
  }
  assert.equal(whole, original);
});

test('分離音声だけを後から編集すると 1 か所だけは戻せない', () => {
  const split = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
  const cut = range([2, 4], 'filler', { captionId: 'main', label: 'フィラー' });
  const edited = JSON.parse(applyCutRanges(text(split), [cut]).source);
  edited.tracks.find(track => track.lane === 'audio').items[1].gain_db = -5;
  const source = text(edited);
  assert.match(canRestoreCutRange(source, cut), /あとに編集/);
  const result = restoreCutRange(source, cut);
  assert.equal(result.restored, false);
  assert.equal(result.source, source);
});

test('分離音声を削除した後は基点どおり映像だけを戻せる', () => {
  const split = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
  const cut = range([2, 4], 'filler', { captionId: 'main', label: 'フィラー' });
  const edited = JSON.parse(applyCutRanges(text(split), [cut]).source);
  edited.tracks.find(track => track.lane === 'audio').items = [];
  const source = text(edited);
  assert.equal(canRestoreCutRange(source, cut), undefined);
  const restored = JSON.parse(restoreCutRange(source, cut).source);
  assert.deepEqual(restored.tracks.find(track => track.lane === 'visual').items,
    split.tracks.find(track => track.lane === 'visual').items);
  assert.deepEqual(restored.tracks.find(track => track.lane === 'audio').items, []);
});

test('分離音声の link を外した後も基点どおり映像を戻せる', () => {
  const split = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
  const cut = range([2, 4], 'filler', { captionId: 'main', label: 'フィラー' });
  const edited = JSON.parse(applyCutRanges(text(split), [cut]).source);
  for (const audio of edited.tracks.find(track => track.lane === 'audio').items) delete audio.link;
  assert.equal(canRestoreCutRange(text(edited), cut), undefined);
  const restored = JSON.parse(restoreCutRange(text(edited), cut).source);
  assert.deepEqual(restored.tracks.find(track => track.lane === 'visual').items,
    split.tracks.find(track => track.lane === 'visual').items);
  assert.ok(restored.tracks.find(track => track.lane === 'audio').items.every(item => !item.link));
});

test('書き出しの speech 射影もフィラーを除き映像 cut と素材区間・開始位置が一致する', () => {
  const split = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
  const edited = applyCutRanges(text(split), [range([3, 3.5], 'filler',
    { captionId: 'main', label: 'えー' })]).source;
  const internal = readInternalEdit(edited);
  const speech = projectLegacyAudioView(internal).speech;
  const cuts = projectLegacyEdit(internal).cuts;
  const intervals = rows => rows.map(row => [row.in, row.out, row.t ?? row.at]);
  assert.deepEqual(intervals(speech), [[0, 3, 0], [3.5, 10, 3]]);
  assert.deepEqual(intervals(cuts), intervals(speech));
  assert.equal(speech.length, 2);
  assert.equal(cuts.length, 2);
  assert.ok(speech.every(row => row.out <= 3 || row.in >= 3.5));
  const driftFrames = Math.max(...speech.map((row, index) =>
    Math.abs((row.t - cuts[index].at) * 30)));
  assert.equal(driftFrames, 0);
});

function assertLinkedAudioAtVisual(items) {
  const visual = new Map(items.tracks.filter(track => track.lane === 'visual')
    .flatMap(track => track.items.map(item => [item.id, item])));
  for (const track of items.tracks.filter(track => track.lane === 'audio')) {
    for (const audio of track.items.filter(item => item.link)) {
      const video = visual.get(audio.link);
      assert.ok(video, `${audio.id} の link 先が見つからない`);
      assert.equal(audio.at, video.at);
      assert.equal(audio.duration, video.duration);
    }
  }
}

test('前の未分離 clip を戻すと後ろの分離音声も同じ位置へ戻る', () => {
  const doc = JSON.parse(v2([media('front', 0, 300, 0, 10), media('tail', 300, 300, 0, 10, 'other')]));
  const original = text(splitCutAudio(doc, { cutId: 'tail', hasAudio: true }).document);
  const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(original, [cut]).source;
  assertLinkedAudioAtVisual(JSON.parse(edited));
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, true, restored.reason);
  assertLinkedAudioAtVisual(JSON.parse(restored.source));
  assert.equal(restored.source, original);
});

test('後ろだけ分離した clip の前を乱択で切って戻しても各段で音声はそろう', () => {
  const doc = JSON.parse(v2([media('front', 0, 600, 0, 20), media('tail', 600, 150, 0, 5, 'other')]));
  const original = text(splitCutAudio(doc, { cutId: 'tail', hasAudio: true }).document);
  let seed = 20261007;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const shuffled = values => {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  };
  for (let trial = 0; trial < 40; trial++) {
    const cuts = shuffled([2, 5, 8, 11, 14, 17]).slice(0, 4)
      .map((start, index) => range([start, start + 0.5], 'filler',
        { captionId: 'main', label: `フィラー${index}` }));
    let source = original;
    for (const cut of shuffled(cuts)) {
      source = applyCutRanges(source, [cut]).source;
      assertLinkedAudioAtVisual(JSON.parse(source));
    }
    for (const cut of shuffled(cuts)) {
      assert.equal(canRestoreCutRange(source, cut), undefined, `trial ${trial}`);
      const restored = restoreCutRange(source, cut);
      assert.equal(restored.restored, true, `trial ${trial}: ${restored.reason}`);
      source = restored.source;
      assertLinkedAudioAtVisual(JSON.parse(source));
    }
    assert.equal(source, original, `trial ${trial}`);
  }
});

test('分離後の冒頭 0.3–0.8 秒を切っても canRestore は例外なしで戻せる', () => {
  const original = text(splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document);
  const cut = range([0.3, 0.8], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(original, [cut]).source;
  assert.equal(canRestoreCutRange(edited, cut), undefined);
  const restored = restoreCutRange(edited, cut);
  assert.equal(restored.restored, true, restored.reason);
  assert.equal(restored.source, original);
});

test('片側だけ後ろを短くした音声・映像と音声の頭トリムは境界で link を付け替え戻せる', () => {
  for (const side of ['audio-tail', 'visual-tail', 'audio-head']) {
    const doc = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
    const visual = doc.tracks.find(track => track.lane === 'visual').items[0];
    const audio = doc.tracks.find(track => track.lane === 'audio').items[0];
    if (side === 'audio-tail') { audio.duration = 240; audio.source.out = 8; }
    if (side === 'visual-tail') { visual.duration = 240; visual.source.out = 8; }
    if (side === 'audio-head') { audio.at = 30; audio.duration = 270; audio.source.in = 1; }
    const original = text(doc);
    const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
    const edited = applyCutRanges(original, [cut]).source;
    const after = JSON.parse(edited);
    const videoPieces = after.tracks.find(track => track.lane === 'visual').items;
    const audioPieces = after.tracks.find(track => track.lane === 'audio').items;
    assert.deepEqual(audioPieces.map(item => item.link), videoPieces.map(item => item.id), side);
    for (const item of audioPieces) {
      const video = videoPieces.find(candidate => candidate.id === item.link);
      const expectedAt = video.at + Math.round((item.source.in - video.source.in) * 30);
      assert.equal(item.at, expectedAt, side);
    }
    assert.equal(canRestoreCutRange(edited, cut), undefined, side);
    const restored = restoreCutRange(edited, cut);
    assert.equal(restored.restored, true, `${side}: ${restored.reason}`);
    assert.equal(restored.source, original, side);
  }
});

test('映像の頭だけを 1 秒トリムした先頭の J カットは音声位置を負にしない', () => {
  const doc = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
  const visual = doc.tracks.find(track => track.lane === 'visual').items[0];
  visual.at = 30;
  visual.duration = 270;
  visual.source.in = 1;
  const original = text(doc);
  const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(original, [cut]).source;
  assert.ok(JSON.parse(edited).tracks.find(track => track.lane === 'audio')
    .items.every(item => item.at >= 0));
  assert.equal(canRestoreCutRange(edited, cut), undefined);
  assert.equal(restoreCutRange(edited, cut).source, original);
});

test('分離音声に gain キーフレームがあると見た目の理由で 1 か所復元を止める', () => {
  const doc = JSON.parse(v2());
  doc.tracks[0].items[0].keyframes = [{ t: 0, gain_db: 0 }, { t: 300, gain_db: -6 }];
  const split = splitCutAudio(doc, { cutId: 'main-1', hasAudio: true }).document;
  const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(text(split), [cut]).source;
  assert.match(canRestoreCutRange(edited, cut), /動きや見た目の設定/);
});

test('60 fps の小数秒カットを順不同で戻しても素材の末尾時刻はバイト一致する', () => {
  const doc = { version: 2, output: { width: 320, height: 180, fps: 60 },
    sources: [{ id: 'main', path: 'main.mp4' }, { id: 'other', path: 'other.mp4' }],
    tracks: [{ id: 'v', lane: 'visual', items: [
      media('clip', 0, 1200, 0, 20), media('tail', 1200, 300, 0, 5, 'other')
    ] }] };
  const original = text(splitCutAudio(doc, { cutId: 'clip', hasAudio: true }).document);
  const spans = [[4.019, 4.997], [5.981, 7.206], [9.117, 9.955],
    [10.886, 11.873], [17.862, 18.759]];
  const cuts = spans.map(([start, end], index) => range([start, end], 'filler',
    { captionId: 'main', label: `語${index}` }));
  let source = original;
  for (const index of [4, 1, 3, 0, 2]) source = applyCutRanges(source, [cuts[index]]).source;
  for (const index of [2, 0, 4, 1, 3]) {
    const pieces = JSON.parse(source).tracks.find(track => track.lane === 'visual').items
      .filter(item => item.source.src === 'main');
    const pairs = pieces.slice(0, -1).map((left, offset) => ({ left, right: pieces[offset + 1] }));
    const { left, right } = pairs.reduce((best, pair) =>
      Math.abs(pair.left.source.out - cuts[index].in) + Math.abs(pair.right.source.in - cuts[index].out)
        < Math.abs(best.left.source.out - cuts[index].in) + Math.abs(best.right.source.in - cuts[index].out)
        ? pair : best);
    const restoreRange = { ...cuts[index], in: left.source.out, out: right.source.in };
    assert.equal(canRestoreCutRange(source, restoreRange), undefined);
    const result = restoreCutRange(source, restoreRange);
    assert.equal(result.restored, true, result.reason);
    source = result.source;
  }
  assert.equal(source, original);
});

function fractionalSeparated(fps, out, trim) {
  const doc = { version: 2, output: { width: 320, height: 180, fps },
    sources: [{ id: 'main', path: 'main.mp4' }], tracks: [{ id: 'v', lane: 'visual', items: [
      media('clip', 0, Math.round(out * fps), 0, out),
    ] }] };
  const split = splitCutAudio(doc, { cutId: 'clip', hasAudio: true }).document;
  const visual = split.tracks.find(track => track.lane === 'visual').items[0];
  const audio = split.tracks.find(track => track.lane === 'audio').items[0];
  const target = trim.startsWith('v') ? visual : audio;
  const frames = Math.round(fps / 2);
  if (trim.endsWith('Head')) {
    target.at += frames;
    target.duration -= frames;
    target.source.in += frames / fps;
  } else {
    target.duration -= frames;
    target.source.out -= frames / fps;
  }
  return text(split);
}

test('割り切れない素材秒の片側トリムでも右の分離音声は右映像へ付いて戻せる', () => {
  for (const [fps, out] of [[30, 12.3456], [60, 8.2083]]) {
    for (const trim of ['vHead', 'vTail', 'aHead', 'aTail']) {
      const original = fractionalSeparated(fps, out, trim);
      const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
      const edited = applyCutRanges(original, [cut]).source;
      const doc = JSON.parse(edited);
      const video = doc.tracks.find(track => track.lane === 'visual').items;
      const audio = doc.tracks.find(track => track.lane === 'audio').items;
      assert.equal(audio[1].link, video[1].id, `${fps} ${trim}`);
      assert.equal(audio[1].at, video[1].at, `${fps} ${trim}`);
      assert.equal(canRestoreCutRange(edited, cut), undefined, `${fps} ${trim}`);
      const restored = restoreCutRange(edited, cut);
      assert.equal(restored.restored, true, `${fps} ${trim}: ${restored.reason}`);
      assert.equal(restored.source, original, `${fps} ${trim}`);
    }
  }
});

test('音声の頭より前だけを切る場合は音声を切らず右映像へ追従させる', () => {
  const doc = splitCutAudio(JSON.parse(v2([media('clip', 0, 300, 0, 10)])),
    { cutId: 'clip', hasAudio: true }).document;
  const audio = doc.tracks.find(track => track.lane === 'audio').items[0];
  audio.at = 30;
  audio.duration = 270;
  audio.source.in = 1;
  const original = text(doc);
  const cut = range([0.3, 0.8], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(original, [cut]).source;
  const after = JSON.parse(edited);
  const right = after.tracks.find(track => track.lane === 'visual').items[1];
  const linked = after.tracks.find(track => track.lane === 'audio').items[0];
  assert.equal(linked.link, right.id);
  assert.equal(linked.at, right.at + Math.round((linked.source.in - right.source.in) * 30));
  assert.equal(linked.duration, 270);
  assert.equal(canRestoreCutRange(edited, cut), undefined);
  assert.equal(restoreCutRange(edited, cut).source, original);
});

test('音声の頭または尻に重なるカットは同期を保ち元の設定がない理由で戻さない', () => {
  for (const [trim, span] of [
    ['head', [0.5, 1.2]], ['tail', [7.8, 8.4]],
  ]) {
    const doc = splitCutAudio(JSON.parse(v2([media('clip', 0, 300, 0, 10)])),
      { cutId: 'clip', hasAudio: true }).document;
    const audio = doc.tracks.find(track => track.lane === 'audio').items[0];
    if (trim === 'head') { audio.at = 30; audio.duration = 270; audio.source.in = 1; }
    else { audio.duration = 240; audio.source.out = 8; }
    const provenance = { provider: 'voicevox', credit: 'VOICEVOX' };
    audio.provenance = provenance;
    const original = text(doc);
    const cut = range(span, 'filler', { captionId: 'main', label: 'えー' });
    const edited = applyCutRanges(original, [cut]).source;
    const after = JSON.parse(edited);
    const piece = after.tracks.find(track => track.lane === 'audio').items[0];
    const visual = after.tracks.find(track => track.lane === 'visual').items;
    const linkedVisual = visual.find(item => item.id === piece.link);
    assert.deepEqual(piece.provenance, provenance, trim);
    assert.ok(piece.source.out <= span[0] || piece.source.in >= span[1], trim);
    assert.ok(linkedVisual, trim);
    assert.equal(piece.at,
      linkedVisual.at + Math.round((piece.source.in - linkedVisual.source.in) * 30), trim);
    assert.equal(canRestoreCutRange(edited, cut), missingSettingsReason, trim);
    const restored = restoreCutRange(edited, cut);
    assert.equal(restored.restored, false, trim);
    assert.equal(restored.reason, missingSettingsReason, trim);
    assert.equal(restored.source, edited, trim);
  }
});

test('分離音声のフェードは両端に残り、戻すと元の値へ結合する', () => {
  for (const fades of [{ fade_in: 0.3 }, { fade_out: 0.5 },
    { fade_in: 0.3, fade_out: 0.5, fade_in_shape: 'linear', fade_out_shape: 'equal_power' }]) {
    const doc = splitCutAudio(JSON.parse(v2()), { cutId: 'main-1', hasAudio: true }).document;
    Object.assign(doc.tracks.find(track => track.lane === 'audio').items[0], fades);
    const original = text(doc);
    const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
    const edited = applyCutRanges(original, [cut]).source;
    const pieces = JSON.parse(edited).tracks.find(track => track.lane === 'audio').items;
    assert.equal(pieces[0].fade_out, undefined);
    assert.equal(pieces[1].fade_in, undefined);
    assert.equal(pieces[0].fade_in, fades.fade_in);
    assert.equal(pieces[1].fade_out, fades.fade_out);
    assert.equal(canRestoreCutRange(edited, cut), undefined);
    assert.equal(restoreCutRange(edited, cut).source, original);
  }
});

test('固定シードの小数秒素材と片側トリムは切断後に同期し元へ戻る', () => {
  let seed = 20261008;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const trims = ['vHead', 'vTail', 'aHead', 'aTail'];
  for (let trial = 0; trial < 48; trial++) {
    const fps = [24, 30, 60][Math.floor(random() * 3)];
    const out = +(8 + random() * 7).toFixed(4);
    const trim = trims[Math.floor(random() * trims.length)];
    const original = fractionalSeparated(fps, out, trim);
    const start = +(2 + random() * 2).toFixed(3);
    const cut = range([start, +(start + 0.5).toFixed(3)], 'filler',
      { captionId: 'main', label: 'えー' });
    const edited = applyCutRanges(original, [cut]).source;
    const doc = JSON.parse(edited);
    const video = doc.tracks.find(track => track.lane === 'visual').items;
    const audio = doc.tracks.find(track => track.lane === 'audio').items;
    assert.equal(audio[1].link, video[1].id, `trial ${trial}`);
    assert.equal(audio[1].at, video[1].at, `trial ${trial}`);
    assert.equal(canRestoreCutRange(edited, cut), undefined, `trial ${trial}`);
    assert.equal(restoreCutRange(edited, cut).source, original, `trial ${trial}`);
  }
});

test('後ノリの音声がある映像間の空きは音声のはみ出し分だけ残して戻せる', () => {
  const doc = { version: 2, output: { width: 320, height: 180, fps: 24 },
    sources: [{ id: 'main', path: 'main.mp4' }, { id: 'other', path: 'other.mp4' }],
    tracks: [{ id: 'v', lane: 'visual', items: [
      media('front', 0, 181, 0.2573, 7.7869),
      media('tail', 181, 185, 1.9011, 9.6117, 'other'),
    ] }] };
  const first = splitCutAudio(doc, { cutId: 'front', hasAudio: true }).document;
  const split = splitCutAudio(first, { cutId: 'tail', hasAudio: true }).document;
  const front = split.tracks.find(track => track.lane === 'visual').items[0];
  front.duration -= 15;
  front.source.out -= 15 / 24;
  const cut = range([6.259, 6.847], 'filler', { captionId: 'main', label: 'えー' });
  const original = text(split);
  const edited = applyCutRanges(original, [cut]).source;
  const after = JSON.parse(edited);
  const video = after.tracks.find(track => track.lane === 'visual').items;
  const audio = after.tracks.find(track => track.lane === 'audio').items;
  assert.equal(video.at(-1).at - video.at(-2).at - video.at(-2).duration, 15);
  for (const item of audio) {
    const linked = video.find(candidate => candidate.id === item.link);
    assert.equal(item.at, linked.at + Math.round((item.source.in - linked.source.in) * 24));
  }
  for (let index = 1; index < audio.length; index++) {
    assert.ok(audio[index].at >= audio[index - 1].at + audio[index - 1].duration);
  }
  assert.equal(canRestoreCutRange(edited, cut), undefined);
  assert.equal(restoreCutRange(edited, cut).source, original);

  const unlinked = structuredClone(doc);
  const unlinkedFront = unlinked.tracks[0].items[0];
  unlinkedFront.duration -= 15;
  unlinkedFront.source.out -= 15 / 24;
  const unlinkedVideo = JSON.parse(applyCutRanges(text(unlinked), [cut]).source).tracks[0].items;
  assert.equal(unlinkedVideo.at(-1).at - unlinkedVideo.at(-2).at - unlinkedVideo.at(-2).duration, 0);
});

test('前ノリの音声がある映像間の空きは重なりを防ぐ分だけ残して戻せる', () => {
  const source = v2([media('c1', 0, 300, 0, 10), media('c2', 300, 300, 0, 10, 'other')]);
  const first = splitCutAudio(JSON.parse(source), { cutId: 'c1', hasAudio: true }).document;
  const split = splitCutAudio(first, { cutId: 'c2', hasAudio: true }).document;
  const visual = split.tracks.find(track => track.lane === 'visual').items;
  visual[1].at = 315;
  visual[1].duration = 285;
  visual[1].source.in = 0.5;
  const original = text(split);
  const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(original, [cut]).source;
  const after = JSON.parse(edited);
  const video = after.tracks.find(track => track.lane === 'visual').items;
  const audio = after.tracks.find(track => track.lane === 'audio').items;
  assert.equal(video.at(-1).at - video.at(-2).at - video.at(-2).duration, 15);
  assert.equal(audio.at(-1).at, video.at(-1).at - 15);
  for (let index = 1; index < audio.length; index++) {
    assert.ok(audio[index].at >= audio[index - 1].at + audio[index - 1].duration);
  }
  for (const item of audio) {
    const linked = video.find(candidate => candidate.id === item.link);
    assert.equal(item.at, linked.at + Math.round((item.source.in - linked.source.in) * 30));
  }
  assert.equal(canRestoreCutRange(edited, cut), undefined);
  assert.equal(restoreCutRange(edited, cut).source, original);

  const unlinked = JSON.parse(source);
  unlinked.tracks[0].items[1].at = 315;
  unlinked.tracks[0].items[1].duration = 285;
  unlinked.tracks[0].items[1].source.in = 0.5;
  const unlinkedCut = JSON.parse(applyCutRanges(text(unlinked), [cut]).source);
  const unlinkedVideo = unlinkedCut.tracks[0].items;
  assert.equal(unlinkedVideo.at(-1).at - unlinkedVideo.at(-2).at - unlinkedVideo.at(-2).duration, 0);
});

test('J カットの頭の語を消しても映像の穴を作らず前ノリ音声を動かさない', () => {
  let doc = JSON.parse(v2([media('c0', 0, 180, 0, 6, 'other'), media('c1', 180, 300, 0, 10)]));
  doc = splitCutAudio(doc, { cutId: 'c1', hasAudio: true }).document;
  const video = doc.tracks.find(track => track.lane === 'visual').items;
  video[0].duration = 210; video[0].source.out = 7;
  video[1].at = 210; video[1].duration = 270; video[1].source.in = 1;
  doc.tracks.find(track => track.lane === 'audio').items[0].at = 180;
  const cut = range([1, 1.4], 'filler', { captionId: 'main', label: 'えー' });
  const after = JSON.parse(applyCutRanges(text(doc), [cut]).source);
  const visual = after.tracks.find(track => track.lane === 'visual').items;
  const audio = after.tracks.find(track => track.lane === 'audio').items;
  assert.equal(visual[1].at, visual[0].at + visual[0].duration);
  assert.equal(audio[0].at, 180);
  assert.equal(audio[0].at + audio[0].duration, visual[1].at);
  assert.equal(audio[1].at, visual[1].at);
  assertLinkedAudioVisibleSync(after);
});

test('L カットの尻の語を消しても映像の穴と後続音声のずれを作らない', () => {
  let doc = JSON.parse(v2([media('c0', 0, 180, 0, 6, 'other'), media('c1', 180, 300, 0, 10)]));
  doc = splitCutAudio(doc, { cutId: 'c0', hasAudio: true }).document;
  doc = splitCutAudio(doc, { cutId: 'c1', hasAudio: true }).document;
  const visual = doc.tracks.find(track => track.lane === 'visual').items;
  visual[0].duration = 210; visual[0].source.out = 7;
  visual[1].at = 210; visual[1].duration = 270; visual[1].source.in = 1;
  const firstAudio = doc.tracks.find(track => track.lane === 'audio');
  const secondAudio = firstAudio.items.splice(firstAudio.items.findIndex(item => item.link === 'c1'), 1)[0];
  doc.tracks.push({ id: 'a2', lane: 'audio', items: [secondAudio] });
  const cut = range([6.6, 7], 'filler', { captionId: 'other', label: 'えー' });
  const after = JSON.parse(applyCutRanges(text(doc), [cut]).source);
  const video = after.tracks.find(track => track.lane === 'visual').items;
  const audio = after.tracks.find(track => track.id === 'a2').items[0];
  assert.equal(video[1].at, video[0].at + video[0].duration);
  assert.equal(audio.at, video[1].at - 30);
  assertLinkedAudioVisibleSync(after);
});

test('L カットのトリム端をまたぐ語でも新しい映像の空きを残さない', () => {
  const doc = JSON.parse(v2([media('c1', 0, 300, 0, 10), media('c2', 300, 150, 0, 5, 'other')]));
  const split = splitCutAudio(doc, { cutId: 'c1', hasAudio: true }).document;
  const visual = split.tracks.find(track => track.lane === 'visual').items;
  visual[0].duration = 270; visual[0].source.out = 9;
  visual[1].at = 270;
  const cut = range([8.7, 9.4], 'filler', { captionId: 'main', label: 'えー' });
  const after = JSON.parse(applyCutRanges(text(split), [cut]).source);
  const video = after.tracks.find(track => track.lane === 'visual').items;
  assert.equal(video[1].at, video[0].at + video[0].duration);
  assert.equal(after.tracks.find(track => track.lane === 'audio').items[0].at, video[0].at);
  assertLinkedAudioVisibleSync(after);
});

test('J カットの前ノリにまたがる語は音声の全区間を切り、重なりも映像の穴も作らない', () => {
  for (const span of [[7.2, 7.9], [7.4, 7.6]]) {
    const doc = JSON.parse(v2([media('c0', 0, 225, 0, 7.5), media('c1', 195, 285, 6.5, 16)]));
    const split = splitCutAudio(doc, { cutId: 'c1', hasAudio: true }).document;
    const second = split.tracks.find(track => track.lane === 'visual').items[1];
    second.at = 225; second.duration = 255; second.source.in = 7.5;
    const original = text(split);
    const cut = range(span, 'filler', { captionId: 'main', label: '語' });
    const edited = applyCutRanges(original, [cut]).source;
    const after = JSON.parse(edited);
    const visual = after.tracks.find(track => track.lane === 'visual').items;
    const audio = after.tracks.find(track => track.lane === 'audio').items;
    assert.equal(audio.length, 2);
    assert.equal(visual[1].at, visual[0].at + visual[0].duration);
    assert.equal(audio[1].at, audio[0].at + audio[0].duration);
    assert.equal(audio[0].at, 195);
    assert.equal(audio[0].source.out, span[0]);
    assert.equal(audio[1].source.in, span[1]);
    assert.equal(audio[1].link, visual[1].id);
    assert.equal(audio[1].at, visual[1].at);
    const restored = restoreCutRange(edited, cut);
    assert.ok(restored.source === original || (!restored.restored && restored.reason));
  }
});

test('L カットの後ノリにまたがる語は音声の全区間を切り右片を左片に詰める', () => {
  const doc = JSON.parse(v2([media('c1', 0, 300, 0, 10), media('c2', 300, 150, 0, 5, 'other')]));
  const split = splitCutAudio(doc, { cutId: 'c1', hasAudio: true }).document;
  const visual = split.tracks.find(track => track.lane === 'visual').items;
  visual[0].duration = 270; visual[0].source.out = 9;
  visual[1].at = 270;
  const original = text(split);
  const cut = range([8.7, 9.4], 'filler', { captionId: 'main', label: '語' });
  const edited = applyCutRanges(original, [cut]).source;
  const after = JSON.parse(edited);
  const video = after.tracks.find(track => track.lane === 'visual').items;
  const audio = after.tracks.find(track => track.lane === 'audio').items;
  assert.equal(video[1].at, video[0].at + video[0].duration);
  assert.equal(audio[1].at, audio[0].at + audio[0].duration);
  assert.equal(audio[0].source.out, 8.7);
  assert.equal(audio[1].source.in, 9.4);
  assert.equal(audio[1].link, video[0].id);
  assert.equal(audio[0].at, video[0].at);
  const restored = restoreCutRange(edited, cut);
  assert.ok(restored.source === original || (!restored.restored && restored.reason));
});

test('映像と音声の分割フレームが 1 つ違っても映像の切れ目から復元できる', () => {
  const doc = { version: 2, output: { width: 320, height: 180, fps: 60 },
    sources: [{ id: 'main', path: 'main.mp4' }], tracks: [{ id: 'v', lane: 'visual', items: [
      media('clip', 0, 529, 1.3364, 10.1582),
    ] }] };
  const split = splitCutAudio(doc, { cutId: 'clip', hasAudio: true }).document;
  const video = split.tracks.find(track => track.lane === 'visual').items[0];
  video.at = 21;
  video.duration = 508;
  video.source.in = 1.6864;
  const original = text(split);
  const cut = range([4.017, 4.213], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(original, [cut]).source;
  const pieces = JSON.parse(edited).tracks.find(track => track.lane === 'visual').items;
  const projected = { ...cut, in: pieces[0].source.out, out: pieces[1].source.in };
  assert.equal(canRestoreCutRange(edited, projected), undefined);
  assert.equal(restoreCutRange(edited, projected).source, original);
});

test('速度変更した映像では投影だけが近い別の切れ目を復元候補にしない', () => {
  const doc = JSON.parse(v2([{
    ...media('clip', 0, 436, 0, 16), source: { kind: 'media', src: 'main', in: 0, out: 16, speed: 1.1 },
  }]));
  const cut = range([4.342, 4.671], 'filler', { captionId: 'main', label: 'えー' });
  const edited = applyCutRanges(text(doc), [cut]).source;
  const pieces = JSON.parse(edited).tracks.find(track => track.lane === 'visual').items;
  const nearbyProjection = { ...cut, in: pieces[0].source.out,
    out: pieces[1].source.in + 0.0036 };
  assert.ok(canRestoreCutRange(edited, nearbyProjection));
});

test('分離音声の右片を後から 1 フレーム動かした場合は復元しない', () => {
  const original = fractionalSeparated(30, 12.3456, 'vHead');
  const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
  const edited = JSON.parse(applyCutRanges(original, [cut]).source);
  edited.tracks.find(track => track.lane === 'audio').items[1].at += 1;
  assert.ok(canRestoreCutRange(text(edited), cut));
});

test('音声の右片を at・duration・source.in とも 1 フレーム手直しすると灰色になる', () => {
  const original = v2([media('clip', 0, 300, 0, 10)]);
  const split = splitCutAudio(JSON.parse(original), { cutId: 'clip', hasAudio: true }).document;
  const cut = range([3, 3.5], 'filler', { captionId: 'main', label: 'えー' });
  const edited = JSON.parse(applyCutRanges(text(split), [cut]).source);
  const right = edited.tracks.find(track => track.lane === 'audio').items[1];
  right.at += 1;
  right.duration -= 1;
  right.source.in += 1 / 30;
  assert.match(canRestoreCutRange(text(edited), cut), /あとに編集/);
});

test('一括カットでも J カットの前ノリ片は左側のほかのカットによるリップルに追従する', () => {
  const doc = JSON.parse(v2([
    media('c0', 0, 900, 0, 30), media('c1', 900, 300, 30, 40),
  ]));
  const first = splitCutAudio(doc, { cutId: 'c0', hasAudio: true }).document;
  const split = splitCutAudio(first, { cutId: 'c1', hasAudio: true }).document;
  const audio = split.tracks.find(track => track.lane === 'audio').items;
  audio[0].duration = 870; audio[0].source.out = 29;
  audio[1].at = 870; audio[1].duration = 330; audio[1].source.in = 29;
  const original = text(split);
  for (const count of [1, 5, 10]) {
    const cuts = [range([29.8, 30.4], 'filler', { captionId: 'main' })];
    for (let index = 0; index < count; index++) {
      cuts.push(range([2 + index * 2.5, 2.4 + index * 2.5], 'filler', { captionId: 'main' }));
    }
    const after = JSON.parse(applyCutRanges(original, cuts).source);
    const visuals = after.tracks.find(track => track.lane === 'visual').items;
    const pieces = after.tracks.find(track => track.lane === 'audio').items;
    const pre = pieces.find(item => item.source.in === 29);
    const post = pieces.find(item => Math.abs(item.source.in - 30.4) < 0.01);
    const leftVisual = visuals.find(item => item.source.in <= 29 && item.source.out > 29);
    assert.equal(pre.at, leftVisual.at + Math.round((29 - leftVisual.source.in) * 30), `count ${count}`);
    assert.equal(pre.at + pre.duration, post.at, `count ${count}`);
    assertNoAudioOverlap(after);
    assertLinkedAudioVisibleSync(after);
  }
});

test('空きの詰めによるリップルでも前ノリ片が移動し、右片と重ならない', () => {
  const doc = JSON.parse(v2([
    media('c0', 0, 90, 0, 3, 'other'),
    media('c1', 120, 180, 0, 6),
    media('c2', 300, 180, 6, 12),
  ]));
  let split = doc;
  for (const cutId of ['c0', 'c1', 'c2']) {
    split = splitCutAudio(split, { cutId, hasAudio: true }).document;
  }
  const audio = split.tracks.find(track => track.lane === 'audio').items;
  const c1 = audio.find(item => item.link === 'c1');
  const c2 = audio.find(item => item.link === 'c2');
  c1.duration = 150; c1.source.out = 5;
  c2.at = 270; c2.duration = 210; c2.source.in = 5;
  const cut = range([5.8, 6.4], 'filler', { captionId: 'main' });
  const after = JSON.parse(applyCutRanges(text(split), [cut]).source);
  const pieces = after.tracks.find(track => track.lane === 'audio').items;
  const pre = pieces.find(item => item.source.src === 'main' && item.source.in === 5);
  const post = pieces.find(item => item.source.src === 'main' && item.source.in === 6.4);
  assert.equal(pre.at, 240);
  assert.equal(pre.at + pre.duration, post.at);
  assertNoAudioOverlap(after);
  assertLinkedAudioVisibleSync(after);
});

test('J カットの複数区間は一括と逐次で同じ結果になる', () => {
  const original = separatedAdjacentPair();
  const cuts = [range([1, 1.5], 'filler', { captionId: 'main' }),
    range([5.8, 6.4], 'filler', { captionId: 'main' })];
  const batch = applyCutRanges(original, cuts).source;
  const sequential = cuts.reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
  assert.equal(batch, sequential);
  assertNoAudioOverlap(JSON.parse(batch));
  assertLinkedAudioVisibleSync(JSON.parse(batch));
});

test('L カットの複数区間は一括と逐次で音声の位置と素材区間が一致する', () => {
  for (const otherSource of [false, true]) {
    const original = separatedAdjacentPair({ tailAudio: true, otherSource });
    const cuts = [range([1, 1.5], 'filler', { captionId: 'main' }),
      range([5.8, 6.4], 'filler', { captionId: 'main' })];
    const batch = JSON.parse(applyCutRanges(original, cuts).source);
    const sequential = JSON.parse(cuts.reduce((source, cut) => applyCutRanges(source, [cut]).source, original));
    assert.deepEqual(batch, sequential);
    const signature = doc => doc.tracks.map(track => track.items.map(item => [
      item.at, item.duration, item.source.src, item.source.in, item.source.out,
    ]));
    assert.deepEqual(signature(batch), signature(sequential));
    assertNoAudioOverlap(batch);
    assertLinkedAudioVisibleSync(batch);
  }
});

test('固定シードで前ノリと複数カットを一括適用しても音声は同期する', () => {
  const original = separatedAdjacentPair();
  let seed = 20261009;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 24; trial++) {
    const cuts = [range([5.8, 6.4], 'filler', { captionId: 'main' })];
    for (let index = 0; index < 4; index++) {
      if (random() < 0.5) continue;
      const start = index + 0.1 + Math.floor(random() * 4) / 10;
      cuts.push(range([start, start + 0.2], 'filler', { captionId: 'main' }));
    }
    const edited = applyCutRanges(original, cuts).source;
    const sequential = cuts.reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
    assert.equal(edited, sequential, `trial ${trial}`);
    const after = JSON.parse(edited);
    assertNoAudioOverlap(after);
    assertLinkedAudioVisibleSync(after);
  }
});

test('映像の尻を別の区間で削っても前ノリ片の一括位置は両順序の逐次と一致する', () => {
  const doc = { version: 2, output: { width: 320, height: 180, fps: 60 },
    sources: [{ id: 'main', path: 'main.mp4' }], tracks: [{ id: 'v', lane: 'visual', items: [
      media('c0', 0, 448, 1.455, 8.922), media('c1', 448, 251, 10.501, 14.684),
    ] }] };
  const first = splitCutAudio(doc, { cutId: 'c0', hasAudio: true }).document;
  const split = splitCutAudio(first, { cutId: 'c1', hasAudio: true }).document;
  const audio = split.tracks.find(track => track.lane === 'audio').items;
  audio[0].duration = 424; audio[0].source.out = 8.522;
  audio[1].at = 424; audio[1].duration = 275; audio[1].source.in = 10.101;
  const original = text(split);
  const cuts = [range([8.391, 9.036], 'filler', { captionId: 'main' }),
    range([10.332, 10.784], 'filler', { captionId: 'main' })];
  const applyOneByOne = ordered => JSON.parse(ordered.reduce((source, cut) =>
    applyCutRanges(source, [cut]).source, original));
  const batch = JSON.parse(applyCutRanges(original, cuts).source);
  const forward = applyOneByOne(cuts);
  const reverse = applyOneByOne([...cuts].reverse());
  const audioSignature = result => result.tracks.find(track => track.lane === 'audio').items
    .map(item => [item.at, item.duration, item.source.in, item.source.out]);
  assert.deepEqual(audioSignature(batch), audioSignature(forward));
  assert.deepEqual(audioSignature(batch), audioSignature(reverse));
  assert.equal(audioSignature(batch)[1][0], 392);
  const overlap = result => {
    const pieces = result.tracks.find(track => track.lane === 'audio').items
      .toSorted((left, right) => left.at - right.at);
    return Math.max(...pieces.slice(1).map((item, index) =>
      Math.max(0, pieces[index].at + pieces[index].duration - item.at)));
  };
  assert.equal(overlap(batch), overlap(forward));
  assert.equal(overlap(batch), 24);
});

test('restore keeps a later J-cut gap made by another cut', () => {
  const doc = JSON.parse(v2([
    media('k0', 0, 190, 0.4, 3.5666666666666664),
    media('k1', 190, 270, 5.666666666666667, 10.166666666666668),
    media('k2', 460, 255, 11.133333333333333, 15.383333333333333),
    media('k3', 724, 384, 17.216666666666665, 23.616666666666667),
  ], [{ id: 'a1', lane: 'audio', items: [
    { id: 'k0-audio', role: 'speech', link: 'k0', at: 0, duration: 190,
      source: { kind: 'media', src: 'main', in: 0.4, out: 3.5666666666666664 } },
    { id: 'k3-audio', role: 'speech', link: 'k3', at: 719, duration: 389,
      source: { kind: 'media', src: 'main', in: 17.133333, out: 23.616666666666667 } },
  ] }]));
  doc.output.fps = 60;
  doc.tracks[0].items[0].audio = false;
  doc.tracks[0].items[3].audio = false;
  const original = text(doc);
  const cuts = [range([15.366666666666667, 15.766666666666667], 'row', { captionId: 'main', label: 'x' }),
    range([3.066666666666667, 3.4833333333333334], 'row', { captionId: 'main', label: 'x' }),
    range([16.933333333333334, 17.416666666666668], 'row', { captionId: 'main', label: 'x' })];
  const edited = cuts.reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
  const expected = [cuts[0], cuts[2]].reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
  assert.equal(canRestoreCutRange(edited, cuts[1]), undefined);
  assert.equal(restoreCutRange(edited, cuts[1]).source, expected);
});

test('restore carries an audio tail linked to the removed right visual piece', () => {
  const doc = JSON.parse(v2([media('k0', 14, 229, 0.06666666666666667, 7.7)],
    [{ id: 'a1', lane: 'audio', items: [
      { id: 'k0-audio', role: 'speech', link: 'k0', at: 14, duration: 233,
        source: { kind: 'media', src: 'main', in: 0.06666666666666667, out: 7.833333 } },
    ] }]));
  doc.output.fps = 30;
  doc.tracks[0].items[0].audio = false;
  const original = text(doc);
  const cuts = [[4.2, 4.833333333333333], [2.433333333333333, 2.7333333333333334],
    [7.533333333333333, 7.8], [0, 0.5333333333333333], [6.7, 7.366666666666666]]
    .map(interval => range(interval, 'row', { captionId: 'main', label: 'x' }));
  const edited = cuts.reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
  const expected = cuts.slice(0, -1).reduce((source, cut) => applyCutRanges(source, [cut]).source, original);
  assert.equal(canRestoreCutRange(edited, cuts.at(-1)), undefined);
  assert.equal(restoreCutRange(edited, cuts.at(-1)).source, expected);
});
