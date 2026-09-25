import assert from 'node:assert/strict';
import test from 'node:test';
import { cutResizeCorners, cutResizeScale } from '../lib/common/cut-resize-anchor.js';

test('cut corner drag at 30 degrees keeps the diagonal corner fixed', () => {
  const box = { centerX: 320, centerY: 180, width: 300, height: 200, rotate: 30 };
  const { anchor, dragged } = cutResizeCorners(box, 'se');
  const pointer = { x: dragged.x + (dragged.x - anchor.x) * .4,
    y: dragged.y + (dragged.y - anchor.y) * .4 };
  const scale = cutResizeScale(1, anchor, dragged, dragged, pointer);
  assert.ok(Math.abs(scale - 1.4) < 1e-10);
  const newCenter = { x: anchor.x + (box.centerX - anchor.x) * 1.4,
    y: anchor.y + (box.centerY - anchor.y) * 1.4 };
  const next = cutResizeCorners({ ...box, ...newCenter,
    centerX: newCenter.x, centerY: newCenter.y, width: box.width * 1.4,
    height: box.height * 1.4 }, 'se');
  assert.ok(Math.hypot(next.anchor.x - anchor.x, next.anchor.y - anchor.y) < 1e-9);
});
