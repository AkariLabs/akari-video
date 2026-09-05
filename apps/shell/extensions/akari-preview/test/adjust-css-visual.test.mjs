import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';

import { computeAdjustCssVisual as sharedComputeAdjustCssVisual } from '@akari-video/edit-store';
import { computeAdjustCssVisual } from '../lib/common/adjust-css-visual.js';

test('adjust なしと basic 無効は DOM filter 席に触れない', () => {
  assert.equal(computeAdjustCssVisual(undefined), null);
  assert.equal(computeAdjustCssVisual(null), null);
  assert.equal(computeAdjustCssVisual({}), null);
  assert.equal(computeAdjustCssVisual({ basic: { exposure: 1 }, sections: { basic: false } }), null);
});

test('akari-preview re-exports the edit-store function by reference', () => {
  assert.equal(computeAdjustCssVisual, sharedComputeAdjustCssVisual);
});

test('adjust を基底に transition filter を空要素なしで連結する', () => {
  assert.equal(
    computeAdjustCssVisual({ basic: { exposure: 1 } }, 'blur(4px)')?.filter,
    'brightness(2.00) blur(4px)',
  );
  assert.equal(computeAdjustCssVisual({ basic: {} }, 'blur(4px)')?.filter, 'blur(4px)');
  assert.equal(computeAdjustCssVisual(undefined, 'blur(4px)')?.filter, 'blur(4px)');
  assert.equal(computeAdjustCssVisual({ basic: { exposure: 1 } }, 'none')?.filter, 'brightness(2.00)');
});

test('CSS 表現不可の basic 値だけを近似表示として検出する', () => {
  assert.equal(computeAdjustCssVisual({ basic: { exposure: 1 } })?.hasApproximation, false);
  assert.equal(computeAdjustCssVisual({ basic: { tint: 0.001 } })?.hasApproximation, true);
  assert.equal(computeAdjustCssVisual({ basic: { highlights: 0, vibrance: 0 } })?.hasApproximation, false);
  assert.equal(
    computeAdjustCssVisual({ basic: { tint: 1 }, sections: { basic: false } }),
    null,
  );
});

test('webview 用の関数直列化はクロージャなしで実行できる', () => {
  const serialized = vm.runInNewContext(`(${computeAdjustCssVisual.toString()})`);
  assert.deepEqual(
    { ...serialized({ basic: { exposure: 1, tint: 0.2 } }, 'blur(2px)') },
    { filter: 'brightness(2.00) blur(2px)', hasApproximation: true },
  );
  assert.deepEqual(
    { ...serialized({ wheels: { lift: { r: 0.1 } } }) },
    { filter: '', hasApproximation: true },
  );
});
