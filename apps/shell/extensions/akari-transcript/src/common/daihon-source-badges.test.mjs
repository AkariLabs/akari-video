import assert from 'node:assert/strict';
import test from 'node:test';
import {
  duplicateSpeechPairs, rowSourceDotColor, rowSourceIds, sourceBadgeColors,
  sourceRowVisible, toggleSourceId, visibleSourceIds
} from '../../lib/common/daihon-source-badges.js';

const sources = [
  { id: 'camera', path: 'clips/camera.mp4', kind: 'video' },
  { id: 'mic', path: 'audio/mic.wav', kind: 'audio' },
];
const row = (id, src, outStart, text = '同じ発話', start = outStart) =>
  ({ id, src, start, outStart, text });

test('同じ種別の素材 2 本には別の色を割り当て、同じ並びなら再計算しても変わらない', () => {
  const ordered = [sources[0], { id: 'camera2', path: 'clips/camera2.mp4', kind: 'video' },
    sources[1], { id: 'mic2', path: 'audio/mic2.wav', kind: 'audio' }];
  const colors = sourceBadgeColors(ordered);
  assert.notEqual(colors.get('camera'), colors.get('camera2'));
  assert.notEqual(colors.get('mic'), colors.get('mic2'));
  assert.deepEqual([...sourceBadgeColors(ordered)], [...colors]);
  assert.match(colors.get('camera'), /^#[0-9a-f]{6}$/i);
});

test('同種別の 4 本目は他方の未使用色を使い、6 本までは衝突しない', () => {
  const ordered = Array.from({ length: 4 }, (_, index) =>
    ({ id: `camera${index}`, path: `camera${index}.mp4`, kind: 'video' }))
    .concat([{ id: 'mic1', path: 'mic1.wav', kind: 'audio' },
      { id: 'mic2', path: 'mic2.wav', kind: 'audio' }]);
  const colors = sourceBadgeColors(ordered);
  assert.equal(new Set(colors.values()).size, 6);
  assert.equal(colors.get('camera3'), '#bd9af5');
});

test('行頭の点は行のある素材が二つ以上のときだけ付く', () => {
  const one = rowSourceIds(sources, [row('a', 'camera', 0)]);
  const two = rowSourceIds(sources, [row('a', 'camera', 0), row('b', 'mic', 0)]);
  const colors = sourceBadgeColors(sources);
  assert.equal(rowSourceDotColor(colors, one, 'camera'), null);
  assert.equal(rowSourceDotColor(colors, two, 'camera'), colors.get('camera'));
  assert.equal(rowSourceDotColor(colors, two, 'mic'), colors.get('mic'));
});

test('素材チップは表示を切り替え、最後の一つは残し、行数を絞れる', () => {
  const ids = rowSourceIds(sources, [row('a', 'camera', 0), row('b', 'mic', 0), row('c', 'mic', 1)]);
  let visible = visibleSourceIds(ids, []);
  visible = toggleSourceId(ids, visible, 'camera');
  assert.deepEqual(visible, ['mic']);
  const rows = [row('a', 'camera', 0), row('b', 'mic', 0), row('c', 'mic', 1)];
  assert.equal(rows.filter(item => sourceRowVisible(ids, visible, item.src)).length, 2);
  assert.deepEqual(toggleSourceId(ids, visible, 'mic'), ['mic']);
  assert.deepEqual(visibleSourceIds(ids, ['camera', 'mic']), ['camera']);
  assert.deepEqual(toggleSourceId(ids, visible, 'camera'), ['camera', 'mic']);
});

test('同じ発話の印は正規化した文と出力開始 0.3 秒以内の別素材にだけ付く', () => {
  const pairs = duplicateSpeechPairs([
    row('a', 'camera', 1, 'こんにちは、 世界！', 5),
    row('b', 'mic', 1.3, 'こんにちは 世界', 8),
    row('c', 'camera', 1.1, 'こんにちは 世界'),
    row('d', 'mic', 2, 'こんにちは 世界'),
    row('e', 'mic', 3, '別の発話'),
    row('f', 'camera', null, '別の発話'),
  ]);
  assert.equal(pairs.get('a'), 'b');
  assert.equal(pairs.get('b'), 'a');
  for (const id of ['c', 'd', 'e', 'f']) assert.equal(pairs.has(id), false);
});
