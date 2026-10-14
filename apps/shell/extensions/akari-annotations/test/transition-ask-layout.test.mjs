import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionAskLayout } from '../lib/common/transition-picker-layout.js';

test('confirmation fits narrow viewports and keeps the arrow over its anchor', () => {
  for (const anchor of [
    { left: 0, right: 20, top: 300, bottom: 320 },
    { left: 295, right: 320, top: 300, bottom: 320 }
  ]) {
    const layout = transitionAskLayout(anchor, 320, 500, 140);
    assert.equal(layout.width, 304);
    assert.ok(layout.left >= 8 && layout.left + layout.width <= 312);
    assert.ok(layout.arrowLeft >= 9 && layout.arrowLeft <= layout.width - 9);
    assert.ok(Math.abs(layout.left + layout.arrowLeft - (anchor.left + anchor.right) / 2) <= 9);
    assert.equal(layout.top + 140 + 9, anchor.top);
  }
});
