import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasChipDropPatch, canvasRangeFrames } from '../lib/browser/timeline/canvas-chip-drop.js';

test('本体ドラッグは at だけ、右端ドラッグは尺だけを書く', () => {
  const original = { at: 300, duration: 150 };
  assert.deepEqual(canvasChipDropPatch(original, 300, 'body'), { at: 600 });
  assert.deepEqual(canvasChipDropPatch(original, -60, 'right'), { duration: 90 });
  assert.deepEqual(original, { at: 300, duration: 150 });
});

test('範囲端の 1 フレームの誤差は整数秒へ吸い付く', () => {
  assert.deepEqual(canvasRangeFrames(301 / 30, 450 / 30, 30), { at: 300, duration: 150 });
  assert.deepEqual(canvasRangeFrames(10.2, 15, 30), { at: 306, duration: 144 });
});
