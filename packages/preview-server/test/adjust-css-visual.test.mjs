import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAdjustCssVisual as sharedComputeAdjustCssVisual } from '../../edit-store/lib/index.js';

import { computeAdjustCssVisual } from '../public/edit-kernel.bundle.js';

test('public bundle: absent/disabled basic returns null', () => {
  assert.equal(computeAdjustCssVisual(undefined), null);
  assert.equal(computeAdjustCssVisual({ basic: { exposure: 1 }, sections: { basic: false } }), null);
});

test('public bundle: basic filter and transition filter are composed in order', () => {
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

test('public bundle: unsupported controls disclose approximation only while basic is active', () => {
  assert.equal(computeAdjustCssVisual({ basic: { whites: 0.1 } }).hasApproximation, true);
  assert.equal(computeAdjustCssVisual({ basic: { whites: 0 } }).hasApproximation, false);
  assert.equal(
    computeAdjustCssVisual({ basic: { whites: 0.1 }, sections: { basic: false } }),
    null,
  );
});

test('bundle exports the edit-store implementation with matching results', () => {
  assert.equal(typeof computeAdjustCssVisual, 'function');
  const samples = [undefined, null, {}, { basic: {} }, { basic: { exposure: 1, tint: 0.2 } },
    { basic: { temperature: -0.5, saturation: -0.25 } },
    { basic: { temperature: 0.5, contrast: 0.3 } },
    { basic: { exposure: 1 }, sections: { basic: false } }];
  for (const adjust of samples) {
    for (const transition of [undefined, '', 'none', 'blur(3px)']) {
      assert.deepEqual(computeAdjustCssVisual(adjust, transition), sharedComputeAdjustCssVisual(adjust, transition));
    }
  }
});
