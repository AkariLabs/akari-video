import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameMetrics } from '../dist/index.js';

test('FrameMetrics emits all six p50/p95 stages', () => {
  const metrics = new FrameMetrics();
  for (const stage of ['decode', 'copy', 'upload', 'shader', 'readback', 'sink']) {
    metrics.record(stage, 1);
    metrics.record(stage, 3);
    metrics.record(stage, 2);
  }
  const output = metrics.toJSON();
  for (const stage of Object.keys(output)) {
    assert.equal(output[stage].count, 3);
    assert.equal(output[stage].p50Ms, 2);
    assert.equal(output[stage].p95Ms, 3);
  }
});
