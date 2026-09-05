import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { computeAdjustCssVisual } from '../lib/index.js';

const serialized = vm.runInNewContext(`(${computeAdjustCssVisual.toString()})`);
for (const [section, active, identity] of [
  ['wheels', { lift: { r: 0.1 }, gain: { b: -0.2 } }, { offset: { b: 0 } }],
  ['curves', { master: [{ in: 0, out: 0 }, { in: 0.25, out: 0.15 }, { in: 1, out: 1 }] }, { r: [{ in: 0, out: 0 }, { in: 1, out: 1 }] }],
  ['hue', { sat: [{ hue: 0, value: 0 }, { hue: 1, value: 0 }] }, { sat: [{ hue: 0, value: 0.5 }] }],
]) {
  test(`CSS discloses ${section} without applying it, including after serialization`, () => {
    for (const compute of [computeAdjustCssVisual, serialized]) {
      assert.deepEqual({ ...compute({ [section]: active }) }, { filter: '', hasApproximation: true });
      assert.equal(compute({ [section]: active, sections: { [section]: false } }), null);
      assert.equal(compute({ [section]: identity }), null);
      assert.deepEqual({ ...compute({ [section]: active, basic: { exposure: 1 } }, 'blur(2px)') },
        { filter: 'brightness(2.00) blur(2px)', hasApproximation: true });
      assert.deepEqual({ ...compute({ [section]: identity }, 'blur(2px)') },
        { filter: 'blur(2px)', hasApproximation: false });
    }
  });
}

test('CSS identity uses kernel normalization and exact boundary comparisons', () => {
  for (const compute of [computeAdjustCssVisual, serialized]) {
    assert.equal(compute({ wheels: { offset: { r: 1e-12 } } })?.hasApproximation, true);
    assert.equal(compute({ wheels: { gain: { r: Infinity } } }), null);
    assert.equal(compute({ curves: { r: [{ in: 1, out: 1 }, { in: 0, out: 0.000009 }] } }), null);
    assert.equal(compute({ curves: { r: [{ in: 0, out: 1e-5 }, { in: 1, out: 1 }] } })?.hasApproximation, true);
    assert.equal(compute({ hue: { luma: [{ hue: 0, value: 0.50009 }] } }), null);
    assert.equal(compute({ hue: { luma: [{ hue: 0, value: 0.50011 }] } })?.hasApproximation, true);
    assert.equal(compute({ hue: { sat: [{ hue: 0, value: NaN }] } }), null);
    assert.equal(compute({ wheels: {}, curves: {}, hue: {} }), null);
  }
});
