import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { computeAdjustCssVisual } from '../lib/index.js';

const serialized = vm.runInNewContext(`(${computeAdjustCssVisual.toString()})`);

for (const [name, compute] of [['native', computeAdjustCssVisual], ['serialized', serialized]]) {
  test(`CSS fx blur uses fixed two-decimal pixels and blurScale (${name})`, () => {
    const adjust = { fx: [{ id: 'blur', px: 8 }] };
    assert.deepEqual({ ...compute(adjust) }, { filter: 'blur(8.00px)', hasApproximation: false });
    assert.deepEqual({ ...compute(adjust, undefined, 0.5) }, { filter: 'blur(4.00px)', hasApproximation: false });
    for (const scale of [NaN, Infinity, -Infinity, null, '0.5']) {
      assert.equal(compute(adjust, undefined, scale)?.filter, 'blur(8.00px)');
    }
  });

  test(`CSS bypasses the entire fx section (${name})`, () => {
    const fx = [{ id: 'blur', px: 8 }];
    assert.equal(compute({ fx, sections: { fx: false } }), null);
    fx.push({ id: 'vignette' });
    assert.equal(compute({ fx, sections: { fx: false } }), null);
    assert.deepEqual({ ...compute({ basic: { exposure: 1 }, fx, sections: { fx: false } }, 'opacity(0.5)') },
      { filter: 'brightness(2.00) opacity(0.5)', hasApproximation: false });
  });

  test(`CSS discloses every non-blur fx without applying it (${name})`, () => {
    for (const id of ['vignette', 'future-effect']) {
      assert.deepEqual({ ...compute({ fx: [{ id }] }) }, { filter: '', hasApproximation: true });
      for (const fx of [[{ id: 'blur', px: 8 }, { id }], [{ id }, { id: 'blur', px: 8 }]]) {
        assert.deepEqual({ ...compute({ fx }) }, { filter: 'blur(8.00px)', hasApproximation: true });
      }
    }
  });

  test(`CSS orders basic before blur before transition (${name})`, () => {
    assert.deepEqual({ ...compute({ basic: { exposure: 1 }, fx: [{ id: 'blur', px: 8 }] }, 'opacity(0.5)') },
      { filter: 'brightness(2.00) blur(8.00px) opacity(0.5)', hasApproximation: false });
  });

  test(`CSS defaults omitted or invalid blur pixels to contract §2's 8 (${name})`, () => {
    for (const effect of [
      { id: 'blur' }, { id: 'blur', px: NaN },
      { id: 'blur', px: Infinity }, { id: 'blur', px: '8' },
    ]) {
      assert.deepEqual({ ...compute({ fx: [effect] }) }, { filter: 'blur(8.00px)', hasApproximation: false });
    }
    assert.deepEqual({ ...compute({ fx: [{ id: 'blur' }] }, undefined, 0.5) },
      { filter: 'blur(4.00px)', hasApproximation: false });
  });

  test(`CSS omits only finite non-positive blur pixels but retains the fx filter seat (${name})`, () => {
    // 非空 fx は有限で 0 以下の blur 値だけでも null ではなく空 filter・hasApproximation: false を返す規範。
    for (const effect of [
      { id: 'blur', px: 0 }, { id: 'blur', px: -1 },
    ]) {
      assert.deepEqual({ ...compute({ fx: [effect] }) }, { filter: '', hasApproximation: false });
    }
  });

  test(`CSS empty or non-array fx leaves the filter seat untouched (${name})`, () => {
    for (const fx of [undefined, null, [], {}, 'blur']) {
      assert.equal(compute({ fx }), null);
    }
    assert.equal(compute({ wheels: {}, curves: {}, hue: {} }), null);
  });
}
