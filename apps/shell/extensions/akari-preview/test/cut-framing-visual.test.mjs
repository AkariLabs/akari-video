import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCutFramingVisual } from '../lib/common/cut-framing-visual.js';

// docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing): unit-level coverage of the same
// math packages/render-cut/src/cut-framing.mjs emits as an ffmpeg filtergraph, mirrored here as
// a browser CSS transform. Rather than eyeballing the returned transform strings, `applyTransform`
// below actually simulates the CSS `transform-origin: 0 0; transform: <fn list>` composition
// (leftmost function applies last/outer) against sample points, then compares the result to
// `ffmpegReference`, an independent re-implementation of appendStaticCrop/appendKeyframeZoom's
// pixel math (in 0..1 fraction units, i.e. width = height = 1) -- so a sign or ordering error in
// either implementation would show up as a geometric mismatch, not just a string-shape mismatch.

function applyTransform(cssTransform, point) {
    const fns = [...cssTransform.matchAll(/(\w+)\(([^)]*)\)/g)].map(m => ({
        name: m[1],
        args: m[2].split(',').map(s => parseFloat(s))
    }));
    // Rightmost function applies first (inner); leftmost applies last (outer).
    let [x, y] = point;
    for (const fn of fns.slice().reverse()) {
        if (fn.name === 'translate') {
            x += fn.args[0] / 100;
            y += fn.args[1] / 100;
        } else if (fn.name === 'scale') {
            const sx = fn.args[0];
            const sy = fn.args.length > 1 ? fn.args[1] : sx;
            x *= sx;
            y *= sy;
        } else {
            throw new Error('unexpected transform function: ' + fn.name);
        }
    }
    return [x, y];
}

// Independent re-implementation of cut-framing.mjs's pixel math in fraction units (width=height=1).
function ffmpegStaticCropReference(crop, point) {
    const cropW = Math.min(Math.max(crop.w, 2 / 1000), 1);
    const cropH = Math.min(Math.max(crop.h, 2 / 1000), 1);
    const cropX = Math.min(Math.max(crop.x, 0), 1 - cropW);
    const cropY = Math.min(Math.max(crop.y, 0), 1 - cropH);
    return [(point[0] - cropX) * (1 / cropW), (point[1] - cropY) * (1 / cropH)];
}

function ffmpegZoomReference(scale, cx, cy, point) {
    const scaledX = point[0] * scale;
    const scaledY = point[1] * scale;
    const cropX = Math.min(Math.max(cx * scale - 0.5, 0), scale - 1);
    const cropY = Math.min(Math.max(cy * scale - 0.5, 0), scale - 1);
    return [scaledX - cropX, scaledY - cropY];
}

function closeTo(actual, expected, epsilon = 1e-3) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test('no framing at all returns null', () => {
    assert.equal(computeCutFramingVisual(undefined, 0), null);
    assert.equal(computeCutFramingVisual(null, 0), null);
    assert.equal(computeCutFramingVisual({}, 0), null);
});

test('crop with a non-positive dimension is unusable and falls through to null', () => {
    assert.equal(computeCutFramingVisual({ crop: { x: 0, y: 0, w: 0, h: 1 } }, 0), null);
    assert.equal(computeCutFramingVisual({ crop: { x: 0, y: 0, w: 1, h: -1 } }, 0), null);
});

test('a single keyframe point (< 2) is unusable', () => {
    assert.equal(computeCutFramingVisual({ keyframes: [{ t: 0, scale: 2 }] }, 0), null);
});

test('static crop: transform-origin is always 0 0 when active', () => {
    const visual = computeCutFramingVisual({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }, 0);
    assert.equal(visual.transformOrigin, '0 0');
});

test('static crop: reproduces the ffmpeg crop+rescale mapping at reference points', () => {
    const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.6 };
    const visual = computeCutFramingVisual({ crop }, 0);
    const samplePoints = [[0, 0], [1, 1], [0.25, 0.1], [0.75, 0.7], [0.5, 0.4]];
    for (const point of samplePoints) {
        const [ax, ay] = applyTransform(visual.transform, point);
        const [ex, ey] = ffmpegStaticCropReference(crop, point);
        closeTo(ax, ex);
        closeTo(ay, ey);
    }
    // The crop window's own corners land exactly on the output canvas's corners (0,0)-(1,1).
    const [topLeftX, topLeftY] = applyTransform(visual.transform, [crop.x, crop.y]);
    closeTo(topLeftX, 0);
    closeTo(topLeftY, 0);
    const [bottomRightX, bottomRightY] = applyTransform(visual.transform, [crop.x + crop.w, crop.y + crop.h]);
    closeTo(bottomRightX, 1);
    closeTo(bottomRightY, 1);
});

test('static crop: full-frame crop (0,0,1,1) is the identity mapping (no-op boundary)', () => {
    const visual = computeCutFramingVisual({ crop: { x: 0, y: 0, w: 1, h: 1 } }, 0);
    for (const point of [[0, 0], [1, 1], [0.3, 0.8]]) {
        const [ax, ay] = applyTransform(visual.transform, point);
        closeTo(ax, point[0]);
        closeTo(ay, point[1]);
    }
});

test('zoom keyframes: crop and keyframes both declared -- keyframes wins (contract #6)', () => {
    const framing = {
        crop: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
        keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 1 }]
    };
    const visual = computeCutFramingVisual(framing, 0.5);
    // scale=1 identity zoom -- if crop had won instead, this would zoom in hard on a 0.2x0.2 box.
    const [x, y] = applyTransform(visual.transform, [0.5, 0.5]);
    closeTo(x, 0.5);
    closeTo(y, 0.5);
});

test('zoom keyframes: 2-point ramp reproduces the ffmpeg scale+crop mapping at start/mid/end', () => {
    const keyframes = [{ t: 0, scale: 1 }, { t: 2, scale: 3 }];
    for (const t of [0, 0.5, 1, 1.5, 2]) {
        const visual = computeCutFramingVisual({ keyframes }, t);
        const expectedScale = 1 + (3 - 1) * (t / 2);
        const samplePoints = [[0, 0], [1, 1], [0.5, 0.5], [0.2, 0.8]];
        for (const point of samplePoints) {
            const [ax, ay] = applyTransform(visual.transform, point);
            const [ex, ey] = ffmpegZoomReference(expectedScale, 0.5, 0.5, point);
            closeTo(ax, ex);
            closeTo(ay, ey);
        }
    }
});

test('zoom keyframes: holds the first value before t[0] and the last value after t[last]', () => {
    const keyframes = [{ t: 1, scale: 2 }, { t: 2, scale: 4 }];
    const before = computeCutFramingVisual({ keyframes }, 0);
    const [bx] = applyTransform(before.transform, [1, 0]);
    const [ex] = ffmpegZoomReference(2, 0.5, 0.5, [1, 0]);
    closeTo(bx, ex);
    const after = computeCutFramingVisual({ keyframes }, 5);
    const [ax] = applyTransform(after.transform, [1, 0]);
    const [eax] = ffmpegZoomReference(4, 0.5, 0.5, [1, 0]);
    closeTo(ax, eax);
});

test('zoom keyframes: 3+ points piecewise-interpolate staged zoom levels', () => {
    const keyframes = [{ t: 0, scale: 1 }, { t: 1, scale: 2 }, { t: 3, scale: 2 }, { t: 4, scale: 4 }];
    const flatMid = computeCutFramingVisual({ keyframes }, 2); // inside the flat 2->2 span
    const [fx] = applyTransform(flatMid.transform, [1, 1]);
    const [efx] = ffmpegZoomReference(2, 0.5, 0.5, [1, 1]);
    closeTo(fx, efx);
    const rampMid = computeCutFramingVisual({ keyframes }, 3.5); // inside the 2->4 ramp
    const [rx] = applyTransform(rampMid.transform, [1, 1]);
    const [erx] = ffmpegZoomReference(3, 0.5, 0.5, [1, 1]);
    closeTo(rx, erx);
});

test('zoom keyframes: scale < 1 is clamped to 1 (reveal-beyond-frame is not representable)', () => {
    const keyframes = [{ t: 0, scale: 0.3 }, { t: 1, scale: 0.5 }];
    const visual = computeCutFramingVisual({ keyframes }, 0.5);
    const [x, y] = applyTransform(visual.transform, [0.5, 0.5]);
    closeTo(x, 0.5);
    closeTo(y, 0.5);
});

test('zoom keyframes: custom cx/cy pans the focus point (unclipped, focus lands at output center)', () => {
    // cx=0.4/cy=0.6 with scale=2 keep cropXFrac/cropYFrac inside [0, scale-1] unclamped
    // (0.4*2-0.5=0.3, 0.6*2-0.5=0.7), so the focus point lands exactly at center.
    const keyframes = [{ t: 0, scale: 2, cx: 0.4, cy: 0.6 }, { t: 1, scale: 2, cx: 0.4, cy: 0.6 }];
    const visual = computeCutFramingVisual({ keyframes }, 0.5);
    const [x, y] = applyTransform(visual.transform, [0.4, 0.6]);
    closeTo(x, 0.5);
    closeTo(y, 0.5);
});

test('zoom keyframes: omitted cx/cy default to 0.5 (frame center)', () => {
    const keyframes = [{ t: 0, scale: 2 }, { t: 1, scale: 2 }];
    const visual = computeCutFramingVisual({ keyframes }, 0.5);
    const [x, y] = applyTransform(visual.transform, [0.5, 0.5]);
    closeTo(x, 0.5);
    closeTo(y, 0.5);
});

test('zoom keyframes: near-edge focus point clamps the crop window instead of overshooting', () => {
    // cx=0.05 with scale=2 would want cropX = 0.05*2-0.5 = -0.4, clamped to 0.
    const keyframes = [{ t: 0, scale: 2, cx: 0.05, cy: 0.5 }, { t: 1, scale: 2, cx: 0.05, cy: 0.5 }];
    const visual = computeCutFramingVisual({ keyframes }, 0.5);
    const [x] = applyTransform(visual.transform, [0, 0.5]);
    closeTo(x, 0); // frame's own left edge, not off-screen negative
});

test('non-finite cutLocalPlayedSeconds is treated as 0 rather than propagating NaN', () => {
    const visual = computeCutFramingVisual({ keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 3 }] }, NaN);
    const [x] = applyTransform(visual.transform, [0.5, 0.5]);
    closeTo(x, 0.5); // t=0 behavior (scale=1, identity)
});
