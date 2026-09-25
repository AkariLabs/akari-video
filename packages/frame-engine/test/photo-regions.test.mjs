import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPhotoRegions } from '../dist/adjust/photo-regions.js';
import { bakeItemAdjustLut } from '../dist/adjust/bake.js';
import { composeStillMask } from '../dist/mask/compose-still-mask.js';
import { buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline } from '../dist/timeline/plan.js';

test('person one is brighter while the background is monochrome in one ordered image', () => {
  const image = Uint8ClampedArray.from([80, 40, 20, 255, 30, 100, 180, 255]);
  const mask = Uint8Array.from([255, 0]);
  const regions = [
    { mask, adjustLut: bakeItemAdjustLut({ basic: { exposure: 1 } }) },
    { mask, invert: true, adjustLut: bakeItemAdjustLut({ basic: { saturation: -1 } }) },
  ];
  const result = applyPhotoRegions(image, 2, 1, undefined, regions);
  assert.deepEqual(result, applyPhotoRegions(image, 2, 1, undefined, regions));
  assert.ok(result[0] > image[0]);
  assert.equal(result[4], result[5]);
  assert.equal(result[5], result[6]);
  assert.deepEqual(image, Uint8ClampedArray.from([80, 40, 20, 255, 30, 100, 180, 255]));
});

test('mask smoothness softens the edge and remains repeatable', () => {
  const base = Uint8Array.from([255, 255, 0, 0, 0]);
  const soft = composeStillMask(base, 5, 1, [], undefined, 1);
  assert.deepEqual(soft, composeStillMask(base, 5, 1, [], undefined, 1));
  assert.ok(soft[1] < 255 && soft[1] > 0);
  assert.ok(soft[2] < 255 && soft[2] > 0);
  assert.deepEqual(composeStillMask(base, 5, 1, []), base);
});

test('blur stays inside the selected region', () => {
  const image = Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
  const result = applyPhotoRegions(image, 3, 1, undefined, [{ mask: Uint8Array.from([0, 255, 0]), blur: 1 }]);
  assert.deepEqual(Array.from(result.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(result.slice(8, 12)), [0, 255, 0, 255]);
  assert.notDeepEqual(Array.from(result.slice(4, 7)), [0, 0, 255]);
});

test('resolved still image carries ordered region masks and the shared preset id', () => {
  const image = { load: async () => ({ width: 2, height: 1, bitmap: {} }) };
  const mask = { load: async () => ({ width: 2, height: 1, bitmap: {} }) };
  const timeline = buildResolvedTimelinePlan([], { layers: [{ id: 'photo', t: 0, duration: 1,
    src: 'photo.png', regions: [{ id: 'person', maskRef: 'person.png', adjust: { basic: { exposure: 1 } } },
      { id: 'background', maskRef: 'person.png', invert: true, filter: { lut: 'mono' } }] }] });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 0, new Map([['photo.png', image], ['person.png', mask]]),
    { width: 2, height: 1, colorSpace: 'bt709-limited' });
  assert.equal(plan.layers[0].regions.length, 2);
  assert.equal(plan.layers[0].regions[0].mask, mask);
  assert.equal(plan.layers[0].regions[1].invert, true);
  assert.equal(plan.layers[0].regions[1].filterRef, 'mono');
});

test('export resolves a region mask path through the project media route', () => {
  const image = { load: async () => ({ width: 2, height: 1, bitmap: {} }) };
  const timeline = buildResolvedTimelinePlan([], { layers: [{ id: 'photo', t: 0, duration: 1,
    src: 'photo.png', regions: [{ id: 'person', maskRef: 'assets/masks/person.png' }] }] });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 0, new Map([['photo.png', image]]),
    { width: 2, height: 1, colorSpace: 'bt709-limited' });
  assert.equal(plan.layers[0].regions[0].maskUrl, '/media/assets/masks/person.png');
});
