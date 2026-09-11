import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveNearestFrameDefault,
  sampleAtPresentationTime,
} from '../dist/index.js';

function sample(timestampUs, decodeIndex) {
  return {
    offset: 0,
    size: 1,
    dts: decodeIndex,
    cts: decodeIndex,
    duration: 1,
    timescale: 30,
    isSync: decodeIndex === 0,
    timestampUs,
    durationUs: 33_333,
    decodeIndex,
    presentationIndex: decodeIndex,
    decodeEndIndex: decodeIndex,
  };
}

function table(timestamps) {
  return {
    samples: timestamps.map(sample),
    presentationOrder: timestamps.map((_, index) => index),
  };
}

test('VFR sample table maps to the nearest timestamp while floor mode selects the prior frame', () => {
  const source = table([15_666_667, 15_701_667, 15_733_334]);
  const originalEnv = process.env.AKARI_FRAME_ENGINE_NEAREST;
  const originalGlobal = globalThis.__AKARI_FRAME_ENGINE_NEAREST__;
  try {
    delete process.env.AKARI_FRAME_ENGINE_NEAREST;
    delete globalThis.__AKARI_FRAME_ENGINE_NEAREST__;
    assert.equal(resolveNearestFrameDefault(), true);
    assert.equal(sampleAtPresentationTime(source, 15_700_000).timestampUs, 15_701_667);

    process.env.AKARI_FRAME_ENGINE_NEAREST = '0';
    assert.equal(resolveNearestFrameDefault(), false);
    assert.equal(sampleAtPresentationTime(source, 15_700_000).timestampUs, 15_666_667);

    globalThis.__AKARI_FRAME_ENGINE_NEAREST__ = true;
    assert.equal(resolveNearestFrameDefault(), true, 'global override takes precedence');
    globalThis.__AKARI_FRAME_ENGINE_NEAREST__ = false;
    delete process.env.AKARI_FRAME_ENGINE_NEAREST;
    assert.equal(resolveNearestFrameDefault(), false);
    assert.equal(sampleAtPresentationTime(source, 15_700_000).timestampUs, 15_666_667);
  } finally {
    if (originalEnv === undefined) delete process.env.AKARI_FRAME_ENGINE_NEAREST;
    else process.env.AKARI_FRAME_ENGINE_NEAREST = originalEnv;
    if (originalGlobal === undefined) delete globalThis.__AKARI_FRAME_ENGINE_NEAREST__;
    else globalThis.__AKARI_FRAME_ENGINE_NEAREST__ = originalGlobal;
  }
});

test('CFR grid timestamps retain the same frame and midpoint ties select the earlier sample', () => {
  const source = table([0, 33_333, 66_667, 100_000]);
  assert.equal(sampleAtPresentationTime(source, 66_667).timestampUs, 66_667);
  assert.equal(sampleAtPresentationTime(source, 50_000).timestampUs, 33_333);
  assert.equal(sampleAtPresentationTime(source, -1).timestampUs, 0);
  assert.equal(sampleAtPresentationTime(source, 200_000).timestampUs, 100_000);
});
