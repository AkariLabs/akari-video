import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline, computeLayerKeyframesVisual,
  forwardInverse, cutLayerStyleBox } from '../dist/index.js';

test('axis keyframes resolve mixed uniform endpoints', () => {
  const result = computeLayerKeyframesVisual([
    { t: 0, transform: { scale: 1 } }, { t: 2, transform: { scaleX: 2, scaleY: 0.5 } },
  ], 1);
  assert.equal(result.transform.scaleX, 1.5);
  assert.equal(result.transform.scaleY, 0.75);
});
test('plan preserves axis overrides for layers and both cut geometries', () => {
  const source = { decode: async () => { throw new Error('unused'); } };
  for (const crop of [undefined, { x: 0, y: 0, w: 1, h: 1 }]) {
    const transform = { scale: 3, scaleX: 2, scaleY: 0.5 };
    const timeline = buildResolvedTimelinePlan([{ src: 'a', in: 0, out: 2, transform, ...(crop ? { crop } : {}) }], {
      layers: [{ id: 'leaf', src: 'a', t: 0, duration: 2, transform }],
    });
    const plan = evaluationPlanFromResolvedTimeline(timeline, 1e6, new Map([['a', source]]),
      { width: 640, height: 360, colorSpace: 'bt709-limited' });
    for (const visual of [plan.base[0].visual, plan.layers[0].visual]) {
      assert.equal(visual.transform.scaleX, 2); assert.equal(visual.transform.scaleY, 0.5);
    }
  }
});
test('WebGL crop box uses width and height independently and its inverse maps corners', () => {
  const transform = { x: 0, y: 0, scale: 3, scaleX: 2, scaleY: 0.5, rotateDegrees: 0 };
  const crop = { x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(cutLayerStyleBox({ transform, layerStyle: { crop } }, 100, 80), { width: 200, height: 40 });
  const inverse = forwardInverse({ transform, crop, perspective: null }, 100, 80, 640, 360);
  const map = (x, y) => [inverse[0] * x + inverse[3] * y + inverse[6], inverse[1] * x + inverse[4] * y + inverse[7]];
  for (const [actual, expected] of [[map(220, 160), [0, 0]], [map(420, 200), [1, 1]]]) {
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
  }
});
