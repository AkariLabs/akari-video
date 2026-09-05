import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import {
  applyAdjustBasic, applyAdjustWheels, applyAdjustCurves, applyAdjustHue, applyItemAdjust,
  normalizeAdjustWheels, normalizeAdjustCurves, normalizeAdjustHue,
  isAdjustWheelsIdentity, isAdjustCurvesIdentity, isAdjustHueIdentity,
  bakeItemAdjustLut, isItemAdjustIdentity, parseCube,
} from '../dist/index.js';

const identity = [{ in: 0, out: 0 }, { in: 1, out: 1 }];
const wheels = { lift: { r: 0.12, g: -0.08, b: 0.02 }, gamma: { r: 0.3, g: -0.2, b: 0.15 }, gain: { r: -0.12, g: 0.15, b: 0.05 }, offset: { r: 0.03, g: -0.02, b: 0.01 } };
const curves = { master: [{ in: 0, out: 0.02 }, { in: 0.25, out: 0.15 }, { in: 0.7, out: 0.85 }, { in: 1, out: 0.98 }], r: [{ in: 0, out: 0 }, { in: 0.4, out: 0.55 }, { in: 1, out: 1 }], b: [{ in: 0.1, out: 0.05 }, { in: 0.9, out: 0.95 }] };
const hue = { hue: [{ hue: 0, value: 0.6 }, { hue: 0.3, value: 0.35 }, { hue: 0.8, value: 0.65 }], sat: [{ hue: 0.1, value: 0.3 }, { hue: 0.6, value: 0.8 }], luma: [{ hue: 0, value: 0.45 }, { hue: 0.7, value: 0.65 }] };
const basic = { exposure: -0.2, contrast: 0.1, temperature: 0.2, tint: -0.1, saturation: -0.1, highlights: 0.1, shadows: 0.2, blacks: -0.05, whites: 0.1, vibrance: 0.25 };
function close(actual, expected, epsilon = 1e-12) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < epsilon, `${actual} != ${expected}`));
}

test('wheels: lift fixes white, gamma bends midtones, gain scales, offset translates', () => {
  close(applyAdjustWheels(0, 0.5, 1, { lift: { r: 0.2, g: 0.2, b: 0.2 } }), [0.2, 0.6, 1]);
  close(applyAdjustWheels(0.25, 0.5, 1, { gamma: { r: -0.5 } }), [0.0625, 0.5, 1]);
  close(applyAdjustWheels(0.2, 0.4, 0.8, { gain: { r: 0.5, g: 0.5, b: 0.5 } }), [0.3, 0.6, 1]);
  close(applyAdjustWheels(0.2, 0.4, 0.8, { offset: { r: 0.1, g: 0.1, b: 0.1 } }), [0.3, 0.5, 0.9]);
});

test('curves: identity, S curve interpolation, endpoints and noncommuting master then channel', () => {
  close(applyAdjustCurves(0.2, 0.4, 0.8, { master: identity }), [0.2, 0.4, 0.8]);
  const s = [{ in: 0.1, out: 0.05 }, { in: 0.3, out: 0.2 }, { in: 0.7, out: 0.8 }, { in: 0.9, out: 0.95 }];
  close(applyAdjustCurves(0, 0.5, 1, { master: s }), [0.05, 0.5, 0.95]);
  const master = [{ in: 0, out: 0.2 }, { in: 1, out: 1 }];
  const r = [{ in: 0, out: 0 }, { in: 1, out: 0.5 }];
  close(applyAdjustCurves(0.5, 0.5, 0.5, { master, r }), [0.3, 0.6, 0.6]);
  assert.notEqual(applyAdjustCurves(0.5, 0.5, 0.5, { master: r, r: master })[0], 0.3);
});

test('hue: desaturation, one-point constants, original hue lookup, and legacy full-turn formula', () => {
  close(applyAdjustHue(0.8, 0.2, 0.1, { sat: [{ hue: 0.4, value: 0 }] }), [0.8, 0.8, 0.8]);
  // Legacy formula (value - 0.5) * 2: 1.0 is +360°, 0.75 is +180°.
  close(applyAdjustHue(1, 0, 0, { hue: [{ hue: 0, value: 1 }] }), [1, 0, 0]);
  close(applyAdjustHue(1, 0, 0, { hue: [{ hue: 0, value: 0.75 }] }), [0, 1, 1]);
  close(applyAdjustHue(1, 0, 0, { hue: [{ hue: 0, value: 0.75 }], sat: [{ hue: 0, value: 0 }, { hue: 0.5, value: 1 }], luma: [{ hue: 0, value: 0.25 }, { hue: 0.5, value: 1 }] }), [0.5, 0.5, 0.5]);
});

test('normalization is nonmutating, sorted, clamped and fills omitted defaults', () => {
  const input = { master: [{ in: 2, out: 2 }, { in: -1, out: -1 }] };
  assert.deepEqual(normalizeAdjustCurves(input).master, identity);
  assert.equal(input.master[0].in, 2);
  assert.equal(normalizeAdjustWheels({ lift: { r: 2 }, offset: { b: -2 } }).lift.r, 0.25);
  assert.equal(normalizeAdjustWheels({ offset: { b: -2 } }).offset.b, -0.1);
  assert.equal(normalizeAdjustWheels(null).gamma.g, 0);
  assert.deepEqual(normalizeAdjustHue({ sat: [{ hue: 2, value: -1 }, { hue: -1, value: 2 }] }).sat, [{ hue: 0, value: 1 }, { hue: 1, value: 0 }]);
  assert.equal(isAdjustWheelsIdentity({ lift: { r: 1e-10 } }), false);
  assert.equal(isAdjustCurvesIdentity({ master: [{ in: 0, out: 1e-5 }, { in: 1, out: 1 }] }), false);
  assert.equal(isAdjustCurvesIdentity({ master: [{ in: 0, out: 0 }, { in: 0.5, out: 0.5 }, { in: 1, out: 1 }] }), false);
  assert.equal(isAdjustHueIdentity({ hue: [{ hue: 0, value: 0.50005 }] }), true);
  assert.equal(isAdjustHueIdentity({ hue: [{ hue: 0, value: 0.5002 }] }), false);
});

test('all section bypasses and fixed basic -> LUT mix -> wheels -> curves -> hue order', () => {
  const adjust = { basic, wheels, curves, hue, lut: { lut: 'test', intensity: 0.3 } };
  const sampler = (r, g, b) => [b, r, g];
  const rgb = [0.2, 0.4, 0.8];
  let expected = applyAdjustBasic(...rgb, basic);
  const lutted = sampler(...expected);
  expected = expected.map((v, i) => v + (lutted[i] - v) * 0.3);
  expected = applyAdjustHue(...applyAdjustCurves(...applyAdjustWheels(...expected, wheels), curves), hue);
  close(applyItemAdjust(...rgb, adjust, sampler), expected);
  close(applyItemAdjust(...rgb, { ...adjust, sections: { basic: false, lut: false, wheels: false, curves: false, hue: false } }, sampler), rgb);
  for (const section of ['basic', 'lut', 'wheels', 'curves', 'hue']) {
    const removed = { ...adjust }; delete removed[section];
    close(applyItemAdjust(...rgb, { ...adjust, sections: { [section]: false } }, sampler), applyItemAdjust(...rgb, removed, sampler));
  }
});

test('effective identity truth table and memo keys include each new section and bypass', () => {
  for (const neutral of [undefined, null, {}, { lut: null }, { lut: { lut: 'x', intensity: 0 } }, { wheels: {}, curves: { master: identity }, hue: {} }]) assert.equal(isItemAdjustIdentity(neutral), true);
  for (const [section, value] of Object.entries({ basic, wheels, curves, hue, lut: { lut: 'x' } })) {
    assert.equal(isItemAdjustIdentity({ [section]: value }), false);
    assert.equal(isItemAdjustIdentity({ [section]: value, sections: { [section]: false } }), true);
    const first = bakeItemAdjustLut({}, undefined, 3);
    const changed = bakeItemAdjustLut({ [section]: value }, undefined, 3);
    assert.notStrictEqual(first, changed);
    assert.strictEqual(changed, bakeItemAdjustLut({ [section]: structuredClone(value) }, undefined, 3));
    const bypass = bakeItemAdjustLut({ [section]: value, sections: { [section]: false } }, undefined, 3);
    assert.notStrictEqual(bypass, changed);
    assert.deepEqual(bypass.data, first.data);
  }
});

// Read-only live oracle. Set AKARI_LEGACY_ROOT on machines with the legacy checkout.
const legacyRoot = process.env.AKARI_LEGACY_ROOT;
const legacyPath = legacyRoot ? join(legacyRoot, 'src/lib/color-grade.ts') : undefined;
const legacy = legacyPath && existsSync(legacyPath)
  ? await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(legacyPath, 'utf8'))).toString('base64'))
  : undefined;
for (const [name, adjust] of Object.entries({ wheels: { wheels }, curves: { curves }, hue: { hue }, combined: { basic, wheels, curves, hue } })) {
  test(`legacy bake ${name}: all 35937 points / 107811 components match at six decimals`, { skip: legacy ? false : 'AKARI_LEGACY_ROOT read-only checkout is unavailable' }, () => {
    const params = { ...legacy.DEFAULT_COLOR_GRADE_PARAMS, ...adjust.basic };
    for (const [wheel, channels] of Object.entries(adjust.wheels ?? {})) for (const [channel, value] of Object.entries(channels)) params[wheel + '_' + channel] = value;
    const oldCurves = adjust.curves ? { master: identity, r: identity, g: identity, b: identity, ...adjust.curves } : undefined;
    const oldHue = adjust.hue ? { hue: [], sat: [], luma: [], ...adjust.hue } : undefined;
    const text = legacy.bakeCubeLut(params, undefined, 33, oldCurves, oldHue);
    const parsed = parseCube(text);
    const current = bakeItemAdjustLut(adjust);
    assert.equal(current.data.length, 35937 * 3);
    for (let i = 0; i < current.data.length; i++) assert.equal(current.data[i].toFixed(6), parsed.data[i].toFixed(6), `${name} component ${i}`);
    assert.deepEqual(current.data, parsed.data);
  });
}
