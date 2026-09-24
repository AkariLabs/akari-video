import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline,
  cutLayerStyleBox, cutLayerStyleSourceUv } from '../dist/index.js';

const output = { width: 640, height: 360, colorSpace: 'bt709-limited' };
const source = { decode: async () => { throw Error('unused'); }, logicalSize: { width: 100, height: 160 } };
const point = (t, transform) => ({ t, transform });
const base = { id: 'cut', src: 'portrait.png', in: 0, out: 6,
  transform: { x: 34, y: -17, scale: 1.2, rotate: 25 } };
const at = (cut, seconds = 1) => evaluationPlanFromResolvedTimeline(
  buildResolvedTimelinePlan([cut], { fps: 30 }), Math.round(seconds * 1e6),
  new Map([['portrait.png', source]]), output,
).base[0].visual;

test('0, 1 and 2 equal transform points retain the fit visual for a portrait cut', () => {
  const unkeyed = at(base);
  const one = at({ ...base, keyframes: [point(1, { ...base.transform })] });
  const two = at({ ...base, keyframes: [point(1, { ...base.transform }), point(3, { ...base.transform })] });
  assert.deepEqual(one, unkeyed);
  assert.deepEqual(two, unkeyed);
  assert.equal(two.layerStyle, undefined);
});

test('different points interpolate position, size and rotation on the fit path', () => {
  const cut = { ...base, keyframes: [point(1, { x: 0, y: 0, scale: 1, rotate: 0 }),
    point(3, { x: 40, y: -20, scale: 1.4, rotate: 40 })] };
  const visual = at(cut, 2);
  assert.equal(visual.layerStyle, undefined);
  assert.deepEqual(visual.transform, { x: 20, y: -10, scale: 1.2, rotateDegrees: 20 });
});

test('cut points fill absent fields from static transform; layers retain their existing defaults', async () => {
  const { computeLayerKeyframesVisual } = await import('../dist/timeline/layer-visual.js');
  const statics = { x: 34, y: -17, scale: 1.2, scaleX: 1.5, scaleY: 0.8, rotate: 25 };
  const points = [point(0, { x: 10 }), point(2, { x: 30 })];
  const cut = computeLayerKeyframesVisual(points, 1, statics, true).transform;
  assert.deepEqual(cut, { x: 20, y: -17, scale: 1.2, scaleX: 1.5, scaleY: 0.8, rotateDegrees: 25 });
  const layer = computeLayerKeyframesVisual(points, 1, statics).transform;
  assert.equal(layer.y, 0);
  assert.equal(layer.scale, 1);
});

test('static crop keeps the baseline source-sized box at 0 and 2 transform-only points', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
  for (const { size, canvas } of [
    { size: [3840, 2160], canvas: [1920, 1080] },
    { size: [1080, 1920], canvas: [1920, 1080] },
  ]) {
    const video = { decode: async () => { throw Error('unused'); },
      logicalSize: { width: size[0], height: size[1] } };
    const evaluate = cut => evaluationPlanFromResolvedTimeline(
      buildResolvedTimelinePlan([cut], { fps: 30 }), 1e6,
      new Map([['portrait.png', video]]),
      { width: canvas[0], height: canvas[1], colorSpace: 'bt709-limited' },
    ).base[0].visual;
    const unkeyed = evaluate({ ...base, crop });
    const keyed = evaluate({ ...base, crop, keyframes: [
      point(1, { ...base.transform }), point(3, { ...base.transform }),
    ] });
    assert.deepEqual(keyed, unkeyed);
    const expected = { width: size[0] * crop.w * base.transform.scale,
      height: size[1] * crop.h * base.transform.scale };
    assert.deepEqual(cutLayerStyleBox(unkeyed, ...size), expected);
    assert.deepEqual(cutLayerStyleBox(keyed, ...size), expected);
  }
});

test('perspective keyframe points retain the source-sized cut box', () => {
  const perspective = { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] };
  const visual = at({ ...base, keyframes: [
    { t: 1, perspective }, { t: 3, perspective },
  ] });
  assert.deepEqual(cutLayerStyleBox(visual, 100, 160), { width: 120, height: 192 });
});

test('crop box keeps source-sized basis with independent axes and rotation inverse', () => {
  const visual = at({ ...base, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
    transform: { x: 34, y: -17, scale: 1.2, scaleX: 1.5, scaleY: 0.8, rotate: 25 } });
  const box = cutLayerStyleBox(visual, 100, 160);
  assert.equal(box.width, 75);
  assert.ok(Math.abs(box.height - 76.8) < 1e-9);
  const center = cutLayerStyleSourceUv(visual, 100, 160, 640, 360, 354, 163);
  assert.ok(Math.abs(center[0] - 0.35) < 1e-9);
  assert.ok(Math.abs(center[1] - 0.5) < 1e-9);
});
