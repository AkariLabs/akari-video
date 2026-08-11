import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRectFromPoints } from '../lib/common/rect-tool-visual.js';

// docs/contract-2026-07-20-review-json-v1-annotation-model.md §2: region.box is [x,y,w,h]
// normalized 0-1 with x+w<=1 and y+h<=1. task.md 指示4/7 requires unit coverage of the rect
// tool's normalized-coordinate math.

function assertCloseBox(actual, expected) {
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < expected.length; index += 1) {
        assert.ok(
            Math.abs(actual[index] - expected[index]) < 1e-9,
            `box[${index}]: expected ~${expected[index]}, got ${actual[index]}`
        );
    }
}

test('drag top-left to bottom-right produces the expected box', () => {
    // 0.6 - 0.2 is 0.39999999999999997 in IEEE 754 double precision -- approximate compare.
    assertCloseBox(normalizeRectFromPoints([0.2, 0.3], [0.6, 0.8]), [0.2, 0.3, 0.4, 0.5]);
});

test('drag direction is irrelevant -- bottom-right to top-left produces the same box', () => {
    assertCloseBox(normalizeRectFromPoints([0.6, 0.8], [0.2, 0.3]), [0.2, 0.3, 0.4, 0.5]);
});

test('drag from top-right to bottom-left normalizes correctly', () => {
    assert.deepEqual(normalizeRectFromPoints([0.9, 0.1], [0.1, 0.9]), [0.1, 0.1, 0.8, 0.8]);
});

test('a degenerate drag (no movement) produces a zero-size box, not an error', () => {
    assert.deepEqual(normalizeRectFromPoints([0.5, 0.5], [0.5, 0.5]), [0.5, 0.5, 0, 0]);
});

test('out-of-range input points are clamped into 0-1 before computing the box', () => {
    assert.deepEqual(normalizeRectFromPoints([-0.5, -0.2], [1.5, 1.2]), [0, 0, 1, 1]);
});

test('the invariant x+w<=1 and y+h<=1 always holds, even at the edges', () => {
    const [x, y, w, h] = normalizeRectFromPoints([0, 0], [1, 1]);
    assert.ok(x + w <= 1);
    assert.ok(y + h <= 1);
    assert.deepEqual([x, y, w, h], [0, 0, 1, 1]);
});
