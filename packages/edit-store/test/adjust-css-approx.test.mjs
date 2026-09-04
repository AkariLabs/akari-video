import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { adjustBasicToCssApprox } from '../lib/index.js';

test('each supported basic adjustment maps to the legacy CSS approximation', () => {
  assert.equal(adjustBasicToCssApprox({ exposure: 1 }), 'brightness(2.00)');
  assert.equal(adjustBasicToCssApprox({ contrast: 0.25 }), 'contrast(1.25)');
  assert.equal(adjustBasicToCssApprox({ saturation: -0.5 }), 'saturate(0.50)');
  assert.equal(adjustBasicToCssApprox({ temperature: 0.5 }), 'sepia(0.15)');
  assert.equal(adjustBasicToCssApprox({ temperature: -0.5 }), 'hue-rotate(10deg)');
  assert.equal(
    adjustBasicToCssApprox({ exposure: -1, contrast: 0.2, saturation: 0.3, temperature: -0.25 }),
    'brightness(0.50) contrast(1.20) saturate(1.30) hue-rotate(5deg)',
  );
});

test('the 0.005 threshold is exclusive and unsupported fields never enter the string', () => {
  assert.equal(adjustBasicToCssApprox({ exposure: 0.005, contrast: -0.005, temperature: 0.0049 }), '');
  assert.equal(adjustBasicToCssApprox({
    tint: 1,
    highlights: 1,
    shadows: -1,
    blacks: 1,
    whites: -1,
    vibrance: 1,
  }), '');
  assert.equal(adjustBasicToCssApprox({ exposure: 1, tint: 1, vibrance: 1 }), 'brightness(2.00)');
});

test('the function remains self-contained when serialized into a webview', () => {
  const serialized = vm.runInNewContext(`(${adjustBasicToCssApprox.toString()})`);
  assert.equal(serialized({ exposure: 1, temperature: -0.5 }), 'brightness(2.00) hue-rotate(10deg)');
});
