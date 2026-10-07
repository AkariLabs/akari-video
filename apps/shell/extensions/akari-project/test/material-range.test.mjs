import test from 'node:test';
import assert from 'node:assert/strict';
import { clampMaterialRange, materialRangeLabel, materialRangeLinePosition } from '../lib/common/material-range.js';

test('range keeps the stationary handle and enforces one second or 24 pixels', () => {
    assert.deepEqual(clampMaterialRange({ in: 9.9, out: 10 }, 20, 240, 'in'), { in: 8, out: 10 });
    assert.deepEqual(clampMaterialRange({ in: 8, out: 8.1 }, 20, 240, 'out'), { in: 8, out: 10 });
    assert.deepEqual(clampMaterialRange({ in: 9.9, out: 10 }, 20, 960, 'in'), { in: 9, out: 10 });
});

test('range stops at both media ends, including short media', () => {
    assert.deepEqual(clampMaterialRange({ in: -9, out: 2 }, 10, 240, 'in'), { in: 0, out: 2 });
    assert.deepEqual(clampMaterialRange({ in: 8, out: 99 }, 10, 240, 'out'), { in: 8, out: 10 });
    assert.deepEqual(clampMaterialRange({ in: 2, out: 3 }, 0.5, 240, 'in'), { in: 0, out: 0.5 });
});

test('range values round to hundredths at the clamp output', () => {
    assert.deepEqual(clampMaterialRange({ in: 1.234, out: 8.765 }, 10, 500, 'in'),
        { in: 1.23, out: 8.77 });
});

test('label length uses the difference of floored endpoints', () => {
    const range = { in: 3.9, out: 11.2 };
    assert.equal(materialRangeLabel(range), '0:03 → 0:11 · 0:08');
    assert.equal(materialRangeLabel(range, true), '0:08');
});

test('unselected strip line follows the source range and stays within the strip', () => {
    assert.deepEqual(materialRangeLinePosition({ in: 2, out: 6 }, 10), { left: 20, width: 40 });
    assert.deepEqual(materialRangeLinePosition({ in: 8, out: 20 }, 10), { left: 80, width: 20 });
    assert.deepEqual(materialRangeLinePosition({ in: 2, out: 6 }, 0), { left: 0, width: 0 });
});
