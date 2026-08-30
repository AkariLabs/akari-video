import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateKeyframeDiamonds,
  deriveTimelineKeyframeRows,
} from '../lib/browser/timeline/timeline-keyframe-rows.js';

test('既定プロパティ行を導出し、両端白抜き・中間塗りを判定する', () => {
  const rows = deriveTimelineKeyframeRows({
    id: 'title', duration: 90,
    keyframes: [
      { t: 0, transform: { x: -100 } },
      { t: 45, transform: { x: 0 } },
      { t: 90, transform: { x: 100 } },
    ]
  });
  assert.deepEqual(rows.map(row => row.property), [
    'transform.x', 'transform.y', 'transform.scale', 'transform.rotate', 'opacity'
  ]);
  assert.deepEqual(rows[0].diamonds, [
    { t: 0, endpoint: true, filled: false },
    { t: 45, endpoint: false, filled: true },
    { t: 90, endpoint: true, filled: false },
  ]);
});

test('crop / perspective は表示専用行として必要時だけ現れる', () => {
  const rows = deriveTimelineKeyframeRows({
    id: 'card', duration: 30, crop: { x: 0, y: 0, w: 1, h: 1 },
    keyframes: [{ t: 0, perspective: { corners: [] } }, { t: 30, perspective: { corners: [] } }]
  });
  assert.equal(rows.find(row => row.property === 'crop').editable, false);
  assert.equal(rows.find(row => row.property === 'perspective').editable, false);
});

test('集約ダイヤは全子が同時刻なら塗り、一部だけならくり抜き', () => {
  const diamonds = aggregateKeyframeDiamonds([
    { id: 'a', duration: 20, keyframes: [{ t: 0, opacity: 0 }, { t: 20, opacity: 1 }] },
    { id: 'b', duration: 20, keyframes: [{ t: 0, transform: { x: 0 } }, { t: 10, transform: { x: 1 } }] },
  ]);
  assert.deepEqual(diamonds.map(({ t, filled, itemIds }) => ({ t, filled, itemIds })), [
    { t: 0, filled: true, itemIds: ['a', 'b'] },
    { t: 10, filled: false, itemIds: ['b'] },
    { t: 20, filled: false, itemIds: ['a'] },
  ]);
});

test('点の無いアイテムも基本 5 行を出し、空白ダブルクリックの席を保つ', () => {
  const rows = deriveTimelineKeyframeRows({ id: 'empty', duration: 60 });
  assert.equal(rows.length, 5);
  assert.equal(rows.every(row => row.diamonds.length === 0 && row.editable), true);
});

test('点を持つ子が無い集約行にはダイヤを作らない', () => {
  assert.deepEqual(aggregateKeyframeDiamonds([
    { id: 'a', duration: 20 }, { id: 'b', duration: 20, keyframes: [] }
  ]), []);
});

test('点を持たない子も集約の全子判定へ数える', () => {
  const diamonds = aggregateKeyframeDiamonds([
    { id: 'a', duration: 20, keyframes: [{ t: 0, opacity: 0 }, { t: 20, opacity: 1 }] },
    { id: 'b', duration: 20 }
  ]);
  assert.equal(diamonds.every(diamond => diamond.filled === false), true);
});
