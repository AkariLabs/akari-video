import assert from 'node:assert/strict';
import test from 'node:test';
import { easeValue, motionVisualAt, MOTION_IN_OUT_PRESETS, MOTION_LOOP_PRESETS } from '../dist/index.js';

const near = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const identity = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };

test('motion preset inventories match the v0 vocabulary', () => {
  assert.deepEqual(MOTION_IN_OUT_PRESETS, ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale', 'wipe']);
  assert.deepEqual(MOTION_LOOP_PRESETS, ['pulse', 'float', 'spin']);
});

for (const [preset, property, hidden, middle, visible] of [
  ['fade', 'opacity', 0, 0.5, 1],
  ['slide-up', 'dy', 40, 20, 0],
  ['slide-down', 'dy', -40, -20, 0],
  ['slide-left', 'dx', 40, 20, 0],
  ['slide-right', 'dx', -40, -20, 0],
  ['scale', 'scale', 0.8, 0.9, 1],
  ['wipe', 'reveal', 0, 0.5, 1],
]) {
  const value = visual => property === 'reveal' ? visual.reveal.w : visual[property];
  test(`${preset} in holds start, midpoint and completed endpoint`, () => {
    const motion = { in: { preset, duration: 12 } };
    for (const [t, expected] of [[0, hidden], [0.2, middle], [0.4, visible], [2, visible]]) {
      near(value(motionVisualAt(motion, t, 3, 30)), expected);
    }
  });
  test(`${preset} out holds before start, midpoint and completed endpoint`, () => {
    const motion = { out: { preset, duration: 12 } };
    for (const [t, expected] of [[0, visible], [2.6, visible], [2.8, middle], [3, hidden]]) {
      near(value(motionVisualAt(motion, t, 3, 30)), expected);
    }
  });
}

test('out duration converts frames to seconds without frame rounding', () => {
  near(motionVisualAt({ out: { preset: 'fade', duration: 8 } }, 2.9, 3, 30).opacity, 0.375);
  near(motionVisualAt({ out: { preset: 'fade', duration: 12 } }, 2.9, 3, 30).opacity, 0.25);
});

for (const [preset, property, expected] of [
  ['pulse', 'scale', [1, 1.05, 1, 0.95, 1]],
  ['float', 'dy', [0, 6, 0, -6, 0]],
  ['spin', 'rotate', [0, 90, 180, 270, 0]],
]) {
  test(`${preset} loop follows quarter-cycle phases and repeats`, () => {
    const motion = { loop: { preset, period: 60 } };
    expected.forEach((value, index) => near(motionVisualAt(motion, index / 2, 5, 30)[property], value));
  });
}

test('explicit amounts, reverse spin and loop easing are applied', () => {
  near(motionVisualAt({ in: { preset: 'slide-up', duration: 12, amount: 100 } }, 0.2, 3, 30).dy, 50);
  near(motionVisualAt({ loop: { preset: 'spin', period: 60, amount: -1 } }, 0.5, 3, 30).rotate, -90);
  near(motionVisualAt({ loop: { preset: 'spin', period: 60, ease: 'in-quad' } }, 1, 3, 30).rotate, 90);
  near(motionVisualAt({ in: { preset: 'slide-up', duration: 12, amount: 0 } }, 0, 3, 30).dy, 0);
});

test('fade in and pulse loop multiply their respective visual properties', () => {
  const actual = motionVisualAt({ in: { preset: 'fade', duration: 30 }, loop: { preset: 'pulse', period: 60 } }, 0.5, 3, 30);
  assert.deepEqual(actual, { ...identity, opacity: 0.5, scale: 1.05 });
});

test('overlapping seats add translations and multiply scale and opacity', () => {
  near(motionVisualAt({ in: { preset: 'slide-up', duration: 60 }, out: { preset: 'slide-up', duration: 60 },
    loop: { preset: 'float', period: 120 } }, 1, 2, 30).dy, 46);
  near(motionVisualAt({ in: { preset: 'scale', duration: 60 }, out: { preset: 'scale', duration: 60 },
    loop: { preset: 'pulse', period: 120 } }, 1, 2, 30).scale, 0.9 * 0.9 * 1.05);
  near(motionVisualAt({ in: { preset: 'fade', duration: 60 }, out: { preset: 'fade', duration: 60 } }, 1, 2, 30).opacity, 0.25);
});

test('overlapping wipes intersect rather than multiply reveal widths', () => {
  const motion = { in: { preset: 'wipe', duration: 60 }, out: { preset: 'wipe', duration: 60 } };
  assert.deepEqual(motionVisualAt(motion, 1, 2, 30).reveal, { x: 0, y: 0, w: 0.5, h: 1 });
});

test('unknown presets and presets in the wrong seat are ignored', () => {
  for (const motion of [undefined, null, {}, { in: { preset: 'future', duration: 12 } },
    { in: { preset: 'pulse', duration: 12 } }, { loop: { preset: 'fade', period: 30 } }]) {
    assert.equal(motionVisualAt(motion, 0.2, 3, 30), null);
  }
});

test('nonpositive and nonfinite spans are ignored independently', () => {
  for (const span of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(motionVisualAt({ in: { preset: 'fade', duration: span }, out: { preset: 'fade', duration: span },
      loop: { preset: 'pulse', period: span } }, 0.2, 3, 30), null);
    near(motionVisualAt({ in: { preset: 'fade', duration: span }, loop: { preset: 'float', period: 24 } }, 0.2, 3, 30).dy, 6);
  }
});

test('out-cubic, unknown easing and hold have their contracted values', () => {
  near(easeValue('out-cubic', 0.5), 0.875);
  near(easeValue('future', 0.25), 0.25);
  near(easeValue(undefined, 0.25), 0.25);
  for (const u of [-1, 0, 0.5, 0.999]) assert.equal(easeValue('hold', u), 0);
  for (const u of [1, 2]) assert.equal(easeValue('hold', u), 1);
  near(motionVisualAt({ in: { preset: 'slide-up', duration: 12, ease: 'out-cubic' } }, 0.2, 3, 30).dy, 5);
});

test('all easing presets preserve endpoints and evaluate interior samples', () => {
  const samples = {
    linear: 0.25, 'ease-in-out': 0.0625,
    'in-quad': 0.0625, 'out-quad': 0.4375, 'in-out-quad': 0.125,
    'in-cubic': 0.015625, 'out-cubic': 0.578125, 'in-out-cubic': 0.0625,
    'in-quart': 0.00390625, 'out-quart': 0.68359375, 'in-out-quart': 0.03125,
    'in-expo': 0.005524271728019902, 'out-expo': 0.8232233047033631, 'in-out-expo': 0.015625,
    'in-back': -0.0641365625, 'out-back': 0.8174096875, 'in-out-back': -0.09968184375,
    'out-bounce': 0.47265625, 'out-elastic': 0.9116116523516816,
  };
  for (const [name, expected] of Object.entries(samples)) {
    assert.equal(easeValue(name, 0), 0, name);
    assert.equal(easeValue(name, 1), 1, name);
    near(easeValue(name, 0.25), expected);
  }
});

test('cubic-bezier numerically solves x before evaluating y to 1e-4', () => {
  near(easeValue('cubic-bezier(0.25, 0.1, 0.25, 1)', 0.5), 0.802403387584857, 1e-4);
  for (const u of [0, 1e-8, 0.2, 0.5, 0.8, 0.999999, 1]) {
    near(easeValue('cubic-bezier(0, 0, 0, 1)', u), 3 * u ** (2 / 3) - 2 * u, 1e-4);
    near(easeValue('cubic-bezier(1, 0, 0, 1)', u), 3 * (0.5 + Math.cbrt((u - 0.5) / 4)) ** 2
      - 2 * (0.5 + Math.cbrt((u - 0.5) / 4)) ** 3, 1e-4);
  }
  near(easeValue('cubic-bezier(-1, 0, 0, 1)', 0.25), 0.25);
  near(easeValue('cubic-bezier(0, nope, 0, 1)', 0.25), 0.25);
});

test('back easing overshoots transforms but opacity and reveal stay in range', () => {
  const motion = { in: { preset: 'slide-up', duration: 30, ease: 'out-back' } };
  assert.ok(motionVisualAt(motion, 0.75, 3, 30).dy < 0);
  for (const preset of ['fade', 'wipe']) {
    const visual = motionVisualAt({ in: { preset, duration: 30, ease: 'out-back' } }, 0.75, 3, 30);
    assert.equal(preset === 'fade' ? visual.opacity : visual.reveal.w, 1);
  }
});

test('evaluation is pure and invalid clocks do not produce visual NaNs', () => {
  const motion = Object.freeze({ in: Object.freeze({ preset: 'slide-up', duration: 12, amount: Infinity }) });
  const first = motionVisualAt(motion, 0.2, 3, 30);
  near(first.dy, 20);
  motionVisualAt(motion, 0, 3, 30);
  assert.deepEqual(motionVisualAt(motion, 0.2, 3, 30), first);
  for (const args of [[NaN, 3, 30], [0, Infinity, 30], [0, 3, 0], [0, 3, Infinity]]) {
    assert.equal(motionVisualAt(motion, ...args), null);
  }
});
