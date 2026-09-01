import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameMetrics } from '../dist/index.js';

test('FrameMetrics emits every detailed p50/p95 stage', () => {
  const metrics = new FrameMetrics();
  for (const stage of [
    'decode', 'tick', 'copy', 'copyTo', 'planeCompact', 'upload', 'shader', 'shaderGpu',
    'present', 'readback', 'pboWait', 'rowFlip', 'sink', 'ipcWrite', 'ffmpegDrain', 'ffmpegClose'
  ]) {
    metrics.record(stage, 1);
    metrics.record(stage, 3);
    metrics.record(stage, 2);
  }
  const output = metrics.toJSON();
  for (const stage of [
    'decode', 'tick', 'copy', 'copyTo', 'planeCompact', 'upload', 'shader', 'shaderGpu',
    'present', 'readback', 'pboWait', 'rowFlip', 'sink', 'ipcWrite', 'ffmpegDrain', 'ffmpegClose'
  ]) {
    assert.equal(output[stage].count, 3);
    assert.equal(output[stage].p50Ms, 2);
    assert.equal(output[stage].p95Ms, 3);
  }
  assert.equal(output.uploadPath, null);
  assert.deepEqual(output.uploadPathCounts, { direct: 0, copyTo: 0 });
  metrics.recordUploadPath('direct');
  metrics.recordUploadPath('copyTo');
  const routed = metrics.toJSON();
  assert.equal(routed.uploadPath, 'copyTo');
  assert.deepEqual(routed.uploadPathCounts, { direct: 1, copyTo: 1 });
});

// toJSON() runs after every frame is already encoded, so a throw here discards a finished export.
// 130k samples is one stage of a ~72 minute 30fps render and sits past the ~125k argument ceiling
// that Math.max(...values) hit on Node 22.
test('a long render summarizes without overflowing the stack', () => {
  const metrics = new FrameMetrics();
  const samples = 130_000;
  for (let index = 0; index < samples; index += 1) {
    metrics.record('decode', index === 4242 ? 999 : 1);
  }
  const output = metrics.toJSON();
  assert.equal(output.decode.count, samples);
  assert.equal(output.decode.maxMs, 999);
  assert.equal(output.decode.p50Ms, 1);
});
