import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exactTickContinuationTarget,
  frameCoversTimestamp,
  sampleAtPresentationTime,
} from '../dist/index.js';
import { frameCovers } from '../dist/decode/range-mp4-source.js';

const TIMESCALE = 15_360;
const FRAME_TICKS = 512;
const timestampUs = frame => Math.round(frame * FRAME_TICKS / TIMESCALE * 1e6);
const midpointUs = frame => Math.round((frame + 0.5) * FRAME_TICKS / TIMESCALE * 1e6);
const durationUs = Math.round(FRAME_TICKS / TIMESCALE * 1e6);
const frame = number => ({ timestamp: timestampUs(number), duration: durationUs });
const sample = number => ({ timestampUs: timestampUs(number), presentationIndex: number });
const table = {
  samples: Array.from({ length: 123 }, (_, index) => sample(index)),
  presentationOrder: Array.from({ length: 123 }, (_, index) => index),
};

test('quantized 15360-timescale midpoint selects frame 120 across sample table and both coverage paths', () => {
  const target = midpointUs(120);
  assert.equal(target, 4_016_667);
  assert.equal(timestampUs(120), 4_000_000);
  assert.equal(timestampUs(121), 4_033_333);
  assert.equal(durationUs, 33_333);
  assert.equal(sampleAtPresentationTime(table, target).presentationIndex, 120);
  for (const covers of [frameCoversTimestamp, frameCovers]) {
    assert.equal(covers(frame(120), target), true);
    assert.equal(covers(frame(121), target), false);
    assert.equal(covers(frame(120), target + 1), false, 'true non-tie chooses frame 121');
    assert.equal(covers(frame(121), target + 1), true);
  }
  assert.equal(exactTickContinuationTarget(frame(120), target), null);
  assert.equal(exactTickContinuationTarget(frame(120), target + 1), 4_033_334);
  assert.equal(sampleAtPresentationTime(table, target + 1).presentationIndex, 121);
});

test('oppositely rounded midpoint at frame 29 still selects earlier, and floor switch stays half-open', () => {
  const target = midpointUs(29);
  assert.equal(target, 983_333);
  assert.equal(sampleAtPresentationTime(table, target).presentationIndex, 29);
  for (const covers of [frameCoversTimestamp, frameCovers]) {
    assert.equal(covers(frame(29), target), true);
    assert.equal(covers(frame(30), target), false);
  }
  assert.equal(exactTickContinuationTarget(frame(29), target), null);

  const originalEnv = process.env.AKARI_FRAME_ENGINE_NEAREST;
  const originalGlobal = globalThis.__AKARI_FRAME_ENGINE_NEAREST__;
  try {
    delete globalThis.__AKARI_FRAME_ENGINE_NEAREST__;
    process.env.AKARI_FRAME_ENGINE_NEAREST = '0';
    const tie = midpointUs(120);
    assert.equal(sampleAtPresentationTime(table, tie).presentationIndex, 120);
    for (const covers of [frameCoversTimestamp, frameCovers]) {
      assert.equal(covers(frame(120), tie), true);
      assert.equal(covers(frame(121), tie), false);
      assert.equal(covers(frame(120), tie + 1), true);
    }
    assert.equal(exactTickContinuationTarget(frame(120), tie), null);
  } finally {
    if (originalEnv === undefined) delete process.env.AKARI_FRAME_ENGINE_NEAREST;
    else process.env.AKARI_FRAME_ENGINE_NEAREST = originalEnv;
    if (originalGlobal === undefined) delete globalThis.__AKARI_FRAME_ENGINE_NEAREST__;
    else globalThis.__AKARI_FRAME_ENGINE_NEAREST__ = originalGlobal;
  }
});
