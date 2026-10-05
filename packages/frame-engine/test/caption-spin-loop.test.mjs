import assert from 'node:assert/strict';
import test from 'node:test';
import { captionMotionAt } from '../dist/timeline/caption-motion.js';

test('entry rotation in the loop slot runs once and holds its final pose', () => {
  const cases = [
    { loop: { id: 'spin-in' } },
    { in: { id: 'slide-up', duration_sec: 0.4 }, loop: { id: 'spin-in' }, out: { id: 'zoom-in-out' } },
  ];
  for (const declaration of cases) {
    let previous = -Infinity;
    for (let tick = 0; tick <= 230; tick += 1) {
      const time = tick / 100;
      const angle = captionMotionAt(declaration, time, 3, 40).rotateDeg;
      assert.ok(angle + 1e-8 >= previous, `${JSON.stringify(declaration)} at ${time}: ${angle} < ${previous}`);
      previous = angle;
      if (time >= 1.6) assert.ok(Math.abs(angle) < 1e-8, `${time}: ${angle}`);
    }
  }
  const short = { loop: { id: 'spin-in', duration_sec: 0.8, ease: 'linear' } };
  assert.ok(Math.abs(captionMotionAt(short, 0.4, 3, 40).rotateDeg + 90) < 1e-8);
  assert.equal(captionMotionAt(short, 0.8, 3, 40).rotateDeg, 0);
  assert.equal(captionMotionAt(short, 2, 3, 40).scaleX, 1);
  assert.equal(captionMotionAt(short, 2, 3, 40).opacity, 1);
});

test('cyclic emphasis still repeats', () => {
  const declaration = { loop: { id: 'float' } };
  assert.ok(Math.abs(captionMotionAt(declaration, 0.4, 3, 40).translateY
    - captionMotionAt(declaration, 2, 3, 40).translateY) < 1e-10);
});
