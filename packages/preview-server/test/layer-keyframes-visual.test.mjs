import assert from 'node:assert/strict';
import test from 'node:test';

import { computeLayerKeyframesVisual } from '../public/layer-keyframes-visual.js';

// contract-2026-08-09-transform-keyframes-v0.md. Numeric-parity coverage for the Web preview
// surface: packages/render-cut/src/layer-keyframes.mjs's own test/layer-keyframes.test.mjs
// exercises the same hold/interpolate/ease semantics via real ffmpeg renders, and
// apps/shell/extensions/akari-preview/test/layer-keyframes-visual.test.mjs exercises the shell's
// independent copy -- this file checks the same reference points against the Web copy (matches
// the §2.2.1 "3 surfaces, same reference points" convention layer-perspective-visual.test.mjs
// already follows for the static case).

test('computeLayerKeyframesVisual: null when keyframes is absent or has fewer than 2 usable points', () => {
    assert.equal(computeLayerKeyframesVisual(undefined, 0), null);
    assert.equal(computeLayerKeyframesVisual([{ t: 0, transform: { scale: 1 } }], 0), null);
    assert.equal(computeLayerKeyframesVisual('not-an-array', 0), null);
});

test('computeLayerKeyframesVisual: holds before the first point and after the last', () => {
    const keyframes = [{ t: 1, transform: { x: 10 } }, { t: 3, transform: { x: 30 } }];
    assert.equal(computeLayerKeyframesVisual(keyframes, 0).transform.x, 10);
    assert.equal(computeLayerKeyframesVisual(keyframes, 5).transform.x, 30);
});

test('computeLayerKeyframesVisual: linear interpolation between two points', () => {
    const keyframes = [{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 3 } }];
    const resolved = computeLayerKeyframesVisual(keyframes, 1);
    assert.ok(Math.abs(resolved.transform.scale - 2) < 1e-9, `expected scale=2, got ${resolved.transform.scale}`);
});

test('computeLayerKeyframesVisual: ease-in-out matches the standard cubic formula (u<0.5: 4u^3, else 1-(-2u+2)^3/2)', () => {
    const keyframes = [{ t: 0, transform: { x: 0 } }, { t: 10, transform: { x: 100 }, easing: 'ease-in-out' }];
    const atQuarter = computeLayerKeyframesVisual(keyframes, 2.5).transform.x;
    assert.ok(Math.abs(atQuarter - 6.25) < 1e-9, `expected 6.25, got ${atQuarter}`);
    const atMid = computeLayerKeyframesVisual(keyframes, 5).transform.x;
    assert.ok(Math.abs(atMid - 50) < 1e-9, `expected 50, got ${atMid}`);
});

test('computeLayerKeyframesVisual: transform leaves omitted at a declaring point fall back to the standard default, not the previous point\'s value', () => {
    const keyframes = [{ t: 0, transform: { scale: 2 } }, { t: 2, transform: { rotate: 90 } }];
    assert.deepEqual(computeLayerKeyframesVisual(keyframes, 0).transform, { x: 0, y: 0, scale: 2, rotate: 0 });
    assert.deepEqual(computeLayerKeyframesVisual(keyframes, 2).transform, { x: 0, y: 0, scale: 1, rotate: 90 });
});

test('computeLayerKeyframesVisual: categories are independent -- a category with no declaring point stays null', () => {
    const keyframes = [{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 2 } }];
    const resolved = computeLayerKeyframesVisual(keyframes, 1);
    assert.notEqual(resolved.transform, null);
    assert.equal(resolved.crop, null);
    assert.equal(resolved.perspective, null);
});

test('computeLayerKeyframesVisual: crop interpolates x/y/w/h independently, holding across a point that omits crop entirely', () => {
    const keyframes = [
        { t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
        { t: 1, transform: { scale: 1 } },
        { t: 2, crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } }
    ];
    const atMid = computeLayerKeyframesVisual(keyframes, 1).crop;
    assert.ok(Math.abs(atMid.x - 0.1) < 1e-9);
    assert.ok(Math.abs(atMid.y - 0.05) < 1e-9);
    assert.ok(Math.abs(atMid.w - 0.8) < 1e-9);
    assert.ok(Math.abs(atMid.h - 0.9) < 1e-9);
});

test('computeLayerKeyframesVisual: perspective corners interpolate the declared (raw) corners linearly, not any derived value', () => {
    const keyframes = [
        { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
        { t: 2, perspective: { corners: [[0.4, 0], [1, 0], [0, 1], [1, 1]] } }
    ];
    const atMid = computeLayerKeyframesVisual(keyframes, 1).perspective;
    assert.ok(Math.abs(atMid.corners[0][0] - 0.2) < 1e-9, `expected TL.x=0.2, got ${atMid.corners[0][0]}`);
    assert.deepEqual(atMid.corners[1], [1, 0]);
});
