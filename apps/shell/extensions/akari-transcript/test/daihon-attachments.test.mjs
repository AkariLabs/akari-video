import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { attachmentRanges, visibleAttachmentRanges, visibleLaneCount, isAttachmentItem } = require('../lib/common/daihon-attachments.js');
const { placedTextLanes } = require('../lib/common/daihon-placed-text.js');

const rows = Array.from({ length: 8 }, (_, index) => ({ outStart: index * 4, outEnd: index * 4 + 4 }));
const edit = {
  version: 2, output: { fps: 30 },
  sources: [{ id: 'image', path: 'assets/beans.PNG' }, { id: 'film', path: 'assets/film.mp4' }],
  tracks: [
    { lane: 'visual', items: [
      { id: 'logo', name: 'ロゴ', at: 0, duration: 960, source: { kind: 'html', path: 'assets/logo.html' } },
      { id: 'band', at: 120, duration: 360, source: { kind: 'html', path: 'assets/band.html' } },
      { id: 'still', at: 240, duration: 120, source: { kind: 'media', src: 'image' } },
      { id: 'base', at: 0, duration: 960, source: { kind: 'media', src: 'film' } },
      { id: 'telop', at: 0, duration: 120, source: { kind: 'telop', preset: 'a' } }
    ] },
    { lane: 'audio', items: [{ id: 'audio', at: 0, duration: 960, source: { kind: 'media', src: 'image' } }] }
  ]
};

test('v2 visual の HTML と静止画だけを半開の出力行に割り当てる', () => {
  const ranges = attachmentRanges(edit, rows, 3);
  assert.deepEqual(ranges.map(({ id, kind, name, first, last, colorIndex }) =>
    [id, kind, name, first, last, colorIndex]), [
    ['band', 'html', 'band.html', 1, 3, 3],
    ['logo', 'html', 'ロゴ', 0, 7, 4],
    ['still', 'image', 'beans.PNG', 2, 2, 5]
  ]);
  assert.equal(attachmentRanges({ ...edit, version: 1 }, rows).length, 0);
  assert.deepEqual(attachmentRanges(edit, [], 3), []);
});

test('重なる行が無い空白では開始以降の最初の行に札を置く', () => {
  const sparse = [{ outStart: 0, outEnd: 2 }, { outStart: null, outEnd: null }, { outStart: 5, outEnd: 8 }];
  const candidate = { ...edit, tracks: [{ lane: 'visual', items: [
    { id: 'gap', at: 75, duration: 15, source: { kind: 'html', path: 'gap.html' } },
    { id: 'late', at: 300, duration: 15, source: { kind: 'html', path: 'late.html' } }
  ] }] };
  assert.deepEqual(attachmentRanges(candidate, sparse).map(({ id, first, last }) => [id, first, last]), [['gap', 2, 2]]);
});

test('文字と添付は一度だけ共通の貪欲列へ割り当て、5 列目から数字に畳む', () => {
  const text = [{ captionId: 'text', first: 0, last: 7, colorIndex: 0 }];
  const attachments = Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, first: 0, last: 7, colorIndex: index + 1 }));
  const all = visibleAttachmentRanges('all', text, attachments);
  const layout = placedTextLanes(all.map(range => ({ ...range,
    id: 'captionId' in range ? `text:${range.captionId}` : `item:${range.id}` })));
  assert.equal(layout.count, 6);
  assert.equal(layout.lanes.get('text:text'), 0);
  assert.equal(layout.lanes.get('item:a4'), 5);
  assert.equal(visibleLaneCount(layout.count), 4);
  assert.deepEqual(attachments.filter(item => layout.lanes.get(`item:${item.id}`) >= 4)
    .map(item => `▮${layout.lanes.get(`item:${item.id}`) + 1}`), ['▮5', '▮6']);
  assert.deepEqual(visibleAttachmentRanges('text', text, attachments), text);
  assert.deepEqual(visibleAttachmentRanges('none', text, attachments), []);
});

test('同じ文字列の captionId と item id でも列キーが衝突しない', () => {
  const shared = [
    { id: 'text:same', first: 0, last: 7, colorIndex: 0 },
    { id: 'item:same', first: 0, last: 7, colorIndex: 1 }
  ];
  const { lanes, count } = placedTextLanes(shared);
  assert.equal(count, 2);
  assert.notEqual(lanes.get('text:same'), lanes.get('item:same'));
});

test('v2 の HTML・静止画だけが既存 item 更新 API の対象になる', () => {
  assert.equal(isAttachmentItem(edit, 'band'), true);
  assert.equal(isAttachmentItem(edit, 'still'), true);
  for (const id of ['base', 'telop', 'audio', 'absent']) assert.equal(isAttachmentItem(edit, id), false);
  assert.equal(isAttachmentItem({ ...edit, version: 1 }, 'band'), false);
});
