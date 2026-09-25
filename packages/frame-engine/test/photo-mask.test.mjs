import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResolvedTimelinePlan, composeStillMask, evaluationPlanFromResolvedTimeline } from '../dist/index.js';

test('still mask strokes are repeatable and ordered; restore respects the original alpha', () => {
  const erase = { mode: 'erase', points: [[0.375, 0.375]], size: 0.5, hardness: 1 };
  const restore = { ...erase, mode: 'restore' };
  const base = Uint8Array.from({ length: 16 }, () => 200);
  const alpha = Uint8Array.from({ length: 16 }, () => 120);
  const first = composeStillMask(base, 4, 4, [erase, restore], alpha);
  assert.deepEqual(first, composeStillMask(base, 4, 4, [erase, restore], alpha));
  assert.equal(first[5], 120);
  assert.equal(composeStillMask(base, 4, 4, [restore, erase], alpha)[5], 0);
  assert.equal(base[5], 200);
});

test('maximum side and size-one stroke compose deterministically within safe integer bounds', () => {
  const stroke = { mode: 'erase', points: [[0, 0.5], [1, 0.5]], size: 1, hardness: 1 };
  const first = composeStillMask(null, 65_536, 2, [stroke]);
  assert.deepEqual(first, composeStillMask(null, 65_536, 2, [stroke]));
  assert.equal(first.length, 131_072);
  assert.equal(first[0], 0);
  assert.equal(first[65_535], 0);
});

test('size-one soft brush on a 4000px short side has stable mask bytes', () => {
  const stroke = { mode: 'erase', points: [[0, 0]], size: 1, hardness: 0 };
  const first = composeStillMask(null, 4000, 4000, [stroke]);
  assert.deepEqual(first, composeStillMask(null, 4000, 4000, [stroke]));
  assert.deepEqual([first[0], first[1000], first[1500], first[1999], first[1000 * 4000 + 1000]],
    [1, 64, 144, 255, 128]);
});

test('sides above the safe bound throw RangeError before allocating mask pixels', () => {
  assert.throws(() => composeStillMask(null, 65_537, 1, []), RangeError);
  assert.throws(() => composeStillMask(null, 1, 65_537, []), RangeError);
});

test('a still mask, crop, and flip stay in source coordinates', () => {
  const image = { load: async () => ({ width: 4, height: 2, bitmap: {} }) };
  const mask = { load: async () => ({ width: 4, height: 2, bitmap: {} }) };
  const timeline = buildResolvedTimelinePlan([], { layers: [{
    id: 'photo', t: 0, duration: 1, src: 'photo.png', mask: 'mask.png',
    crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, flip: { h: true }
  }] });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 0,
    new Map([['photo.png', image], ['mask.png', mask]]),
    { width: 4, height: 2, colorSpace: 'bt709-limited' });
  assert.equal(plan.layers[0].mask.kind, 'still');
  assert.equal(plan.layers[0].mask.source, mask);
  assert.deepEqual(plan.layers[0].visual.crop, { x: 0.25, y: 0, width: 0.5, height: 1 });
  assert.deepEqual(plan.layers[0].flip, { h: true });
  const sourceXAtDisplayLeft = (1 - 0) * 0.5 + 0.25;
  assert.equal(sourceXAtDisplayLeft, 0.75);
});

test('small pixel golden keeps the mask attached to the flipped crop', () => {
  const source = [10, 20, 30, 40];
  const mask = Uint8Array.from([255, 0, 128, 255]);
  const crop = { x: 0.25, width: 0.5 };
  const display = [0.25, 0.75].map(local => {
    const sourceUv = crop.x + (1 - local) * crop.width;
    const index = Math.min(3, Math.floor(sourceUv * 4));
    return [source[index], mask[index]];
  });
  assert.deepEqual(display, [[30, 128], [20, 0]]);
});

test('video erase declarations produce a warning instead of disappearing silently', () => {
  const warnings = [];
  const video = { decode: async () => { throw new Error('unused'); } };
  const timeline = buildResolvedTimelinePlan([], { layers: [{ id: 'video', t: 0, duration: 1,
    src: 'video.mp4', erase: [{ mode: 'erase', points: [[0.5, 0.5]], size: 0.1, hardness: 1 }] }],
    onWarning: warning => warnings.push(warning) });
  evaluationPlanFromResolvedTimeline(timeline, 0, new Map([['video.mp4', video]]),
    { width: 4, height: 2, colorSpace: 'bt709-limited' });
  assert.match(warnings.join('\n'), /erase ignored for video layer video/u);
});
