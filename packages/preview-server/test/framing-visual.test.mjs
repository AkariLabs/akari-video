import assert from 'node:assert/strict';
import test from 'node:test';

import { checkCutFreezeCrossing, computeCutFramingVisual } from '../public/framing-visual.js';

// docs/contract-2026-07-22-render-basics.md #6/#7: unit-level coverage of the same math
// packages/render-cut/src/cut-framing.mjs / cut-freeze.mjs apply as an ffmpeg filtergraph,
// mirrored here as a browser CSS transform / crossing check for the Web preview
// (packages/preview-server/public/app.js). `applyTransform` simulates the CSS
// `transform-origin: 0 0; transform: <fn list>` composition (leftmost function applies
// last/outer) against sample points, then compares against `ffmpegReference`, an independent
// re-implementation of appendStaticCrop/appendKeyframeZoom's pixel math (fraction units, i.e.
// width = height = 1) -- a sign or ordering error in either implementation would show up as a
// geometric mismatch, not just a string-shape mismatch. This file is independent from (and does
// not import) the shell's equivalent test -- see framing-visual.js's header comment.

function applyTransform(cssTransform, point) {
  const fns = [...cssTransform.matchAll(/(\w+)\(([^)]*)\)/g)].map(m => ({
    name: m[1],
    args: m[2].split(',').map(s => parseFloat(s))
  }));
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

function ffmpegStaticCropReference(crop, point) {
  const cropW = Math.min(Math.max(crop.w, 0.002), 1);
  const cropH = Math.min(Math.max(crop.h, 0.002), 1);
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

test('crop with a non-positive dimension is unusable', () => {
  assert.equal(computeCutFramingVisual({ crop: { x: 0, y: 0, w: 0, h: 1 } }, 0), null);
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
  for (const point of [[0, 0], [1, 1], [0.25, 0.1], [0.75, 0.7], [0.5, 0.4]]) {
    const [ax, ay] = applyTransform(visual.transform, point);
    const [ex, ey] = ffmpegStaticCropReference(crop, point);
    closeTo(ax, ex);
    closeTo(ay, ey);
  }
});

test('static crop: full-frame crop (0,0,1,1) is the identity mapping (no-op boundary)', () => {
  const visual = computeCutFramingVisual({ crop: { x: 0, y: 0, w: 1, h: 1 } }, 0);
  for (const point of [[0, 0], [1, 1], [0.3, 0.8]]) {
    const [ax, ay] = applyTransform(visual.transform, point);
    closeTo(ax, point[0]);
    closeTo(ay, point[1]);
  }
});

test('crop and keyframes both declared -- keyframes wins (contract #6)', () => {
  const framing = {
    crop: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
    keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 1 }]
  };
  const visual = computeCutFramingVisual(framing, 0.5);
  const [x, y] = applyTransform(visual.transform, [0.5, 0.5]);
  closeTo(x, 0.5);
  closeTo(y, 0.5);
});

test('zoom keyframes: 2-point ramp reproduces the ffmpeg scale+crop mapping at start/mid/end', () => {
  const keyframes = [{ t: 0, scale: 1 }, { t: 2, scale: 3 }];
  for (const t of [0, 0.5, 1, 1.5, 2]) {
    const visual = computeCutFramingVisual({ keyframes }, t);
    const expectedScale = 1 + (3 - 1) * (t / 2);
    for (const point of [[0, 0], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
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
  closeTo(applyTransform(before.transform, [1, 0])[0], ffmpegZoomReference(2, 0.5, 0.5, [1, 0])[0]);
  const after = computeCutFramingVisual({ keyframes }, 5);
  closeTo(applyTransform(after.transform, [1, 0])[0], ffmpegZoomReference(4, 0.5, 0.5, [1, 0])[0]);
});

test('zoom keyframes: 3+ points piecewise-interpolate staged zoom levels', () => {
  const keyframes = [{ t: 0, scale: 1 }, { t: 1, scale: 2 }, { t: 3, scale: 2 }, { t: 4, scale: 4 }];
  const flatMid = computeCutFramingVisual({ keyframes }, 2);
  closeTo(applyTransform(flatMid.transform, [1, 1])[0], ffmpegZoomReference(2, 0.5, 0.5, [1, 1])[0]);
  const rampMid = computeCutFramingVisual({ keyframes }, 3.5);
  closeTo(applyTransform(rampMid.transform, [1, 1])[0], ffmpegZoomReference(3, 0.5, 0.5, [1, 1])[0]);
});

test('zoom keyframes: scale < 1 is clamped to 1 (reveal-beyond-frame is not representable)', () => {
  const keyframes = [{ t: 0, scale: 0.3 }, { t: 1, scale: 0.5 }];
  const visual = computeCutFramingVisual({ keyframes }, 0.5);
  const [x, y] = applyTransform(visual.transform, [0.5, 0.5]);
  closeTo(x, 0.5);
  closeTo(y, 0.5);
});

test('zoom keyframes: custom cx/cy pans the focus point (unclipped, focus lands at output center)', () => {
  const keyframes = [{ t: 0, scale: 2, cx: 0.4, cy: 0.6 }, { t: 1, scale: 2, cx: 0.4, cy: 0.6 }];
  const visual = computeCutFramingVisual({ keyframes }, 0.5);
  const [x, y] = applyTransform(visual.transform, [0.4, 0.6]);
  closeTo(x, 0.5);
  closeTo(y, 0.5);
});

test('zoom keyframes: near-edge focus point clamps the crop window instead of overshooting', () => {
  const keyframes = [{ t: 0, scale: 2, cx: 0.05, cy: 0.5 }, { t: 1, scale: 2, cx: 0.05, cy: 0.5 }];
  const visual = computeCutFramingVisual({ keyframes }, 0.5);
  closeTo(applyTransform(visual.transform, [0, 0.5])[0], 0);
});

test('non-finite cutLocalPlayedSeconds is treated as 0 rather than propagating NaN', () => {
  const visual = computeCutFramingVisual({ keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 3 }] }, NaN);
  closeTo(applyTransform(visual.transform, [0.5, 0.5])[0], 0.5);
});

// --- freeze crossing ---

test('no freeze declared: never holds', () => {
  assert.deepEqual(checkCutFreezeCrossing(undefined, 5), { shouldHold: false, holdSeconds: 0 });
  assert.deepEqual(checkCutFreezeCrossing(null, 5), { shouldHold: false, holdSeconds: 0 });
});

test('missing/invalid at_sec or non-positive duration_sec never holds', () => {
  assert.equal(checkCutFreezeCrossing({ duration_sec: 1 }, 5).shouldHold, false);
  assert.equal(checkCutFreezeCrossing({ at_sec: -1, duration_sec: 1 }, 5).shouldHold, false);
  assert.equal(checkCutFreezeCrossing({ at_sec: 1, duration_sec: 0 }, 5).shouldHold, false);
});

test('crossing behavior: before/at/after the freeze point', () => {
  assert.equal(checkCutFreezeCrossing({ at_sec: 2, duration_sec: 1.5 }, 1.999).shouldHold, false);
  const at = checkCutFreezeCrossing({ at_sec: 2, duration_sec: 1.5 }, 2);
  assert.equal(at.shouldHold, true);
  assert.equal(at.holdSeconds, 1.5);
  assert.equal(checkCutFreezeCrossing({ at_sec: 2, duration_sec: 1.5 }, 10).shouldHold, true);
});

test('at_sec = 0 holds immediately', () => {
  assert.equal(checkCutFreezeCrossing({ at_sec: 0, duration_sec: 0.5 }, 0).shouldHold, true);
});
