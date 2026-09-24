import assert from 'node:assert/strict';
import test from 'node:test';
import { isInlineOverlayHtml, isSourceCompatibleWithLane } from '../src/shape-lane.mjs';

test('shape is valid on a visual lane, including a group child', () => {
  assert.equal(isSourceCompatibleWithLane('visual', 'shape'), true);
  assert.equal(isSourceCompatibleWithLane('audio', 'shape'), false);
  assert.equal(isSourceCompatibleWithLane('visual', 'group'), true);
});

test('inline SVG overlays are markup, while referenced HTML remains a file path', () => {
  assert.equal(isInlineOverlayHtml('  <svg viewBox="0 0 1 1"></svg>'), true);
  assert.equal(isInlineOverlayHtml('overlays/card.html'), false);
  assert.equal(isInlineOverlayHtml(undefined), false);
});
