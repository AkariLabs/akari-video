import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaptionAnimation } from '../src/captions.mjs';

test('entry rotation in loop plays once while cyclic emphasis remains infinite', () => {
  for (const id of ['spin-in', 'rotate-in', 'roll-in', 'spiral-in']) {
    const css = buildCaptionAnimation({ loop: { id } }, 3).animationCss;
    assert.equal(css, `akari-anim-${id} 1.6s ease-out 0s 1 normal both paused`);
    assert.doesNotMatch(css, /infinite/u);
  }
  assert.equal(buildCaptionAnimation({ loop: { id: 'spin-in', duration_sec: 0.8, ease: 'linear' } }, 3).animationCss,
    'akari-anim-spin-in 0.8s linear 0s 1 normal both paused');
  assert.equal(buildCaptionAnimation({ loop: { id: 'float' } }, 3).animationCss,
    'akari-anim-float 1.6s linear 0s infinite both paused');
});
