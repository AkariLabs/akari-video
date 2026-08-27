import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFrame, FrameMetrics } from '../dist/index.js';

const visual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1
};

function fakeFrame() {
  return {
    format: 'NV12',
    codedWidth: 2,
    codedHeight: 2,
    allocationSize() { return 6; },
    async copyTo(bytes) {
      bytes.set([16, 16, 16, 16, 128, 128]);
      return [{ offset: 0, stride: 2 }, { offset: 4, stride: 2 }];
    },
    close() {}
  };
}

test('evaluateFrame routes transition layers to independent cut stream IDs', async () => {
  const requests = [];
  const source = {
    async decode(timeUs, _metrics, request) {
      requests.push({ timeUs, streamId: request?.streamId });
      return fakeFrame();
    }
  };
  const surface = {
    canvas: {}, width: 2, height: 2,
    async readRgba() { return new Uint8Array(16); },
    recordSink() {}, close() {}
  };
  const compositor = {
    kind: 'webgl2',
    async compose() { return surface; },
    dispose() {}
  };
  const frame = await evaluateFrame({
    timeUs: 500_000,
    base: [
      { id: 'cut-6', source, sourceTimeUs: 700_000, visual },
      { id: 'cut-7', source, sourceTimeUs: 1_000_000, visual }
    ],
    layers: [],
    transition: { type: 'dissolve', progress: 0.5 },
    output: { width: 2, height: 2, colorSpace: 'bt709-limited' }
  }, { compositor, metrics: new FrameMetrics() });
  assert.deepEqual(requests, [
    { timeUs: 700_000, streamId: 'cut-6' },
    { timeUs: 1_000_000, streamId: 'cut-7' }
  ]);
  frame.close();
});
