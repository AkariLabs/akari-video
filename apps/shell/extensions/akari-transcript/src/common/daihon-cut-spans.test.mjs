import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDaihonRows } from '../../lib/common/daihon-row-model.js';
import { deriveDaihonCutSpans, restoreImpact } from '../../lib/common/daihon-cut-spans.js';
import { applyCutRanges, buildCaptionTimelineSegments, buildTimelineMap, projectLegacyEdit, readInternalEdit } from '@akari-video/edit-store';

const segment = (src, inside) => ({ kind: 'src', src, in: inside[0], out: inside[1],
  outStart: inside[0], outEnd: inside[1], cutIndex: 0 });
const caption = (id, src, start, end, words = [], unrecognized = []) => ({
  id, src, start, end, text: words.map(word => word.text).join(''), style: null, words, unrecognized,
});

test('語・??・行全体・行間を素材別の残存区間から導出し、再読込でも一致する', () => {
  const captions = [
    caption('c-0001', 'a', 0, 3, [
      { text: 'あ', start: 0, end: 1 }, { text: 'えー', start: 1, end: 2 },
      { text: 'い', start: 2, end: 3 },
    ], [{ start: 2.1, end: 2.4 }]),
    caption('c-0002', 'a', 5, 6, [{ text: '次', start: 5, end: 6 }]),
    caption('c-0003', 'b', 1, 2, [{ text: '別', start: 1, end: 2 }]),
  ];
  const segments = [segment('a', [0, 1]), segment('a', [2, 2.1]), segment('a', [2.4, 3]),
    segment('a', [3, 3.2]), segment('a', [4.8, 5]), segment('b', [1, 2])];
  const rows = buildDaihonRows(captions, segments);
  const gaps = [{ prevId: 'c-0001', nextId: 'c-0002', start: 3, end: 5, span: 2 }];
  const spans = deriveDaihonCutSpans(rows, gaps, segments);
  assert.deepEqual(spans.map(span => [span.rowId, span.kind, span.index]), [
    ['c-0001', 'word', 1], ['c-0001', 'unrecognized', 0], ['c-0001', 'silence', undefined],
    ['c-0002', 'row', undefined],
  ]);
  assert.ok(Math.abs(spans.find(span => span.kind === 'silence').removedSeconds - 1.6) < 1e-9);
  assert.deepEqual(spans.map(span => [span.restoreRange?.in, span.restoreRange?.out]),
    [[1, 2], [2.1, 2.4], [3.2, 4.8], [5, 6]]);
  assert.deepEqual(spans.map(span => span.restoreRange?.label), ['えー', '??', '無音', '行']);
  assert.deepEqual(deriveDaihonCutSpans(buildDaihonRows(captions, segments), gaps, segments), spans);
});

test('保存した edit.json を読み直しても語・行間・??・行全体の取り消し線が残る', () => {
  const edit = JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'a', path: 'a.mp4' }], tracks: [{ id: 'visual', lane: 'visual', items: [
      { id: 'clip', at: 0, duration: 210, source: { kind: 'media', src: 'a', in: 0, out: 7 } },
    ] }] });
  const cuts = [[1, 2, 'filler'], [2.1, 2.4, 'unrecognized'], [3.2, 4.8, 'silence'], [5, 6, 'row']];
  let cut = edit;
  for (const [inside, outside, kind] of cuts) cut = applyCutRanges(cut,
    [{ in: inside, out: outside, kind, captionId: 'a' }]).source;
  const captions = [caption('c-0001', 'a', 0, 3, [
    { text: 'あ', start: 0, end: 1 }, { text: 'えー', start: 1, end: 2 },
    { text: 'い', start: 2, end: 3 },
  ], [{ start: 2.1, end: 2.4 }]), caption('c-0002', 'a', 5, 6, [{ text: '次', start: 5, end: 6 }])];
  const gaps = [{ prevId: 'c-0001', nextId: 'c-0002', start: 3, end: 5, span: 2 }];
  const load = source => {
    const legacy = projectLegacyEdit(readInternalEdit(source, { hasCaptions: true }));
    const segments = buildTimelineMap(legacy.cuts, { fps: legacy.fps }).segments;
    return deriveDaihonCutSpans(buildDaihonRows(captions, segments), gaps, segments);
  };
  const first = load(cut);
  assert.deepEqual(first.map(span => span.kind), ['word', 'unrecognized', 'silence', 'row']);
  assert.deepEqual(load(JSON.stringify(JSON.parse(cut))), first);
});

const sourceEdit = () => JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'a', path: 'a.mp4' }], tracks: [{ id: 'visual', lane: 'visual', items: [
    { id: 'clip', at: 0, duration: 480, source: { kind: 'media', src: 'a', in: 0, out: 16 } },
  ] }] });
const timelineOf = edit => {
  const legacy = projectLegacyEdit(readInternalEdit(edit, { hasCaptions: true }));
  return buildTimelineMap(legacy.cuts, { fps: legacy.fps }).segments;
};

test('フレーム外の語 200 件を 10 ms・1 ms 精度の各系列で切っても 200 件すべて検出する', () => {
  let seed = 20261006;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (const quantum of [0.01, 0.001]) {
    let detected = 0;
    for (let index = 0; index < 200; index++) {
      const start = Math.round((0.3 + random() * 14) / quantum) * quantum;
      const end = Math.round((start + 0.22 + random() * 0.55) / quantum) * quantum;
      const captions = [caption('c', 'a', 0, 16, [{ text: 'えー', start, end }])];
      const cut = applyCutRanges(sourceEdit(), [{ in: start, out: end, kind: 'filler', captionId: 'a' }]);
      const segments = timelineOf(cut.source);
      const rows = buildDaihonRows(captions, segments, 30);
      if (deriveDaihonCutSpans(rows, [], segments, 30).some(span => span.kind === 'word')) detected++;
    }
    assert.equal(detected, 200, `${quantum} 秒精度`);
  }
});

test('速度 1.25・1.5・2 倍で切ったフィラーを各 300 件検出する', () => {
  let seed = 99;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const speed of [1.25, 1.5, 2]) {
    let detected = 0;
    for (let index = 0; index < 300; index++) {
      const edit = JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 },
        sources: [{ id: 'a', path: 'a.mp4' }], tracks: [{ id: 'v', lane: 'visual', items: [
          { id: 'clip', at: 0, duration: Math.round(16 * 30 / speed),
            source: { kind: 'media', src: 'a', in: 0, out: 16, speed } },
        ] }] });
      const start = +(0.5 + random() * 14).toFixed(3);
      const end = +(start + 0.2 + random() * 0.5).toFixed(3);
      const cut = applyCutRanges(edit, [{ in: start, out: end, kind: 'filler', captionId: 'a' }]).source;
      const segments = timelineOf(cut);
      const rows = buildDaihonRows([caption('c', 'a', 0, 16, [
        { text: '前', start: 0, end: start }, { text: 'えー', start, end },
        { text: '後', start: end, end: 16 },
      ])], segments, 30);
      if (deriveDaihonCutSpans(rows, [], segments, 30)
        .some(span => span.kind === 'word' && span.index === 1)) detected++;
    }
    assert.equal(detected, 300, `speed=${speed}`);
  }
});

test('混在速度では語に接する 1 倍区間の半フレームを使う', () => {
  const segments = [
    { ...segment('a', [0, 1.02]), speed: 1 },
    { ...segment('a', [2, 3]), speed: 2 },
  ];
  const rows = buildDaihonRows([caption('mixed', 'a', 0, 3,
    [{ text: '前', start: 0, end: 1 }, { text: '境界', start: 1, end: 1.08 }])], segments, 30);
  assert.equal(deriveDaihonCutSpans(rows, [], segments, 30)
    .some(span => span.kind === 'word' && span.index === 1), false);
});

test('音声素材の台本行は配置時刻に並び、item の中間削除が語の取り消し線になる', () => {
  const edit = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'take', path: 'take.mp4' }, { id: 'mic', path: 'mic.wav' }],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'take-1', at: 0, duration: 150,
      source: { kind: 'media', src: 'take', in: 0, out: 5 } }] },
    { id: 'a', lane: 'audio', items: [{ id: 'mic-1', role: 'speech', at: 60, duration: 90,
      source: { kind: 'media', src: 'mic', in: 0, out: 3 } }] }] };
  const captions = [caption('mic-row', 'mic', 0, 3, [
    { text: '前', start: 0, end: 1 }, { text: 'えー', start: 1, end: 2 },
    { text: '後', start: 2, end: 3 },
  ])];
  const load = value => {
    const internal = readInternalEdit(value, { hasCaptions: true });
    const legacy = projectLegacyEdit(internal);
    const segments = buildCaptionTimelineSegments(legacy.cuts, internal, { fps: 30 });
    return { segments, rows: buildDaihonRows(captions, segments, 30) };
  };
  const before = load(edit);
  assert.equal(before.rows[0].outStart, 2);
  assert.deepEqual(deriveDaihonCutSpans(before.rows, [], before.segments, 30), []);
  edit.tracks[1].items = [
    { id: 'mic-left', role: 'speech', at: 60, duration: 30,
      source: { kind: 'media', src: 'mic', in: 0, out: 1 } },
    { id: 'mic-right', role: 'speech', at: 90, duration: 30,
      source: { kind: 'media', src: 'mic', in: 2, out: 3 } },
  ];
  const after = load(edit);
  assert.equal(after.rows[0].outStart, 2);
  assert.deepEqual(deriveDaihonCutSpans(after.rows, [], after.segments, 30)
    .filter(span => span.kind === 'word').map(span => span.index), [1]);
});

test('フレーム外の ?? と接した行全体もカット済みとして残る', () => {
  const unknown = { start: 6.11, end: 6.49 };
  const unknownCut = applyCutRanges(sourceEdit(), [{ in: unknown.start, out: unknown.end,
    kind: 'unrecognized', captionId: 'a' }]);
  const unknownSegments = timelineOf(unknownCut.source);
  const unknownRows = buildDaihonRows([caption('c', 'a', 0, 16,
    [{ text: '前', start: 0, end: 0.5 }], [unknown])], unknownSegments, 30);
  assert.ok(deriveDaihonCutSpans(unknownRows, [], unknownSegments, 30)
    .some(span => span.kind === 'unrecognized'));

  const adjacent = [caption('before', 'a', 0, 1.23), caption('cut', 'a', 1.23, 2.47),
    caption('after', 'a', 2.47, 4)];
  const rowCut = applyCutRanges(sourceEdit(), [{ in: 1.23, out: 2.47, kind: 'row', captionId: 'a' }]);
  const rowSegments = timelineOf(rowCut.source);
  const rows = buildDaihonRows(adjacent, rowSegments, 30);
  assert.equal(rows[1].outStart, null);
  assert.ok(deriveDaihonCutSpans(rows, [], rowSegments, 30)
    .some(span => span.rowId === 'cut' && span.kind === 'row'));
  const shortIntact = buildDaihonRows([caption('short', 'a', 0.5, 0.52)],
    [segment('a', [0, 1])], 30);
  assert.notEqual(shortIntact[0].outStart, null);
});

test('カットの前後にある 20〜60 ms の語は中心が残っていれば取り消し線を付けない', () => {
  const cut = applyCutRanges(sourceEdit(), [{ in: 1.005, out: 1.995, kind: 'filler', captionId: 'a' }]);
  const segments = timelineOf(cut.source);
  for (const length of [0.02, 0.03, 0.04, 0.06]) {
    const words = [{ text: '前', start: 1.005 - length, end: 1.005 },
      { text: '切る', start: 1.005, end: 1.995 },
      { text: '後', start: 1.995, end: 1.995 + length }];
    const rows = buildDaihonRows([caption('short-neighbor', 'a', 0, 3, words)], segments, 30);
    const spans = deriveDaihonCutSpans(rows, [], segments, 30);
    assert.deepEqual(spans.filter(span => span.kind === 'word').map(span => span.index), [1], `${length} 秒`);
  }
});

test('素材解決の callback と、隣接カットをまとめて戻す影響範囲を使う', () => {
  const rows = buildDaihonRows([caption('one', null, 0, 4, [
    { text: '甲', start: 1, end: 2 }, { text: '乙', start: 2, end: 3 },
  ])], [segment('a', [0, 1]), segment('a', [3, 4]), segment('b', [0, 4])]);
  const spans = deriveDaihonCutSpans(rows, [], [segment('a', [0, 1]), segment('a', [3, 4]),
    segment('b', [0, 4])], 30, () => 'a');
  assert.deepEqual(spans.map(span => span.restoreRange?.captionId), ['a', 'a']);
  assert.deepEqual(restoreImpact(spans, spans[0], 30), { wider: true, otherCount: 1 });
  assert.deepEqual(restoreImpact(spans, { ...spans[0] }, 30), { wider: true, otherCount: 1 });
  assert.deepEqual(spans[0].restoreRange && [spans[0].restoreRange.in, spans[0].restoreRange.out], [1, 3]);
});

test('再読込で別オブジェクトになった単独の語は自分を隣接カットとして数えない', () => {
  const current = { rowId: 'c', kind: 'word', index: 0, in: 0.51, out: 0.88,
    sourceId: 'a', restoreRange: { in: 0.5, out: 0.8667, kind: 'filler', captionId: 'a' },
    removedSeconds: 0.37 };
  assert.deepEqual(restoreImpact([current], { ...current }, 30), { wider: false, otherCount: 0 });
});
