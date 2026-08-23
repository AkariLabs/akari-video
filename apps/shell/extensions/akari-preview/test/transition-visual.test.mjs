import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTransitionVisual } from '../lib/common/transition-visual.js';

test('dissolve は opacity を線形クロスする', () => {
  assert.deepEqual(
    [0, 0.5, 1].map(progress => {
      const visual = computeTransitionVisual('dissolve', progress);
      return [visual.outgoingOpacity, visual.incomingOpacity];
    }),
    [[1, 0], [0.5, 0.5], [0, 1]]
  );
});

test('fade-black / fade-white は中点で指定色 plate に沈む', () => {
  assert.deepEqual(computeTransitionVisual('fade-black', 0.5).plateColor, '#000');
  assert.deepEqual(computeTransitionVisual('fade-white', 0.5).plateColor, '#fff');
  assert.equal(computeTransitionVisual('fade-black', 0.5).plateOpacity, 1);
  assert.equal(computeTransitionVisual('fade-white', 0).plateOpacity, 0);
});

test('reveal-down / reveal-up は反対向きの clip-path ワイプになる', () => {
  assert.equal(computeTransitionVisual('reveal-down', 0.25).incomingClipPath, 'inset(0 0 75% 0)');
  assert.equal(computeTransitionVisual('reveal-up', 0.25).incomingClipPath, 'inset(75% 0 0 0)');
  assert.equal(computeTransitionVisual('reveal-down', 1).incomingClipPath, 'inset(0 0 0% 0)');
});
