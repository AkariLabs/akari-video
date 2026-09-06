import assert from 'node:assert/strict';
import test from 'node:test';
import { planFxPasses, fxWorkingSize, fxGaussianGeometry } from '../dist/compositor/fx-passes.js';
import { normalizeAdjustFx } from '../dist/adjust/fx.js';

test('pass planner expands each effect to the contract pass count', () => {
  assert.deepEqual(planFxPasses([]), []);
  for (const [id, count] of Object.entries({ vignette: 1, grain: 1, sharpen: 1, blur: 2,
    glow: 4, clarity: 3, dehaze: 1, denoise: 1, motion_blur: 1 })) {
    assert.equal(planFxPasses(normalizeAdjustFx([{ id }])).length, count, id);
  }
});

test('group two stages preserve order and omit zero-strength composites', () => {
  assert.deepEqual(planFxPasses(normalizeAdjustFx(['glow', 'clarity', 'dehaze', 'denoise', 'motion_blur'].map(id => ({ id }))))
    .map(pass => pass.stage), ['bright-pass', 'gaussian-h', 'gaussian-v', 'glow-composite',
      'gaussian-h', 'gaussian-v', 'clarity-composite', 'dehaze', 'denoise', 'motion-blur']);
  assert.deepEqual(planFxPasses(normalizeAdjustFx([{ id: 'glow', intensity: 0 }, { id: 'clarity', amount: 0 },
    { id: 'dehaze', amount: 0 }, { id: 'denoise', amount: 0 }, { id: 'motion_blur', px: 0 }])), []);
});

test('pass planner is pure, preserves declaration order and skips zero strength', () => {
  const fx = Object.freeze([
    Object.freeze({ id: 'grain', amount: 0.3, size: 1 }),
    Object.freeze({ id: 'blur', px: 8 }), Object.freeze({ id: 'sharpen', amount: 0 }),
    Object.freeze({ id: 'vignette', amount: -0.5 }),
  ]);
  const result = planFxPasses(fx);
  assert.deepEqual(result.map(pass => pass.stage), ['grain', 'gaussian-h', 'gaussian-v', 'vignette']);
  assert.deepEqual(result, planFxPasses(fx));
  assert.deepEqual(result.map(pass => pass.effect), [fx[0], fx[1], fx[1], fx[3]]);
  assert.deepEqual(planFxPasses([{ id: 'blur', px: 0 }]), []);
});

test('work size is the crop texel size capped independently by output bounds', () => {
  const output = { width: 1920, height: 1080 };
  assert.deepEqual(fxWorkingSize({ width: 3840, height: 2160 }, { x: 0, y: 0, width: 1, height: 1 }, output), output);
  assert.deepEqual(fxWorkingSize({ width: 3840, height: 2160 }, { x: 0.25, y: 0, width: 0.25, height: 0.25 }, output), { width: 960, height: 540 });
  assert.deepEqual(fxWorkingSize({ width: 1920, height: 1080 }, { x: 0, y: 0, width: 0.0001, height: 0.0001 }, output), { width: 1, height: 1 });
});

test('Gaussian geometry converts output pixels and reduces large radii within 33 dense taps', () => {
  const work = { width: 1920, height: 1080 };
  for (const [px, divisor] of [[8, 1], [16, 1], [17, 2], [30, 2], [50, 4]]) {
    const result = fxGaussianGeometry(px, 1920, work, work);
    assert.deepEqual(result.reduced, { width: work.width / divisor, height: work.height / divisor });
    assert.equal(result.radiusX, px / divisor);
    assert.equal(result.radiusY, px / divisor);
    assert.ok(2 * Math.ceil(result.radiusX) + 1 <= 33);
  }
  const scaled = fxGaussianGeometry(8, 960, { width: 960, height: 540 }, work);
  assert.equal(scaled.radiusX, 2);
  assert.equal(scaled.radiusY, 2);
});
