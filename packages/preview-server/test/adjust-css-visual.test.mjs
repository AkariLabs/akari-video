import assert from 'node:assert/strict';
import test from 'node:test';

import { computeAdjustCssVisual } from '../public/adjust-css-visual.js';

test('public mirror: absent/disabled basic returns null', () => {
  assert.equal(computeAdjustCssVisual(undefined), null);
  assert.equal(computeAdjustCssVisual({ basic: { exposure: 1 }, sections: { basic: false } }), null);
});

test('public mirror: basic filter and transition filter are composed in order', () => {
  assert.deepEqual(
    computeAdjustCssVisual(
      { basic: { exposure: 1, contrast: 0.25, saturation: -0.5, temperature: -0.5 } },
      'blur(3px)',
    ),
    {
      filter: 'brightness(2.00) contrast(1.25) saturate(0.50) hue-rotate(10deg) blur(3px)',
      hasApproximation: false,
    },
  );
  assert.equal(computeAdjustCssVisual({ basic: {} }, 'blur(3px)').filter, 'blur(3px)');
});

test('public mirror: unsupported controls disclose approximation only while basic is active', () => {
  assert.equal(computeAdjustCssVisual({ basic: { whites: 0.1 } }).hasApproximation, true);
  assert.equal(computeAdjustCssVisual({ basic: { whites: 0 } }).hasApproximation, false);
  assert.equal(
    computeAdjustCssVisual({ basic: { whites: 0.1 }, sections: { basic: false } }),
    null,
  );
});
