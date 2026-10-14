import assert from 'node:assert/strict';
import test from 'node:test';

import { isPreviewSelectionEscapeEcho, selectionLeavesFocus } from '../lib/browser/focus/focus-scope.js';
import { groupsWithoutKeys } from '../lib/browser/focus/preview-keyframe-prompt.js';
import { keyframeDiamondSeekTime } from '../lib/browser/timeline/timeline-keyframe-rows.js';

const rows = [
  { id: 'root' },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
  { id: 'outside' },
];

test('フォーカスは root と子孫を保ち、外側と空選択で抜ける', () => {
  assert.equal(selectionLeavesFocus(rows, 'root', 'root'), false);
  assert.equal(selectionLeavesFocus(rows, 'root', 'grandchild'), false);
  assert.equal(selectionLeavesFocus(rows, 'root', 'outside'), true);
  assert.equal(selectionLeavesFocus(rows, 'root', null), true);
  assert.equal(selectionLeavesFocus(rows, null, null), false);
});

test('ホストの選択通知直後だけ webview の Escape をエコーとして扱う', () => {
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, 'root', 1200, 1000), true);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, 'root', 1200, 1000, 27), false);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, 'root', 1499, 1000), true);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, 'root', 1500, 1000), false);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, 'root', 999, 1000), false);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, 'root', 1200, 0), false);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', false, 'root', 1200, 1000), false);
  assert.equal(isPreviewSelectionEscapeEcho('Escape', true, null, 1200, 1000), false);
  assert.equal(isPreviewSelectionEscapeEcho('Enter', true, 'root', 1200, 1000), false);
});

test('菱形の item 内フレームを出力時刻に変換する', () => {
  assert.equal(keyframeDiamondSeekTime(4.5, 45, 30), 6);
});

test('プレビュー patch のうちキーが無い変形グループだけを返す', () => {
  const item = { source: { kind: 'html', vars: {} }, transform: { scale: 1, rotate: 0 }, duration: 60,
    keyframes: [{ t: 0, transform: { x: 10 } }, { t: 30, transform: { x: 20 } }] };
  assert.deepEqual(groupsWithoutKeys(item, {
    transform: { x: 20, scale: 1.2, rotate: 15 },
    varsAt: { '--akari-3d-rot-y': 30 },
  }, 30), ['size', 'rotation', 'rotation3d']);
  assert.deepEqual(groupsWithoutKeys(item, {}, 30), []);
});

test('値の変わらないフィールドはキーの候補に数えない', () => {
  const item = { source: { kind: 'html', vars: { '--akari-3d-rot-y': '30' } },
    transform: { x: 10, y: 20, scale: 1, rotate: 0 }, duration: 60 };
  assert.deepEqual(groupsWithoutKeys(item, {
    transform: { x: 10, y: 20 + 5e-7, scale: 1.2, scaleX: 1, scaleY: 1, rotate: 0 },
    varsAt: { '--akari-3d-rot-x': 0, '--akari-3d-rot-y': 30 + 5e-7,
      '--akari-3d-rot-z': 0 },
  }, 30), ['size']);
  assert.deepEqual(groupsWithoutKeys(item, {
    transform: { x: 10, y: 20, rotate: 0 },
    varsAt: { '--akari-3d-rot-y': 30 },
  }, 30), []);
});
