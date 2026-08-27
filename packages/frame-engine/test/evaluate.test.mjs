import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFrame, FrameMetrics } from '../dist/index.js';

const visual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1
};

function fakeFrame(timestamp = 0) {
  return {
    format: 'NV12',
    timestamp,
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

test('evaluateFrame decodes matte color and mask at one time on independent streams', async () => {
  const requests = [];
  const colorSource = {
    async decode(timeUs, _metrics, request) {
      requests.push({ source: 'color', timeUs, streamId: request?.streamId });
      return fakeFrame(timeUs);
    }
  };
  const maskSource = {
    async decode(timeUs, _metrics, request) {
      requests.push({ source: 'mask', timeUs, streamId: request?.streamId });
      return fakeFrame(timeUs);
    }
  };
  const surface = {
    canvas: {}, width: 2, height: 2,
    async readRgba() { return new Uint8Array(16); },
    recordSink() {}, close() {}
  };
  let composedLayers;
  const compositor = {
    kind: 'webgl2',
    async compose(_base, layers) { composedLayers = layers; return surface; },
    dispose() {}
  };
  const sourceTimeUs = 733_333;
  const frame = await evaluateFrame({
    timeUs: 500_000,
    base: [],
    layers: [{
      id: 'person', kind: 'matte', source: colorSource, sourceTimeUs,
      mask: { kind: 'greyscale', source: maskSource, sourceTimeUs },
      visual: { crop:{x:0,y:0,width:1,height:1}, perspective:null, transform:{x:0,y:0,scale:1,rotateDegrees:0} },
      blend: 'normal', opacity: 1
    }],
    transition: { type: 'hard-cut', progress: 0 },
    output: { width: 2, height: 2, colorSpace: 'bt709-limited' }
  }, { compositor, metrics: new FrameMetrics() });
  assert.deepEqual(requests, [
    { source: 'color', timeUs: sourceTimeUs, streamId: 'layer-person' },
    { source: 'mask', timeUs: sourceTimeUs, streamId: 'layer-person-mask' }
  ]);
  assert.equal(composedLayers[0].color.format, 'NV12');
  assert.equal(composedLayers[0].mask.format, 'NV12');
  assert.deepEqual(frame.maskSync, [{
    layerId: 'person', colorTimestamp: sourceTimeUs, maskTimestamp: sourceTimeUs, requestedUs: sourceTimeUs
  }]);
  frame.close();
});
