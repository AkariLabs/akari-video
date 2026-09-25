import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { previewMotionGeometryTransform, previewMotionBoxHitAt } from '../lib/common/preview-motion-geometry.js';
import { layerDeclaredGeometryHitAt } from '../lib/common/layer-declared-geometry.js';

const require = createRequire(import.meta.url);
const { evaluateItemMotion } = require('../../../../../packages/overlay-runtime/src/item-motion.js');

test('a layer is hit and framed at its evaluated entrance position', () => {
    const output = { width: 640, height: 360 };
    const item = { at: 0, duration: 4, fps: 30, keyframeUnit: 'seconds',
        transform: { x: -200, y: 0, scale: .25, rotate: 0 },
        keyframes: [{ t: 0, transform: { x: -200 } }, { t: 4, transform: { x: 200 } }],
        motion: { in: { preset: 'slide-up', duration: 30, amount: 100 } } };
    const base = { x: -150, y: 0, scale: .25, rotate: 0 };
    const pose = previewMotionGeometryTransform(base, evaluateItemMotion(item, .5));
    const sourceSize = { width: 360, height: 360 };
    const crop = { x: 0, y: 0, w: 1, h: 1 };
    const centre = { x: 320 + pose.x, y: 180 + pose.y };
    assert.deepEqual(centre, { x: 170, y: 230 });
    assert.equal(layerDeclaredGeometryHitAt(sourceSize, output, base, crop, centre), false);
    assert.equal(layerDeclaredGeometryHitAt(sourceSize, output, pose, crop, centre), true);
    assert.equal(previewMotionBoxHitAt({ centerX: centre.x, centerY: centre.y,
        width: 90, height: 90, rotate: pose.rotate }, centre), true);
    assert.equal(previewMotionBoxHitAt({ centerX: 170, centerY: 180,
        width: 90, height: 90, rotate: 0 }, centre), false);
});

test('parent scale and rotation determine the child hit box and live position', () => {
    const item = { at: 0, duration: 4, fps: 30,
        transform: { x: 20, y: 0, scale: .5, rotate: 10 } };
    const parent = { at: 0, duration: 4, fps: 30,
        transform: { x: 100, y: 50, scale: 2, rotate: 90 } };
    const evaluated = evaluateItemMotion(item, 1, [parent]);
    const pose = previewMotionGeometryTransform(item.transform, evaluated);
    assert.equal(pose.x, 100);
    assert.equal(pose.y, 90);
    assert.equal(pose.scale, 1);
    assert.equal(pose.rotate, 100);
    const moved = previewMotionGeometryTransform(item.transform, evaluated, { x: 180, y: 90 });
    assert.equal(moved.x, 180);
    assert.equal(moved.y, 90);
    assert.equal(moved.scale, 1);
    assert.equal(previewMotionBoxHitAt({ centerX: moved.x, centerY: moved.y,
        width: 100, height: 50, rotate: moved.rotate }, { x: 180, y: 90 }), true);
});
