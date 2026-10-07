import test from 'node:test';
import assert from 'node:assert/strict';
import { clampMaterialRange } from '../lib/common/material-range.js';

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
