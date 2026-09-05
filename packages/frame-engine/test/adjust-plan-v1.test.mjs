import assert from 'node:assert/strict';
import test from 'node:test';
import { applyItemAdjust, bakeItemAdjustLut, buildResolvedTimelinePlan, sampleLutTrilinear } from '../dist/index.js';
import { resolveAdjustLut } from '../dist/timeline/plan.js';

const sections = {
  curves: { master: [{ in: 0, out: 0 }, { in: 0.25, out: 0.15 }, { in: 0.75, out: 0.85 }, { in: 1, out: 1 }] },
  wheels: { lift: { r: 0.1 }, gain: { b: -0.2 } },
  hue: { sat: [{ hue: 0, value: 0 }, { hue: 1, value: 0 }] },
};

for (const [name, value] of Object.entries(sections)) {
  test(`plan bakes ${name}-only and bypasses only its disabled section`, () => {
    const adjust = { [name]: value };
    const lut = resolveAdjustLut(adjust);
    assert.equal(lut.size, 33);
    const rgb = [0.25, 0.5, 0.75];
    const actual = sampleLutTrilinear(lut, rgb);
    const expected = applyItemAdjust(...rgb, adjust);
    expected.forEach((v, i) => assert.ok(Math.abs(actual[i] - v) < 1e-6));
    assert.notDeepEqual(actual, rgb);
    assert.equal(resolveAdjustLut({ ...adjust, sections: { [name]: false } }), undefined);
    assert.deepEqual(resolveAdjustLut({ ...adjust, sections: { basic: false, lut: false } }).data, lut.data);

    const plan = buildResolvedTimelinePlan([{ src: 'main.mp4', in: 0, out: 1, adjust }], {
      layers: [{ src: 'layer.mp4', t: 0, duration: 1, adjust }],
    });
    assert.deepEqual(plan.cuts[0].adjustLut.data, lut.data);
    assert.deepEqual(plan.layerAdjustLuts[0].data, lut.data);
  });
}

test('plan preserves all sections with a resolved LUT and delegates order and bypass to bake', () => {
  const userLut = bakeItemAdjustLut({ basic: { saturation: -0.5 } });
  const adjust = { ...sections, basic: { exposure: -0.5 }, lut: { lut: userLut, intensity: 0.5 } };
  const view = { ...adjust, lut: { lut: 'fixture', intensity: 0.5 } };
  assert.deepEqual(resolveAdjustLut(adjust).data, bakeItemAdjustLut(view, userLut).data);
  assert.equal(resolveAdjustLut({ ...adjust, sections: { basic: false, lut: false, curves: false, wheels: false, hue: false } }), undefined);
  assert.equal(resolveAdjustLut({ curves: {}, wheels: { offset: { b: 0 } }, hue: { sat: [{ hue: 0, value: 0.5 }] } }), undefined);
  assert.equal(resolveAdjustLut({ lut: { intensity: 1 } }), undefined);
});
