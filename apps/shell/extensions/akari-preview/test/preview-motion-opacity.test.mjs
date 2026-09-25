import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDomOpacity } from '../lib/common/preview-motion-opacity.js';

test('frame-engine media uses its resolved opacity once; DOM geometry stays neutral', () => {
  assert.equal(previewDomOpacity('media', .5, true, true), '1');
  assert.equal(previewDomOpacity('media', .5, true, false), '1');
  assert.equal(previewDomOpacity('media', .5, false, false), '0.5');
  assert.equal(.5 * Number(previewDomOpacity('media', .5, true, true)), .5);
});

test('overlay runtime owns opacity when it evaluates motion', () => {
  assert.equal(previewDomOpacity('overlay', .5, true, true), null);
  assert.equal(previewDomOpacity('overlay', .5, false, true), null);
  assert.equal(previewDomOpacity('overlay', .5, true, false), '0.5');
  const resolvedOpacity = .5;
  assert.equal(previewDomOpacity('overlay', resolvedOpacity, true, true) ?? String(resolvedOpacity), '0.5');
});
