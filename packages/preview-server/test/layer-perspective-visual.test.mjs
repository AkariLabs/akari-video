import assert from 'node:assert/strict';
import test from 'node:test';

import { computeLayerPerspectiveVisual } from '../public/layer-perspective-visual.js';

// docs/contract-2026-08-02-preview-parity.md §2.4.4 (layers[].perspective): unit-level coverage
// of the same math packages/render-cut/src/perspective-homography.mjs emits as ffmpeg
// `perspective=` filter parameters, mirrored here as a browser CSS matrix3d transform function
// for the Web preview (packages/preview-server/public/app.js).
//
// `applyFullChain` simulates the full CSS composition app.js actually uses: `transform-origin:
// <pivot>` + `transform: translate(x,y) scale(s) rotate(deg) <matrix3d-from-
// computeLayerPerspectiveVisual>` (app.js's existing crop pivot idiom -- see applyLayerCropVisual
// -- with perspective appended as the innermost function), applied to box-local pixel points. The
// result is compared against `perspectiveReference`, an independent re-implementation of the
// *plain* (non-centered, non-pivot) Heckbert unit-square -> quadrilateral mapping used directly on
// box fractions -- the same reference render-cut's own perspective-homography.mjs is unit-tested
// against -- so a sign, centering, or ordering error in either implementation would show up as a
// geometric mismatch, not just a string-shape mismatch. This file is independent from (and does
// not import) the shell's equivalent test -- see layer-perspective-visual.js's header comment.

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
// (innermost), matching CSS composition semantics. Supports the function set app.js emits for
// layer transforms: translate (px), scale (unitless), rotate (deg), and matrix3d (16 values,
// applied with the standard homogeneous divide since z=0 for every point here).
function applyTransformFunctions(cssTransform, point) {
  const fns = [...cssTransform.matchAll(/(\w+)\(([^)]*)\)/g)].map(m => ({
    name: m[1],
    args: m[2].split(',').map(s => parseFloat(s)),
  }));
  let [x, y] = point;
  for (const fn of fns.slice().reverse()) {
    if (fn.name === 'translate') {
      x += fn.args[0];
      y += fn.args[1];
    } else if (fn.name === 'scale') {
      const sx = fn.args[0];
      const sy = fn.args.length > 1 ? fn.args[1] : sx;
      x *= sx; y *= sy;
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
// point expressed in the *same coordinate frame pivotPct/originBoxSize use* (0,0 = that frame's
// own top-left) -- matching how browsers apply transform-origin: shift so the origin sits at
// (0,0), apply the transform functions, then add the origin offset back. Note this is Web's own
// convention (app.js's applyLayerCropVisual sets transform-origin alone, with NO compensating
// `translate(-pivot%)` the way shell's crop pivot idiom uses -- so, unlike the shell test, there
// is no extra translate function baked into `cssTransform` here that would cancel this add-back).
function applyFullChain(cssTransform, pivotPct, originBoxSize, point) {
  const originPx = { x: (pivotPct.x / 100) * originBoxSize.w, y: (pivotPct.y / 100) * originBoxSize.h };
  const q = [point[0] - originPx.x, point[1] - originPx.y];
  const [rx, ry] = applyTransformFunctions(cssTransform, q);
  return [rx + originPx.x, ry + originPx.y];
}

// Independent reference for what matrix3d (in isolation, i.e. with rotate/scale/translate all at
// their identity) does to a pivot-relative pixel point q: converts q to the box-fraction (u,v)
// perspectiveReference expects (using `warpBoxSize` -- the box actually passed to
// computeLayerPerspectiveVisual, which for the crop test below differs from the pivot's own
// origin box), evaluates the plain Heckbert reference, and converts back to a pivot-relative
// pixel delta. This is deliberately independent of computeLayerPerspectiveVisual's own matrix
// construction, so a bug in either would surface as a mismatch.
function referenceWarpQ(corners, warpBoxSize, q) {
  const u = q[0] / warpBoxSize.w + 0.5;
  const v = q[1] / warpBoxSize.h + 0.5;
  const [refU, refV] = perspectiveReference(corners, u, v);
  return [warpBoxSize.w * (refU - 0.5), warpBoxSize.h * (refV - 0.5)];
}

// Full expected-value reconstruction: matrix3d's effect via the independent referenceWarpQ above,
// then rotate, then scale, then origin add-back -- in that order, matching CSS's actual
// (innermost-first) composition and app.js's `translate(x,y) scale(s) rotate(deg) matrix3d(...)`
// function list (translate(x,y) is 0 in every test below, isolating the geometry under test).
function expectedFinal(corners, warpBoxSize, pivotPct, originBoxSize, rotateDeg, scaleFactor, point) {
  const originPx = { x: (pivotPct.x / 100) * originBoxSize.w, y: (pivotPct.y / 100) * originBoxSize.h };
  const q = [point[0] - originPx.x, point[1] - originPx.y];
  const [wx, wy] = referenceWarpQ(corners, warpBoxSize, q);
  const rad = rotateDeg * Math.PI / 180;
  const rx = wx * Math.cos(rad) - wy * Math.sin(rad);
  const ry = wx * Math.sin(rad) + wy * Math.cos(rad);
  return [rx * scaleFactor + originPx.x, ry * scaleFactor + originPx.y];
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
  const boxSize = { w: 300, h: 200 };
  const visual = computeLayerPerspectiveVisual({ corners }, boxSize.w, boxSize.h);
  assert.ok(visual);
  const pivotPct = { x: 50, y: 50 };
  const cssTransform = `translate(0px, 0px) scale(1) rotate(0deg) ${visual.transformFunction}`;
  for (const point of [[0, 0], [300, 0], [0, 200], [300, 200], [150, 100], [75, 40]]) {
    const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, point);
    const [ex, ey] = expectedFinal(corners, boxSize, pivotPct, boxSize, 0, 1, point);
    closeTo(rx, ex);
    closeTo(ry, ey);
    // Identity corners specifically: the point must be entirely unaffected (no compensating
    // translate exists in Web's transform list to cancel the transform-origin add-back the way
    // shell's does, so "no warp" really does mean "point in, point out unchanged").
    closeTo(rx, point[0]);
    closeTo(ry, point[1]);
  }
});

test('a declared trapezoid reproduces the plain Heckbert reference at box-fraction sample points (no crop, no rotate)', () => {
  const corners = [[0.1, 0], [0.9, 0], [0, 1], [1, 1]];
  const boxSize = { w: 320, h: 180 };
  const visual = computeLayerPerspectiveVisual({ corners }, boxSize.w, boxSize.h);
  assert.ok(visual);
  const pivotPct = { x: 50, y: 50 };
  const cssTransform = `translate(0px, 0px) scale(1) rotate(0deg) ${visual.transformFunction}`;
  const samples = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.25, 0.1], [0.75, 0.9], [0.1, 0.5]];
  for (const [u, v] of samples) {
    const point = [u * boxSize.w, v * boxSize.h];
    const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, point);
    const [refU, refV] = perspectiveReference(corners, u, v);
    // With scale=1/rotate=0/translate=0 and pivot=box-center, the composed chain reduces to
    // exactly "the point's declared corner-pin destination, in box-fraction pixel terms".
    closeTo(rx, refU * boxSize.w, 1e-2);
    closeTo(ry, refV * boxSize.h, 1e-2);
    const [ex, ey] = expectedFinal(corners, boxSize, pivotPct, boxSize, 0, 1, point);
    closeTo(rx, ex, 1e-2);
    closeTo(ry, ey, 1e-2);
  }
});

test('perspective + scale compose correctly: matrix3d (innermost) applies before scale, matching the render-cut apply order', () => {
  const corners = [[0.1, 0], [0.9, 0], [0, 1], [1, 1]];
  const boxSize = { w: 300, h: 200 };
  const visual = computeLayerPerspectiveVisual({ corners }, boxSize.w, boxSize.h);
  assert.ok(visual);
  const pivotPct = { x: 50, y: 50 };
  const scaleFactor = 1.4;
  const cssTransform = `translate(0px, 0px) scale(${scaleFactor}) rotate(0deg) ${visual.transformFunction}`;
  for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
    const point = [u * boxSize.w, v * boxSize.h];
    const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, point);
    const [ex, ey] = expectedFinal(corners, boxSize, pivotPct, boxSize, 0, scaleFactor, point);
    closeTo(rx, ex, 1e-2);
    closeTo(ry, ey, 1e-2);
  }
});

test('perspective composes correctly with rotate (innermost function applies before rotate, matching the render-cut apply order)', () => {
  const corners = [[0.1, 0], [0.9, 0], [0, 1], [1, 1]];
  const boxSize = { w: 300, h: 200 };
  const visual = computeLayerPerspectiveVisual({ corners }, boxSize.w, boxSize.h);
  assert.ok(visual);
  const pivotPct = { x: 50, y: 50 };
  const rotateDeg = 33;
  const cssTransform = `translate(0px, 0px) scale(1) rotate(${rotateDeg}deg) ${visual.transformFunction}`;
  for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
    const point = [u * boxSize.w, v * boxSize.h];
    const [rx, ry] = applyFullChain(cssTransform, pivotPct, boxSize, point);
    const [ex, ey] = expectedFinal(corners, boxSize, pivotPct, boxSize, rotateDeg, 1, point);
    closeTo(rx, ex, 1e-2);
    closeTo(ry, ey, 1e-2);
  }
});

test('perspective + crop compose correctly end-to-end: the box passed to computeLayerPerspectiveVisual is the crop rect\'s own native (unscaled) size, and its pivot is always that box\'s own 50%/50% center', () => {
  // Mirrors app.js's applyLayerCropVisual pivot formula: transform-origin is the crop rect's
  // center as a percentage of the *full, native-size* element (Web keeps the element at its
  // natural static position + translate(x,y), unlike shell's left/top-then-translate(-50%)
  // idiom -- contract §2.4.1's documented "existing PiP placement convention difference"). The
  // perspective box is the crop rect's own native pixel size specifically (not scaled) -- so the
  // "warp box" (cropBoxSize) and the "origin box" (fullBox, whose percentage the pivot itself is
  // expressed against) genuinely differ here, unlike every test above.
  const fullBox = { w: 500, h: 300 };
  const crop = { x: 0.4, y: 0.2, w: 0.6, h: 0.8 };
  const cropBoxSize = { w: crop.w * fullBox.w, h: crop.h * fullBox.h }; // 300x240
  const pivotPct = { x: (crop.x + crop.w / 2) * 100, y: (crop.y + crop.h / 2) * 100 };

  const corners = [[0.15, 0.05], [0.85, 0.1], [0.05, 0.9], [0.95, 0.85]];
  const visual = computeLayerPerspectiveVisual({ corners }, cropBoxSize.w, cropBoxSize.h);
  assert.ok(visual);
  const cssTransform = `translate(0px, 0px) scale(1) rotate(0deg) ${visual.transformFunction}`;

  for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.3, 0.7], [1, 0]]) {
    const point = [(crop.x + u * crop.w) * fullBox.w, (crop.y + v * crop.h) * fullBox.h];
    const [rx, ry] = applyFullChain(cssTransform, pivotPct, fullBox, point);
    const [ex, ey] = expectedFinal(corners, cropBoxSize, pivotPct, fullBox, 0, 1, point);
    closeTo(rx, ex, 1e-2);
    closeTo(ry, ey, 1e-2);
  }
});
