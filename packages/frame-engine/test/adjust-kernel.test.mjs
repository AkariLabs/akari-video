import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADJUST_CONSTANTS,
  applyAdjustBasic,
  isAdjustBasicIdentity,
  normalizeAdjustBasic,
} from '../dist/index.js';

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function assertRgbClose(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, 3);
  for (let channel = 0; channel < 3; channel += 1) {
    assertClose(actual[channel], expected[channel], tolerance);
  }
}

test('normalization clamps every basic parameter and identity uses the 1e-6 threshold', () => {
  assert.deepEqual(normalizeAdjustBasic({ exposure: 4, contrast: -2, temperature: Number.NaN }), {
    exposure: 3,
    contrast: -1,
    highlights: 0,
    shadows: 0,
    blacks: 0,
    whites: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
  });
  assert.equal(isAdjustBasicIdentity({}), true);
  assert.equal(isAdjustBasicIdentity({ exposure: ADJUST_CONSTANTS.IDENTITY_EPSILON }), true);
  assert.equal(isAdjustBasicIdentity({ exposure: ADJUST_CONSTANTS.IDENTITY_EPSILON * 1.01 }), false);
});

test('identity, exposure, white balance, and contrast follow the numeric contract', () => {
  assertRgbClose(applyAdjustBasic(0.2, 0.3, 0.4, {}), [0.2, 0.3, 0.4]);
  assertRgbClose(applyAdjustBasic(0.2, 0.3, 0.4, { exposure: 1 }), [0.4, 0.6, 0.8]);
  assertRgbClose(applyAdjustBasic(0.5, 0.5, 0.5, { temperature: 1 }), [0.59, 0.5, 0.41]);
  assertRgbClose(applyAdjustBasic(0.5, 0.5, 0.5, { temperature: -1 }), [0.41, 0.5, 0.59]);
  assertRgbClose(applyAdjustBasic(0.5, 0.5, 0.5, { contrast: 0.8 }), [0.5, 0.5, 0.5]);
});

test('tone-zone smoothstep masks hold at and outside every boundary', () => {
  assertRgbClose(applyAdjustBasic(0.49, 0.49, 0.49, { highlights: -0.5 }), [0.49, 0.49, 0.49]);
  assertRgbClose(applyAdjustBasic(0.5, 0.5, 0.5, { highlights: -0.5 }), [0.5, 0.5, 0.5]);
  assertRgbClose(applyAdjustBasic(0.7, 0.7, 0.7, { highlights: -0.5 }), [0.525, 0.525, 0.525]);
  assertRgbClose(applyAdjustBasic(0.9, 0.9, 0.9, { highlights: -0.5 }), [0.45, 0.45, 0.45]);
  assertRgbClose(applyAdjustBasic(0.91, 0.91, 0.91, { highlights: -0.5 }), [0.455, 0.455, 0.455]);

  assertRgbClose(applyAdjustBasic(0.09, 0.09, 0.09, { shadows: -0.5 }), [0.045, 0.045, 0.045]);
  assertRgbClose(applyAdjustBasic(0.1, 0.1, 0.1, { shadows: -0.5 }), [0.05, 0.05, 0.05]);
  assertRgbClose(applyAdjustBasic(0.5, 0.5, 0.5, { shadows: -0.5 }), [0.5, 0.5, 0.5]);
  assertRgbClose(applyAdjustBasic(0.51, 0.51, 0.51, { shadows: -0.5 }), [0.51, 0.51, 0.51]);

  assertRgbClose(applyAdjustBasic(0.69, 0.69, 0.69, { whites: -0.5 }), [0.69, 0.69, 0.69]);
  assertRgbClose(applyAdjustBasic(0.7, 0.7, 0.7, { whites: -0.5 }), [0.7, 0.7, 0.7]);
  assertRgbClose(applyAdjustBasic(1, 1, 1, { whites: -0.5 }), [0.85, 0.85, 0.85]);

  assertRgbClose(applyAdjustBasic(0, 0, 0, { blacks: 0.5 }), [0.15, 0.15, 0.15]);
  assertRgbClose(applyAdjustBasic(0.3, 0.3, 0.3, { blacks: 0.5 }), [0.3, 0.3, 0.3]);
  assertRgbClose(applyAdjustBasic(0.31, 0.31, 0.31, { blacks: 0.5 }), [0.31, 0.31, 0.31]);
});

test('saturation -1 produces Rec.709 gray and vibrance protects saturated colors', () => {
  const expectedLuma = 0.2 * ADJUST_CONSTANTS.REC709_R
    + 0.4 * ADJUST_CONSTANTS.REC709_G
    + 0.8 * ADJUST_CONSTANTS.REC709_B;
  assertRgbClose(applyAdjustBasic(0.2, 0.4, 0.8, { saturation: -1 }), [
    expectedLuma,
    expectedLuma,
    expectedLuma,
  ]);

  const saturated = applyAdjustBasic(1, 0.1, 0, { vibrance: 1 });
  assertRgbClose(saturated, [1, 0.1, 0]);
  const muted = applyAdjustBasic(0.5, 0.45, 0.4, { vibrance: 1 });
  assert.ok(muted[0] - muted[2] > 0.5 - 0.4);
});

test('representative values match the read-only legacy applyColorGrade implementation', () => {
  const cases = [
    // Legacy actual (2026-09-03): [0.3879358549894388, 0.998439910862395, 0.998439910862395]
    { rgb: [0.18, 0.5, 0.82], basic: { exposure: 0.75, contrast: 0.2, saturation: -0.15, temperature: 0.4, tint: -0.3, highlights: 0.25, shadows: -0.2, whites: 0.1, blacks: -0.15, vibrance: 0.35 }, expected: [0.3879358549894388, 0.998439910862395, 0.998439910862395] },
    // Legacy actual (2026-09-03): [0.2588663273249595, 0.2893561707509992, 0.36859173058998007]
    { rgb: [0.02, 0.08, 0.2], basic: { exposure: -1.25, contrast: -0.35, saturation: 0.5, temperature: -0.7, tint: 0.5, highlights: -0.4, shadows: 0.6, whites: -0.2, blacks: 0.45, vibrance: -0.3 }, expected: [0.2588663273249595, 0.2893561707509992, 0.36859173058998007] },
    // Legacy actual (2026-09-03): [0.5578782136973389, 0.41402819257372603, 0]
    { rgb: [0.95, 0.72, 0.4], basic: { exposure: 0.3, contrast: 0.65, saturation: 0.25, temperature: 0.8, tint: 0.2, highlights: -0.5, shadows: 0.15, whites: 0.3, blacks: -0.1, vibrance: 0.75 }, expected: [0.5578782136973389, 0.41402819257372603, 0] },
    // Legacy actual (2026-09-03): [0.5, 0.5, 0.5]
    { rgb: [0.5, 0.5, 0.5], basic: { exposure: 0, contrast: 0.5, saturation: -0.4, temperature: 0, tint: 0, highlights: 0.8, shadows: 0.8, whites: 0.8, blacks: 0.8, vibrance: 0.8 }, expected: [0.5, 0.5, 0.5] },
    // Legacy actual (2026-09-03): [0.4, 0.4, 0.4]
    { rgb: [0.9, 0.1, 0.4], basic: { exposure: -0.5, contrast: -0.8, saturation: -1, temperature: 1, tint: -1, highlights: 1, shadows: -1, whites: 1, blacks: -1, vibrance: 1 }, expected: [0.4, 0.4, 0.4] },
    // Legacy actual (2026-09-03): [0, 0.21717246101317578, 0.21717246101317578]
    { rgb: [0.1, 0.9, 0.3], basic: { exposure: 1.5, contrast: 1, saturation: 1, temperature: -1, tint: 1, highlights: -1, shadows: 1, whites: -1, blacks: 1, vibrance: -1 }, expected: [0, 0.21717246101317578, 0.21717246101317578] },
    // Legacy actual (2026-09-03): [0.1170661848777969, 0.13794832191662199, 0.15451001680948323]
    { rgb: [0.001, 0.002, 0.003], basic: { exposure: 3, contrast: 0.1, saturation: 0.2, temperature: 0.25, tint: -0.25, highlights: 0.2, shadows: 0.3, whites: 0.4, blacks: 0.5, vibrance: 0.6 }, expected: [0.1170661848777969, 0.13794832191662199, 0.15451001680948323] },
    // Legacy actual (2026-09-03): [0, 0, 0]
    { rgb: [1, 0, 1], basic: { exposure: -3, contrast: 0.4, saturation: 0.7, temperature: -0.4, tint: 0.9, highlights: 0.9, shadows: -0.9, whites: 0.9, blacks: -0.9, vibrance: 0.9 }, expected: [0, 0, 0] },
  ];

  for (const { rgb, basic, expected } of cases) {
    assertRgbClose(applyAdjustBasic(rgb[0], rgb[1], rgb[2], basic), expected);
  }
});
