import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLibraryDragPayload, textStyleDropBandLayout, textStyleDropStart, textStyleGhostEnd, textStylePlaceOptions } from '../lib/browser/library-drop-model.js';

test('textstyle payload だけを検証し、stylePreset と start に変換する', () => {
  const payload = { kind: 'textstyle', id: 'telop-title' };
  assert.deepEqual(parseLibraryDragPayload(JSON.stringify(payload)), payload);
  assert.deepEqual(parseLibraryDragPayload(payload), payload);
  assert.deepEqual(textStylePlaceOptions(payload, 10), { start: 10, stylePreset: 'telop-title' });
  for (const invalid of [{ kind: 'textstyle', id: '' }, { kind: 'textstyle', id: 1 }, '{']) {
    assert.equal(parseLibraryDragPayload(invalid), undefined);
  }
});

test('マイスタイルのドラッグは部品を値のまま運ぶ', () => {
  const payload = { kind: 'mystyle', style: { parts: [{ kind: 'look', text_style: { color: '#ff1744' } },
    { kind: 'motion', animation: { in: { id: 'pop' } } }] } };
  assert.deepEqual(parseLibraryDragPayload(JSON.stringify(payload)), payload);
  assert.equal(parseLibraryDragPayload({ kind: 'mystyle', style: { parts: [{}] } }), undefined);
});

test('落下横位置を可視区間の出力時刻へ換算する', () => {
  assert.equal(textStyleDropStart(450, 100, 700, 5, 20), 15);
  assert.equal(textStyleDropStart(100, 100, 700, 5, 20), 5);
  assert.equal(textStyleDropStart(900, 100, 700, 5, 20), 25);
  assert.equal(textStyleDropStart(0, 100, 700, -2, 20), 0);
});

test('受け皿は文字行を優先し、無ければ字幕行の直上に置く', () => {
  assert.deepEqual(textStyleDropBandLayout({ top: 80, height: 48 }, { top: 130 }, 40, 24), { top: 80, height: 48 });
  assert.deepEqual(textStyleDropBandLayout(undefined, { top: 130 }, 40, 24), { top: 106, height: 24 });
  assert.deepEqual(textStyleDropBandLayout(undefined, undefined, 40, 24), { top: 40, height: 24 });
});

test('ゴーストの終端は placeText の既定と同じく出力尺で切る', () => {
  assert.equal(textStyleGhostEnd(10, 12), 12);
  assert.equal(textStyleGhostEnd(4, 12), 7);
  assert.equal(textStyleGhostEnd(10, 0), 13);
  assert.equal(textStyleGhostEnd(13, 12), 12);
});
