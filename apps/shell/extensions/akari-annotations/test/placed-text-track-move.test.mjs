import assert from 'node:assert/strict';
import test from 'node:test';
import { moveTreeV2PlacedCaption } from '../lib/common/edit-v2-mutations.js';
import { planPlacedTextMove, startsPlacedTextVerticalDrag } from '../lib/common/placed-text-drag.js';

const caption = { id: 'c1', at: 30, duration: 60 };
const initial = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
  tracks: [
    { id: 'v1', lane: 'visual', items: [{ id: 'photo', at: 0, duration: 20,
      source: { kind: 'image', path: 'photo.png' } }] },
    { id: 'v2', lane: 'visual', items: [{ id: 'later', at: 200, duration: 30,
      source: { kind: 'image', path: 'later.png' } }] },
    { id: 'text', lane: 'visual', items: [{ id: 'bag', at: 0, duration: 120,
      source: { kind: 'captions', path: 'captions.json', exclude: [] } }] }
  ] });
const explicit = doc => doc.tracks.flatMap(track => track.items.map(item => ({ track, item })))
  .find(({ item }) => item.source.kind === 'caption');

test('置いた文字は袋から出て写真と同じ映像段に入り、別段へ移り、文字の行へ戻る', () => {
  const before = initial();
  const first = moveTreeV2PlacedCaption(before, caption, { track: 'v1' }).document;
  assert.deepEqual(before.tracks[2].items[0].source.exclude, []);
  assert.deepEqual(first.tracks.find(track => track.id === 'text').items[0].source.exclude, ['c1']);
  assert.equal(explicit(first).track.id, 'v1');
  assert.equal(explicit(first).item.at, 30);
  const moved = moveTreeV2PlacedCaption(first, { ...caption, at: 45 }, { track: 'v2' }).document;
  assert.equal(explicit(moved).track.id, 'v2');
  assert.equal(explicit(moved).item.at, 45);
  const restored = moveTreeV2PlacedCaption(moved, caption, { placedText: true }).document;
  assert.equal(explicit(restored), undefined);
  assert.equal('exclude' in restored.tracks.find(track => track.id === 'text').items[0].source, false);
  assert.deepEqual(first.tracks.find(track => track.id === 'text').items[0].source.exclude, ['c1']);
});

test('置いた文字は縦だけの移動でドラッグを開始し、話した言葉とトリムは従来どおり', () => {
  const input = { kind: 'caption', mode: 'move', timeDomain: 'output',
    startClientY: 100, clientY: 160, threshold: 5 };
  assert.equal(startsPlacedTextVerticalDrag(input), true);
  assert.equal(startsPlacedTextVerticalDrag({ ...input, timeDomain: 'source' }), false);
  assert.equal(startsPlacedTextVerticalDrag({ ...input, mode: 'start' }), false);
  assert.equal(startsPlacedTextVerticalDrag({ ...input, clientY: 103 }), false);
});

test('行の中央はその映像段、境目だけ新規段、字幕袋と音の行は理由付きで拒否', () => {
  const base = { originalStart: 1, originalEnd: 3, proposedStart: 1, originalTop: '0px', stripTop: 0,
    rows: [
      { id: 'v-captions', lane: 'caption-bag', top: 100, height: 38 },
      { id: 'v-photo', lane: 'visual', top: 142, height: 38 },
      { id: 'v-main', lane: 'visual', top: 184, height: 38 },
      { id: 'a1', lane: 'audio', top: 226, height: 38 }
    ] };
  const plan = (clientY, visualHit) => planPlacedTextMove({ ...base, clientY, visualHit });
  assert.deepEqual(plan(161, { top: 142, insertIndex: 2, rejected: false }).destination,
    { kind: 'track', trackId: 'v-photo' });
  assert.deepEqual(plan(203, { top: 184, insertIndex: 3, rejected: false }).destination,
    { kind: 'track', trackId: 'v-main' });
  assert.deepEqual(plan(182, { top: 182, insertIndex: 2, rejected: false }).destination,
    { kind: 'new-track', insertIndex: 2 });
  assert.equal(plan(119, { top: 100, insertIndex: 1, rejected: false }).reason,
    '字幕の段には置けません');
  assert.equal(plan(245, { top: 226, rejected: true }).reason, '音のトラックには置けません');
});

const photoRowMove = (items, movingItemId) => planPlacedTextMove({
  originalStart: 3, originalEnd: 6, proposedStart: 3, originalTop: '0px',
  clientY: 119, stripTop: 0, fps: 30, movingItemId,
  rows: [{ id: 'v-photo', lane: 'visual', top: 100, height: 38 }],
  visualHit: { top: 100, targetTrackId: 'v-photo', rejected: false },
  trackItems: items
});

test('写真と時間が重なる映像段は理由付きで拒否する', () => {
  const plan = photoRowMove([{ trackId: 'v-photo', id: 'photo-1', at: 0, duration: 360 }]);
  assert.deepEqual(plan.destination, { kind: 'rejected' });
  assert.equal(plan.reason, '同じトラックの区間と重なります');
  assert.equal(plan.top, '100px');
});

test('同じ映像段でも時間が重ならなければその段を選ぶ', () => {
  const plan = photoRowMove([{ trackId: 'v-photo', id: 'photo-1', at: 0, duration: 90 }]);
  assert.deepEqual(plan.destination, { kind: 'track', trackId: 'v-photo' });
  assert.equal(plan.reason, undefined);
});

test('既に item 化した文字自身は重なり判定から除く', () => {
  const plan = photoRowMove([{ trackId: 'v-photo', id: 'cap-c1', at: 90, duration: 90 }], 'cap-c1');
  assert.deepEqual(plan.destination, { kind: 'track', trackId: 'v-photo' });
});

test('操作前から空の音の段を残し、移動で空になった映像段だけ落とす', () => {
  const before = initial();
  before.tracks[0].items = [];
  before.tracks.push({ id: 'a1', lane: 'audio', items: [] });
  const placed = moveTreeV2PlacedCaption(before, caption, { track: 'v1' }).document;
  assert.ok(placed.tracks.some(track => track.id === 'a1' && track.items.length === 0));
  const moved = moveTreeV2PlacedCaption(placed, caption, { track: 'v2' }).document;
  assert.ok(moved.tracks.some(track => track.id === 'a1' && track.items.length === 0));
  assert.equal(moved.tracks.some(track => track.id === 'v1'), false);
  const returned = moveTreeV2PlacedCaption(moved, caption, { placedText: true }).document;
  assert.ok(returned.tracks.some(track => track.id === 'a1' && track.items.length === 0));
});

test('戻すとき exclude の最後の id を外したらキーごと消す', () => {
  const placed = moveTreeV2PlacedCaption(initial(), caption, { track: 'v1' }).document;
  const returned = moveTreeV2PlacedCaption(placed, caption, { placedText: true }).document;
  assert.deepEqual(returned.tracks.find(track => track.id === 'text').items[0].source,
    { kind: 'captions', path: 'captions.json' });
});

test('袋が無い編集でも item 化でき、新しい映像段を作れる', () => {
  const before = initial();
  before.tracks.pop();
  const result = moveTreeV2PlacedCaption(before, caption, { insertIndex: 1 });
  assert.ok(!before.tracks.some(track => track.id === explicit(result.document).track.id));
  assert.deepEqual(result.document.tracks.flatMap(track => track.items)
    .find(item => item.source.kind === 'captions').source.exclude, ['c1']);
});

test('着地段の素材と時間が重なれば既存の木操作が直上に映像段を作る', () => {
  const before = initial();
  before.tracks[0].items[0].duration = 120;
  const result = moveTreeV2PlacedCaption(before, caption, { track: 'v1' });
  assert.notEqual(explicit(result.document).track.id, 'v1');
  assert.equal(result.document.tracks.indexOf(explicit(result.document).track),
    result.document.tracks.findIndex(track => track.id === 'v1') + 1);
});

test('item 化済みの文字は横移動後の時刻で重なりを判定する', () => {
  const first = moveTreeV2PlacedCaption(initial(), caption, { track: 'v1' }).document;
  const moved = moveTreeV2PlacedCaption(first, { ...caption, at: 210 }, { track: 'v2' }).document;
  assert.notEqual(explicit(moved).track.id, 'v2');
  assert.equal(explicit(moved).item.at, 210);
});

test('字幕 item を音の段へ移す書き込みを拒否する', () => {
  const before = initial();
  before.tracks.push({ id: 'a1', lane: 'audio', items: [{ id: 'sound', at: 0, duration: 120,
    source: { kind: 'audio', path: 'sound.wav' } }] });
  assert.throws(() => moveTreeV2PlacedCaption(before, caption, { track: 'a1' }), /映像トラック/);
  const placed = moveTreeV2PlacedCaption(before, caption, { track: 'v1' }).document;
  assert.throws(() => moveTreeV2PlacedCaption(placed, caption, { track: 'a1' }), /映像トラック/);
});

test('1 回の履歴スナップショットで edit.json と captions.json が往復する', () => {
  const before = { edit: JSON.stringify(initial()), captions: JSON.stringify({ captions: [
    { id: 'c1', start: 1, end: 3, time_domain: 'output', text: '文字' }] }) };
  const after = { edit: JSON.stringify(moveTreeV2PlacedCaption(JSON.parse(before.edit), caption,
    { track: 'v1' }).document), captions: JSON.stringify({ captions: [
    { id: 'c1', start: 2, end: 4, time_domain: 'output', text: '文字' }] }) };
  let disk = after;
  const history = { undo: () => { disk = before; }, redo: () => { disk = after; } };
  history.undo();
  assert.deepEqual(disk, before);
  history.redo();
  assert.deepEqual(disk, after);
});
