import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fitDuration, maximumViewDuration, clampViewRange, zoomPercent, snapFitDuration,
    zoomBarExtent, dragViewRange, edgeAutoScrollDelta, trackScaleFromHandle
} from '../lib/common/timeline-view-range.js';

test('100% includes a five percent tail and the widest view is ten percent', () => {
    assert.equal(fitDuration(100), 105);
    assert.equal(fitDuration(0), 1);
    assert.equal(maximumViewDuration(100), 1050);
    assert.equal(zoomPercent(100, 105), 100);
    assert.equal(zoomPercent(100, 1050), 10);
    assert.deepEqual(clampViewRange(-8, 5000, 100, 30, 3), { start: 0, duration: 1050 });
    assert.deepEqual(clampViewRange(5000, 105, 100, 30, 3), { start: 945, duration: 105 });
    assert.deepEqual(clampViewRange(3, 0.001, 100, 30, 3), { start: 3, duration: 0.1 });
});

test('vertical handles scale every base track height within the shared limits', () => {
    assert.ok(trackScaleFromHandle(1, -50, 200, 'end') > 1);
    assert.ok(trackScaleFromHandle(1, 50, 200, 'start') > 1);
    assert.equal(trackScaleFromHandle(1, -1000, 200, 'end'), 3);
    assert.equal(trackScaleFromHandle(1, 1000, 200, 'end'), 0.6);
});

test('handles keep the opposite endpoint and the thumb preserves duration', () => {
    const original = { start: 20, duration: 40 };
    assert.deepEqual(dragViewRange(original, 'end', -10, 100, 30, 3), { start: 20, duration: 30 });
    assert.deepEqual(dragViewRange(original, 'start', 10, 100, 30, 3), { start: 30, duration: 30 });
    assert.deepEqual(dragViewRange(original, 'thumb', 10, 100, 30, 3), { start: 30, duration: 40 });
    assert.deepEqual(dragViewRange(original, 'end', 2000, 100, 30, 3), { start: 20, duration: 1030 });
    assert.deepEqual(dragViewRange(original, 'start', -2000, 100, 30, 3), { start: 0, duration: 60 });
});

test('fit magnet and growing bar extent', () => {
    assert.equal(snapFitDuration(100, 100), 105);
    assert.equal(snapFitDuration(100, 95), 95);
    assert.equal(zoomBarExtent(100, 0, 105), 105);
    assert.equal(zoomBarExtent(100, 20, 200), 220);
});

test('edge scrolling accelerates toward each edge and stops in the middle', () => {
    assert.equal(edgeAutoScrollDelta(500, 0, 1000, 100), 0);
    assert.equal(edgeAutoScrollDelta(1000, 0, 1000, 100), 1.2);
    assert.equal(edgeAutoScrollDelta(0, 0, 1000, 100), -1.2);
    assert.ok(edgeAutoScrollDelta(990, 0, 1000, 100) < 1.2);
    assert.equal(edgeAutoScrollDelta(952, 0, 1000, 100), 0);
});
