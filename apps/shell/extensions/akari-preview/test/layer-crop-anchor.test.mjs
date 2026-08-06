import assert from 'node:assert/strict';
import test from 'node:test';

import { cropAnchorCorrectedTransform } from '../lib/common/layer-crop-anchor.js';

// docs/contract-2026-08-02-preview-parity.md §2.4.1 crop pivot + 2026-08-06
// crop-handle-anchor-fix: dragging a crop handle must move only the dragged edge on screen --
// every other edge/corner of the crop rect stays exactly where it was.
//
// `screenPos` below is an INDEPENDENT reimplementation of shell's actual placement formula
// (akari-preview-open-handler.ts's layerScreenRectForVideoRect / updateStageScale:
// `left/top = outputSize/2 + transform.(x,y)`, `transform-origin = crop-rect-center%`,
// `transform: translate(-pivot%,-pivot%) rotate(deg)`), written from scratch here (not calling
// production code) so a shared bug in both implementations would not be masked.
function screenPos(sourcePx, crop, transform, videoWidth, videoHeight, outputWidth, outputHeight) {
    const pivotPx = {
        x: (crop.x + crop.w / 2) * videoWidth,
        y: (crop.y + crop.h / 2) * videoHeight,
    };
    const dx = sourcePx.x - pivotPx.x;
    const dy = sourcePx.y - pivotPx.y;
    const rad = transform.rotate * Math.PI / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return {
        x: outputWidth / 2 + transform.x + rx * transform.scale,
        y: outputHeight / 2 + transform.y + ry * transform.scale,
    };
}

function closeTo(actual, expected, epsilon = 1e-6) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

const VIDEO_W = 1920;
const VIDEO_H = 1080;
const OUTPUT_W = 1280;
const OUTPUT_H = 720;
const ORIGINAL_CROP = { x: 0.12, y: 0.2, w: 0.55, h: 0.45 };
const ORIGINAL_RIGHT = ORIGINAL_CROP.x + ORIGINAL_CROP.w;
const ORIGINAL_BOTTOM = ORIGINAL_CROP.y + ORIGINAL_CROP.h;

// direction -> [plausible post-drag crop, the corner (source-fraction) that must not move on
// screen given that crop change -- i.e. the corner(s) opposite whatever edge(s) the direction drags].
const CASES = {
    n: { next: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y + 0.08, w: ORIGINAL_CROP.w, h: ORIGINAL_CROP.h - 0.08 }, fixed: { x: ORIGINAL_CROP.x, y: ORIGINAL_BOTTOM } },
    s: { next: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y, w: ORIGINAL_CROP.w, h: ORIGINAL_CROP.h - 0.1 }, fixed: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y } },
    e: { next: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y, w: ORIGINAL_CROP.w - 0.15, h: ORIGINAL_CROP.h }, fixed: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y } },
    w: { next: { x: ORIGINAL_CROP.x + 0.07, y: ORIGINAL_CROP.y, w: ORIGINAL_CROP.w - 0.07, h: ORIGINAL_CROP.h }, fixed: { x: ORIGINAL_RIGHT, y: ORIGINAL_CROP.y } },
    ne: { next: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y + 0.06, w: ORIGINAL_CROP.w - 0.1, h: ORIGINAL_CROP.h - 0.06 }, fixed: { x: ORIGINAL_CROP.x, y: ORIGINAL_BOTTOM } },
    nw: { next: { x: ORIGINAL_CROP.x + 0.05, y: ORIGINAL_CROP.y + 0.06, w: ORIGINAL_CROP.w - 0.05, h: ORIGINAL_CROP.h - 0.06 }, fixed: { x: ORIGINAL_RIGHT, y: ORIGINAL_BOTTOM } },
    se: { next: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y, w: ORIGINAL_CROP.w - 0.1, h: ORIGINAL_CROP.h - 0.09 }, fixed: { x: ORIGINAL_CROP.x, y: ORIGINAL_CROP.y } },
    sw: { next: { x: ORIGINAL_CROP.x + 0.06, y: ORIGINAL_CROP.y, w: ORIGINAL_CROP.w - 0.06, h: ORIGINAL_CROP.h - 0.08 }, fixed: { x: ORIGINAL_RIGHT, y: ORIGINAL_CROP.y } },
};

for (const rotate of [0, 23]) {
    for (const [dir, { next, fixed }] of Object.entries(CASES)) {
        test(`${dir} handle keeps the opposite corner fixed on screen (rotate=${rotate})`, () => {
            const transform = { x: 143, y: -61, scale: 0.32, rotate };
            const fixedSourcePx = { x: fixed.x * VIDEO_W, y: fixed.y * VIDEO_H };
            const before = screenPos(fixedSourcePx, ORIGINAL_CROP, transform, VIDEO_W, VIDEO_H, OUTPUT_W, OUTPUT_H);
            const corrected = cropAnchorCorrectedTransform(ORIGINAL_CROP, next, transform, VIDEO_W, VIDEO_H);
            const correctedTransform = { ...transform, x: corrected.x, y: corrected.y };
            const after = screenPos(fixedSourcePx, next, correctedTransform, VIDEO_W, VIDEO_H, OUTPUT_W, OUTPUT_H);
            closeTo(after.x, before.x);
            closeTo(after.y, before.y);
        });
    }
}

test('identity crop change (no-op drag) leaves transform untouched', () => {
    const transform = { x: 10, y: -5, scale: 0.6, rotate: 12 };
    const corrected = cropAnchorCorrectedTransform(ORIGINAL_CROP, ORIGINAL_CROP, transform, VIDEO_W, VIDEO_H);
    closeTo(corrected.x, transform.x);
    closeTo(corrected.y, transform.y);
});

test('rotate=0 correction matches the simplified closed form x\' = x + (c1x-c0x)*videoWidth*scale', () => {
    const transform = { x: 5, y: 5, scale: 0.4, rotate: 0 };
    const next = CASES.se.next;
    const corrected = cropAnchorCorrectedTransform(ORIGINAL_CROP, next, transform, VIDEO_W, VIDEO_H);
    const c0x = ORIGINAL_CROP.x + ORIGINAL_CROP.w / 2;
    const c0y = ORIGINAL_CROP.y + ORIGINAL_CROP.h / 2;
    const c1x = next.x + next.w / 2;
    const c1y = next.y + next.h / 2;
    closeTo(corrected.x, transform.x + (c1x - c0x) * VIDEO_W * transform.scale);
    closeTo(corrected.y, transform.y + (c1y - c0y) * VIDEO_H * transform.scale);
});
