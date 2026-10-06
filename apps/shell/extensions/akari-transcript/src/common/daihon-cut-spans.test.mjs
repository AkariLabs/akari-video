import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDaihonRows } from '../../lib/common/daihon-row-model.js';
import { deriveDaihonCutSpans } from '../../lib/common/daihon-cut-spans.js';
import { applyCutRanges, buildTimelineMap, projectLegacyEdit, readInternalEdit } from '@akari-video/edit-store';

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
