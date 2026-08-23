import assert from 'node:assert/strict';
import test from 'node:test';

import { transitionVisualState } from '../public/transition-visual.js';

test('all five transition enums produce a deterministic window visual', () => {
  assert.deepEqual(transitionVisualState('dissolve', 0.5), {
    videoOpacity: 0.5, clipPath: 'none', plateOpacity: 0, plateVisible: false,
  });
  assert.equal(transitionVisualState('fade-black', 0.5).plateColor, '#000');
  assert.equal(transitionVisualState('fade-white', 0.5).plateColor, '#fff');
  assert.equal(transitionVisualState('reveal-down', 0.5).clipPath, 'inset(0 0 50% 0)');
  assert.equal(transitionVisualState('reveal-up', 0.5).clipPath, 'inset(50% 0 0 0)');
});
