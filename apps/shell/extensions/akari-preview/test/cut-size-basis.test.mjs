import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLayerKeyframesVisual as shellVisual } from '../lib/common/layer-keyframes-visual.js';
import { cutLayerStyleBoxPx } from '../lib/common/cut-layer-style-entry.js';
import { computeLayerKeyframesVisual as frameVisual } from '../../../../../packages/frame-engine/dist/timeline/layer-visual.js';

const points = [
  { t: 0, transform: { x: 10, scaleX: 1.1 } },
  { t: 2, transform: { x: 30, scaleX: 1.5 }, easing: 'ease-in-out' },
];
const statics = { x: 34, y: -17, scale: 1.2, scaleX: 1.5, scaleY: 0.8, rotate: 25 };

test('shell cut evaluator matches frame-engine axes, easing and static fallbacks', () => {
  for (const t of [-1, 0, 0.4, 1, 1.6, 2, 4]) {
    const shell = shellVisual(points, t, statics, true).transform;
    const frame = frameVisual(points, t, statics, true).transform;
    const { rotateDegrees, ...shared } = frame;
    assert.deepEqual(shell, { ...shared, rotate: rotateDegrees });
  }
});

test('shell cropped portrait box keeps source size and independent axes', () => {
  const box = cutLayerStyleBoxPx({ width: 100, height: 160 },
    { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, 1.5, 0.8);
  assert.equal(box.width, 75);
  assert.ok(Math.abs(box.height - 76.8) < 1e-9);
});

test('shell static crop box ignores output fit for wide and portrait sources', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
  for (const size of [{ width: 3840, height: 2160 }, { width: 1080, height: 1920 }]) {
    assert.deepEqual(cutLayerStyleBoxPx(size, crop, 1.2),
      { width: size.width * 0.5 * 1.2, height: size.height * 0.6 * 1.2 });
  }
});
