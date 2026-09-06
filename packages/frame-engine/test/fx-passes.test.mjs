import assert from 'node:assert/strict';
import test from 'node:test';
import { planFxPasses, fxWorkingSize, fxGaussianGeometry, fxGaussianWeights } from '../dist/compositor/fx-passes.js';
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
  for (const [px, divisor] of [[8, 1], [16, 1], [17, 2], [20, 2], [30, 2], [50, 4]]) {
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

test('precomputed Gaussian matches the previous normalized kernel, including fractional and zero radii', () => {
  for (const radius of [0, 0.01, 0.5, 1, 2.25, 8, 10, 15.9, 16]) {
    const { weights, tapCount } = fxGaussianWeights(radius);
    assert.equal(weights.length, 17);
    assert.equal(tapCount, Math.ceil(radius));
    const reference = [1, ...Array.from({ length: tapCount }, (_, i) => Math.exp(-0.5 * ((i + 1) / (radius / 2)) ** 2))];
    const total = reference[0] + 2 * reference.slice(1).reduce((sum, value) => sum + value, 0);
    for (let tap = 0; tap < weights.length; tap++) {
      assert.ok(Math.abs(weights[tap] - (reference[tap] ?? 0) / total) < 1e-7);
      assert.ok(weights[tap] >= 0);
      if (tap) assert.ok(weights[tap] <= weights[tap - 1]);
    }
    assert.ok(Math.abs(weights[0] + 2 * weights.slice(1).reduce((sum, value) => sum + value, 0) - 1) < 1e-7);
    // Convolving a hard edge has no negative steps, including after RGBA8 rounding.
    const profile = Array.from({ length: 65 }, (_, x) => {
      let sum = 0;
      for (let tap = -tapCount; tap <= tapCount; tap++) if (x + tap >= 32) sum += weights[Math.abs(tap)];
      return Math.round(sum * 255);
    });
    assert.ok(profile.every((value, i) => !i || value >= profile[i - 1]));
  }
});
