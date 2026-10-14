import assert from 'node:assert/strict';
import test from 'node:test';

import { certainFragmentOverflow, DaihonFragmentCache } from '../lib/common/daihon-fragment-cache.js';

test('同じ text と policy の二回目は分割を呼ばず、policy の変更では再計算する', () => {
    const cache = new DaihonFragmentCache();
    const policy = { max_line_units: 18, lines: 1, wrap: 'multi' };
    let splits = 0;
    const split = () => { splits++; return { fragments: ['前', '後'], overflow: false }; };
    const key = cache.key('前後', policy);
    assert.deepEqual(cache.compute(key, split).fragments, ['前', '後']);
    assert.deepEqual(cache.compute(key, split).fragments, ['前', '後']);
    assert.equal(splits, 1);
    cache.compute(cache.key('前後', { ...policy, max_line_units: 12 }), split);
    assert.equal(splits, 2);
});

test('六つの断片へ収まらない総文字単位だけ overflow を確定する', () => {
    assert.equal(certainFragmentOverflow(108, 18), false);
    assert.equal(certainFragmentOverflow(108.5, 18), true);
});
