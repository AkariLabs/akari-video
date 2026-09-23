import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clampDockHeight, readDockHeight, dockTabs, dockActions, lookPatch, currentLookSwatch,
  shouldCloseDockOnEscape } = require('../lib/common/daihon-dock.js');

test('高さの記憶値を読み、140px からパネル 80% へ収める', () => {
  assert.equal(clampDockHeight(50, 500), 140);
  assert.equal(clampDockHeight(900, 500), 400);
  assert.equal(readDockHeight('272px', 500), 272);
  assert.equal(readDockHeight('900px', 500), 400);
  assert.equal(clampDockHeight(900, 500, 320), 320);
  assert.equal(readDockHeight('900px', 500, 320), 320);
  for (const invalid of [null, '', '50%', '-1px', 'NaNpx', '12evil']) {
    assert.equal(readDockHeight(invalid, 500), null);
  }
});

test('Esc は開いているドックの範囲でだけ処理する', () => {
  assert.equal(shouldCloseDockOnEscape('Escape', true, true, false), true);
  assert.equal(shouldCloseDockOnEscape('Escape', true, false, true), true);
  assert.equal(shouldCloseDockOnEscape('Escape', true, false, false), false);
  assert.equal(shouldCloseDockOnEscape('Escape', false, true, false), false);
  assert.equal(shouldCloseDockOnEscape('Enter', true, true, false), false);
});

test('選択の種類でドックのタブが決まる', () => {
  assert.deepEqual(dockTabs('row'), ['template', 'look', 'anim', 'emphasis', 'time']);
  assert.deepEqual(dockTabs('placed'), ['text', 'template', 'look', 'anim']);
});

test('右クリックは利用できる操作だけ', () => {
  assert.deepEqual(dockActions('row', { cut: true, split: true, 'merge-next': false,
    'insert-below': true, delete: true }), ['cut', 'split', 'insert-below', 'delete']);
  assert.deepEqual(dockActions('placed', { all: true, delete: true }), ['all', 'delete']);
  assert.deepEqual(dockActions('placed', { all: true, duplicate: true, delete: true }),
    ['all', 'duplicate', 'delete']);
});

test('見た目の書き込み引数は setCaptionTextStyle の camelCase patch', () => {
  assert.deepEqual(lookPatch('color', '#ffffff'), { color: '#ffffff' });
  assert.deepEqual(lookPatch('background', 'none'), { background: { opacity: 0 } });
  assert.deepEqual(lookPatch('background', '#000000'), { background: { color: '#000000', opacity: 1 } });
  assert.deepEqual(lookPatch('size', 38), { sizePx: 38 });
  assert.deepEqual(lookPatch('spacing', .12), { letterSpacingEm: .12 });
  assert.deepEqual(lookPatch('stroke', 3), { stroke: { widthPx: 3, color: '#000000' } });
});

test('色の選択印は行固有値、次にプリセット値を読む', () => {
  assert.equal(currentLookSwatch({ color: '#ffffff' }, { color: '#111111' }, 'color'), '#ffffff');
  assert.equal(currentLookSwatch({}, { color: '#111111' }, 'color'), '#111111');
  assert.equal(currentLookSwatch({ background: { opacity: 0 } },
    { background: { color: '#facc15' } }, 'background'), 'none');
  assert.equal(currentLookSwatch({}, { background: { color: '#facc15' } }, 'background'), '#facc15');
  assert.equal(currentLookSwatch({}, {}, 'background'), 'none');
});
