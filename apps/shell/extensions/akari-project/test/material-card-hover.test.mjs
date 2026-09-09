import test from 'node:test';
import assert from 'node:assert/strict';
import { hoverFrameTimes, hoverPopupPosition } from '../lib/common/material-card-hover.js';

test('five frame midpoints reuse the exact poster time', () => {
    assert.deepEqual(hoverFrameTimes(10), [1, 3, 5, 7, 9]);
    for (const duration of [0.03, 5, 8.33333333333, 61.7]) {
        const times = hoverFrameTimes(duration);
        assert.equal(times[2], duration / 2);
        assert.ok(times.every(time => time > 0 && time < duration));
        assert.equal(new Set(times).size, 5);
    }
});
test('frame count is configurable and invalid durations/counts are empty', () => {
    assert.deepEqual(hoverFrameTimes(4, 1), [2]);
    assert.deepEqual(hoverFrameTimes(4, 2), [1, 3]);
    for (const duration of [0, -1, NaN, Infinity]) assert.deepEqual(hoverFrameTimes(duration), []);
    for (const count of [0, -1, 1.5, Infinity, 101]) assert.deepEqual(hoverFrameTimes(5, count), []);
});
test('popup prefers the right, falls back to the left, and clamps vertically', () => {
    const viewport = { width: 1200, height: 800 }, size = { width: 300, height: 334 };
    assert.deepEqual(hoverPopupPosition({ left: 10, right: 110, top: 50 }, viewport, size), { left: 118, top: 50 });
    assert.deepEqual(hoverPopupPosition({ left: 1000, right: 1100, top: 750 }, viewport, size), { left: 692, top: 458 });
    assert.deepEqual(hoverPopupPosition({ left: 20, right: 120, top: -10 }, { width: 320, height: 350 }, size), { left: 8, top: 8 });
});
