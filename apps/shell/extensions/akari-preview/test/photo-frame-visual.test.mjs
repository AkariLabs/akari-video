import test from 'node:test';
import assert from 'node:assert/strict';
import { photoFrameVisual } from '../lib/common/photo-frame-visual.js';

const input = { crop: { x: .3418, y: .012, w: .1678, h: .5302, rotate: 5 },
    frame: { stroke: { color: '#ffffff', width: 8 }, cornerRadius: 40 },
    sourceWidth: 1920, sourceHeight: 1080, scaleX: 1.215, scaleY: .72,
    outputWidth: 1080, outputHeight: 1920, x: 0, y: 0, rotate: 0 };

test('frame stroke and round corners are measured after anisotropic stretch', () => {
    const visual = photoFrameVisual(input);
    assert.ok(Math.abs(visual.strokePx - 4.5) < 1e-10);
    assert.ok(Math.abs(visual.radiusPx - Math.min(visual.box.width, visual.box.height) * .2) < 1e-10);
    const points = [...visual.clipPath.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map(match =>
        [Number(match[1]) / 100 * input.sourceWidth, Number(match[2]) / 100 * input.sourceHeight]);
    const [a, b, c, d] = visual.ghostMatrix.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
    const centerX = (input.crop.x + input.crop.w / 2) * input.sourceWidth;
    const centerY = (input.crop.y + input.crop.h / 2) * input.sourceHeight;
    const outputPoint = ([x, y]) => {
        const px = (x - centerX) * input.scaleX, py = (y - centerY) * input.scaleY;
        return [a * px + c * py, b * px + d * py];
    };
    const center = [-visual.box.width / 2 + visual.radiusPx, -visual.box.height / 2 + visual.radiusPx];
    for (const point of [points[0], points[4], points[8], points[16]]) {
        const [x, y] = outputPoint(point);
        assert.ok(Math.abs(Math.hypot(x - center[0], y - center[1]) - visual.radiusPx) < 1e-7);
    }
});

test('photo frame keeps a four-corner crop when rounding is absent', () => {
    const visual = photoFrameVisual({ ...input, frame: undefined });
    assert.equal([...visual.clipPath.matchAll(/%/g)].length, 8);
    assert.equal(visual.strokePx, 0);
});

test('full-photo ghost and crop image use the same rotated source map', () => {
    const visual = photoFrameVisual({ ...input, frame: undefined, rotate: 0 });
    assert.equal(visual.ghostMatrix, visual.mediaMatrix);
    assert.notEqual(visual.ghostMatrix, 'matrix(1, 0, 0, 1, 0, 0)');
});
