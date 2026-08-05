import assert from 'node:assert/strict';
import test from 'node:test';

import { computeLayerPerspectiveVisual } from '../lib/common/layer-perspective-visual.js';

// docs/contract-2026-08-02-preview-parity.md §2.4.3 (layers[].perspective): unit-level coverage
// of the same math packages/render-cut/src/perspective-homography.mjs emits as ffmpeg
// `perspective=` filter parameters, mirrored here as a browser CSS matrix3d transform function.
//
// Rather than eyeballing the returned matrix3d string, `applyFullChain` below simulates the full
// CSS composition shell actually uses: `transform-origin: <pivot>` + `transform: translate(-pivot%,
// -pivot%) rotate(deg) <matrix3d-from-computeLayerPerspectiveVisual>` (akari-preview-open-handler.
// ts §2.4.1's existing crop pivot idiom, with perspective appended as the innermost function),
// applied to box-local pixel points. The result is compared against `perspectiveReference`, an
// independent re-implementation of the *plain* (non-centered, non-pivot) Heckbert unit-square ->
// quadrilateral mapping used directly on box fractions -- the same reference render-cut's own
// perspective-homography.mjs is unit-tested against -- so a sign, centering, or ordering error in
// either implementation would show up as a geometric mismatch, not just a string-shape mismatch.

function squareToQuadCircular(p0, p1, p2, p3) {
    const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let a13, a23;
    if (dx3 === 0 && dy3 === 0) { a13 = 0; a23 = 0; } else {
        const den = dx1 * dy2 - dx2 * dy1;
        a13 = (dx3 * dy2 - dx2 * dy3) / den;
        a23 = (dx1 * dy3 - dx3 * dy1) / den;
    }
    const a11 = x1 - x0 + a13 * x1;
    const a21 = x3 - x0 + a23 * x3;
    const a31 = x0;
    const a12 = y1 - y0 + a13 * y1;
    const a22 = y3 - y0 + a23 * y3;
    const a32 = y0;
    return { a11, a21, a31, a12, a22, a32, a13, a23 };
}

// Independent reference: plain top-left-origin Heckbert (identical construction to render-cut's
// perspective-homography.mjs), applied directly to a box-fraction point.
function perspectiveReference(corners, u, v) {
    const [tl, tr, bl, br] = corners;
    const m = squareToQuadCircular(tl, tr, br, bl);
    const w = m.a13 * u + m.a23 * v + 1;
    return [(m.a11 * u + m.a21 * v + m.a31) / w, (m.a12 * u + m.a22 * v + m.a32) / w];
}

// Parses a CSS transform function list and applies it to a point, rightmost function first
// (innermost), matching CSS composition semantics. Supports the specific function set shell
// emits for layer transforms: translate (%, relative to boxSize), rotate (deg), and matrix3d
// (16 values, applied with the standard homogeneous divide since z=0 for every point here).
function applyTransformFunctions(cssTransform, boxSize, point) {
    const fns = [...cssTransform.matchAll(/(\w+)\(([^)]*)\)/g)].map(m => ({
        name: m[1],
        args: m[2].split(',').map(s => parseFloat(s)),
    }));
    let [x, y] = point;
    for (const fn of fns.slice().reverse()) {
        if (fn.name === 'translate') {
            x += (fn.args[0] / 100) * boxSize.w;
            y += (fn.args[1] / 100) * boxSize.h;
        } else if (fn.name === 'rotate') {
            const rad = fn.args[0] * Math.PI / 180;
            const rx = x * Math.cos(rad) - y * Math.sin(rad);
            const ry = x * Math.sin(rad) + y * Math.cos(rad);
            x = rx; y = ry;
        } else if (fn.name === 'matrix3d') {
            const m = fn.args; // column-major: col1=[0..3] col2=[4..7] col3=[8..11] col4=[12..15]
            const z = 0;
            const nx = m[0] * x + m[4] * y + m[8] * z + m[12];
            const ny = m[1] * x + m[5] * y + m[9] * z + m[13];
            const nw = m[3] * x + m[7] * y + m[11] * z + m[15];
            x = nx / nw; y = ny / nw;
        } else {
            throw new Error('unexpected transform function: ' + fn.name);
        }
    }
    return [x, y];
}

// Full simulation of `transform-origin: <pivotPct>%; transform: <cssTransform>` applied to a
// box-local pixel point (0,0 = box top-left), matching how browsers apply transform-origin: the
// point is shifted so the origin sits at (0,0), the transform functions are applied, then the
// origin offset is added back.
function applyFullChain(cssTransform, pivotPct, boxSize, boxLocalPoint) {
    const originPx = { x: (pivotPct.x / 100) * boxSize.w, y: (pivotPct.y / 100) * boxSize.h };
    const q = [boxLocalPoint[0] - originPx.x, boxLocalPoint[1] - originPx.y];
    const [rx, ry] = applyTransformFunctions(cssTransform, boxSize, q);
    return [rx + originPx.x, ry + originPx.y];
}

function closeTo(actual, expected, epsilon = 1e-3) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test('no perspective at all returns null', () => {
    assert.equal(computeLayerPerspectiveVisual(undefined, 300, 200), null);
    assert.equal(computeLayerPerspectiveVisual(null, 300, 200), null);
    assert.equal(computeLayerPerspectiveVisual({}, 300, 200), null);
});

test('a non-positive box size is unusable', () => {
    const perspective = { corners: [[0.1, 0], [0.9, 0], [0, 1], [1, 1]] };
    assert.equal(computeLayerPerspectiveVisual(perspective, 0, 200), null);
    assert.equal(computeLayerPerspectiveVisual(perspective, 300, -1), null);
});

test('malformed corners (wrong count, out of range, non-numeric) are unusable', () => {
    assert.equal(computeLayerPerspectiveVisual({ corners: [[0, 0], [1, 0], [0, 1]] }, 300, 200), null);
    assert.equal(computeLayerPerspectiveVisual({ corners: [[0, 0], [1.5, 0], [0, 1], [1, 1]] }, 300, 200), null);
    assert.equal(computeLayerPerspectiveVisual({ corners: [[0, 0], ['x', 0], [0, 1], [1, 1]] }, 300, 200), null);
});

test('identity corners (full box, no warp) return a matrix3d equivalent to the identity transform', () => {
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const visual = computeLayerPerspectiveVisual({ corners }, 300, 200);
    assert.ok(visual);
    const boxSize = { w: 300, h: 200 };
    const pivotPct = { x: 50, y: 50 };
    const cssTransform = `translate(-50%, -50%) ${visual.transformFunction}`;
    for (const point of [[0, 0], [300, 0], [0, 200], [300, 200], [150, 100], [75, 40]]) {
        const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, point);
        // translate(-50%,-50%) undoes the pivot placement; identity matrix3d leaves the
        // pivot-relative point unchanged, so the net effect (before any outer placement
        // translate the caller would add) is just "point - pivot".
        closeTo(rx, point[0] - boxSize.w / 2);
        closeTo(ry, point[1] - boxSize.h / 2);
    }
});

test('a declared trapezoid reproduces the plain Heckbert reference at box-fraction sample points (no crop, no rotate)', () => {
    const corners = [[0.1, 0], [0.9, 0], [0, 1], [1, 1]];
    const boxSize = { w: 320, h: 180 };
    const visual = computeLayerPerspectiveVisual({ corners }, boxSize.w, boxSize.h);
    assert.ok(visual);
    const pivotPct = { x: 50, y: 50 };
    const cssTransform = `translate(-50%, -50%) ${visual.transformFunction}`;
    const samples = [
        [0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.25, 0.1], [0.75, 0.9], [0.1, 0.5],
    ];
    for (const [u, v] of samples) {
        const boxLocal = [u * boxSize.w, v * boxSize.h];
        const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, boxLocal);
        const [refU, refV] = perspectiveReference(corners, u, v);
        // translate(-50%,-50%) makes the net effect (ignoring outer placement) "warped point -
        // pivot", i.e. boxSize*(refFraction - 0.5).
        closeTo(rx, boxSize.w * (refU - 0.5), 1e-2);
        closeTo(ry, boxSize.h * (refV - 0.5), 1e-2);
    }
});

test('perspective + crop compose correctly end-to-end: the box passed to computeLayerPerspectiveVisual is the *crop rect\'s own* size, and its pivot is always that box\'s own 50%/50% center', () => {
    // akari-preview-open-handler.ts §2.4.1's crop pivot idiom does NOT resize the DOM element to
    // the crop rect (it keeps the full video element and masks with clip-path); transform-origin
    // is set to the crop rect's center *as a percentage of the full element*. But
    // layers[].perspective's declared corners are fractions of the *cropped* box specifically
    // (contract §2.4.3: perspective applies after crop, in render-cut's chain) -- so the box size
    // this module receives must be the crop rect's own pixel size (cropW*videoWidth*scale, not
    // the full element's), and by construction its pivot is always exactly that box's own center
    // (the crop rect's center coincides with transform-origin's pivot point in the full-element
    // frame, which is q=0 -- i.e. always "50%/50% of the box actually being warped", never some
    // other point). This test simulates that full wiring: a full 500x300 video element, a crop
    // rect selecting its right 60%/bottom 80% (matching how akari-preview-open-handler.ts derives
    // pivotPct from crop.x/y/w/h), and confirms a perspective-declared fraction point ends up
    // exactly where the plain Heckbert reference (evaluated in crop-rect-local fraction terms)
    // plus the crop rect's own screen placement predicts.
    const fullBox = { w: 500, h: 300 };
    const crop = { x: 0.4, y: 0.2, w: 0.6, h: 0.8 };
    const cropBoxSize = { w: crop.w * fullBox.w, h: crop.h * fullBox.h }; // 300x240
    const pivotPct = { x: (crop.x + crop.w / 2) * 100, y: (crop.y + crop.h / 2) * 100 }; // matches the shell's existing crop pivot formula

    const corners = [[0.15, 0.05], [0.85, 0.1], [0.05, 0.9], [0.95, 0.85]];
    const visual = computeLayerPerspectiveVisual({ corners }, cropBoxSize.w, cropBoxSize.h);
    assert.ok(visual);
    const cssTransform = `translate(-${pivotPct.x}%, -${pivotPct.y}%) ${visual.transformFunction}`;

    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.3, 0.7], [1, 0]]) {
        // A point at fraction (u,v) *of the crop rect* -- expressed in full-element-local pixels
        // (which is what the live DOM's coordinate space actually is) for applyFullChain, whose
        // pivotPct/boxSize (fullBox) match the real transform-origin percentage semantics.
        const fullElementLocal = [
            (crop.x + u * crop.w) * fullBox.w,
            (crop.y + v * crop.h) * fullBox.h,
        ];
        const [rx, ry] = applyFullChain(cssTransform, pivotPct, fullBox, fullElementLocal);
        const [refU, refV] = perspectiveReference(corners, u, v);
        // Expected: the reference's crop-rect-local fraction point, converted to crop-rect-local
        // pixels, minus the crop rect's own center (since translate(-pivot%) anchors the crop
        // rect's center at the outer placement origin).
        closeTo(rx, refU * cropBoxSize.w - cropBoxSize.w / 2, 1e-2);
        closeTo(ry, refV * cropBoxSize.h - cropBoxSize.h / 2, 1e-2);
    }
});

test('perspective composes correctly with rotate (innermost function applies before rotate, matching the render-cut apply order)', () => {
    const corners = [[0.1, 0], [0.9, 0], [0, 1], [1, 1]];
    const boxSize = { w: 300, h: 200 };
    const visual = computeLayerPerspectiveVisual({ corners }, boxSize.w, boxSize.h);
    assert.ok(visual);
    const pivotPct = { x: 50, y: 50 };
    const rotateDeg = 33;
    const cssTransform = `translate(-50%, -50%) rotate(${rotateDeg}deg) ${visual.transformFunction}`;
    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
        const boxLocal = [u * boxSize.w, v * boxSize.h];
        const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, boxLocal);
        const [refU, refV] = perspectiveReference(corners, u, v);
        // The reference point (relative to pivot) must be rotated *after* the perspective warp
        // (perspective is innermost -> applies first), not before.
        const px = boxSize.w * (refU - 0.5);
        const py = boxSize.h * (refV - 0.5);
        const rad = rotateDeg * Math.PI / 180;
        const expectedX = px * Math.cos(rad) - py * Math.sin(rad);
        const expectedY = px * Math.sin(rad) + py * Math.cos(rad);
        closeTo(rx, expectedX, 1e-2);
        closeTo(ry, expectedY, 1e-2);
    }
});
