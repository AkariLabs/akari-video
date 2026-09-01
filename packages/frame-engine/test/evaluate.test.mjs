import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DirectUploadFallbackError,
  evaluateFrame,
  FrameMetrics,
} from '../dist/index.js';

const visual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1
};

function fakeFrame(timestamp = 0, format = 'NV12') {
  let closed = false;
  let copies = 0;
  return {
    format,
    timestamp,
    codedWidth: 2,
    codedHeight: 2,
    displayWidth: 2,
    displayHeight: 2,
    visibleRect: null,
    allocationSize() { return 6; },
    async copyTo(bytes) {
      copies += 1;
      bytes.set([16, 16, 16, 16, 128, 128]);
      return [{ offset: 0, stride: 2 }, { offset: 4, stride: 2 }];
    },
    close() { closed = true; },
    get closed() { return closed; },
    get copies() { return copies; },
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

test('evaluateFrame passes VideoFrame through direct upload and closes it', async () => {
  const decoded = fakeFrame(123);
  let received;
  const compositor = {
    kind: 'webgl2',
    uploadPath: 'direct',
    async compose(base) {
      received = base[0];
      return {
        canvas: {}, width: 2, height: 2,
        async readRgba() { return new Uint8Array(16); },
        recordSink() {}, close() {},
      };
    },
    dispose() {},
  };
  const metrics = new FrameMetrics();
  const frame = await evaluateFrame({
    timeUs: 123,
    base: [{
      id: 'cut',
      source: { async decode() { return decoded; } },
      sourceTimeUs: 123,
      visual,
    }],
    layers: [],
    output: { width: 2, height: 2, colorSpace: 'bt709-limited' },
  }, { compositor, metrics });

  assert.equal(received, decoded);
  assert.equal(decoded.copies, 0);
  assert.equal(decoded.closed, true);
  assert.equal(frame.uploadPath, 'direct');
  assert.equal(metrics.toJSON().uploadPath, 'direct');
  frame.close();
});

test('copyTo path passes packed RGB VideoFrame through without native YUV copy', async () => {
  const decoded = fakeFrame(456, 'RGBA');
  let received;
  const compositor = {
    kind: 'webgl2',
    uploadPath: 'copyTo',
    async compose(base) {
      received = base[0];
      return {
        canvas: {}, width: 2, height: 2,
        async readRgba() { return new Uint8Array(16); },
        recordSink() {}, close() {},
      };
    },
    dispose() {},
  };
  const metrics = new FrameMetrics();
  const frame = await evaluateFrame({
    timeUs: 456,
    base: [{
      id: 'rotated-cut',
      source: { async decode() { return decoded; } },
      sourceTimeUs: 456,
      visual,
    }],
    layers: [],
    output: { width: 2, height: 2, colorSpace: 'bt709-limited' },
  }, { compositor, metrics });

  assert.equal(received, decoded);
  assert.equal(decoded.copies, 0);
  assert.equal(decoded.closed, true);
  assert.deepEqual(frame.nativeFormats, []);
  assert.equal(frame.uploadPath, 'copyTo');
  frame.close();
});

test('evaluateFrame retries a failed direct upload once through copyTo and closes all frames', async () => {
  const color = fakeFrame(321);
  const mask = fakeFrame(321);
  let path = 'direct';
  let attempts = 0;
  const compositor = {
    kind: 'webgl2',
    get uploadPath() { return path; },
    async compose(_base, layers) {
      attempts += 1;
      if (attempts === 1) {
        assert.equal(layers[0].color, color);
        assert.equal(layers[0].mask, mask);
        path = 'copyTo';
        throw new DirectUploadFallbackError('synthetic upload failure');
      }
      assert.equal(layers[0].color.format, 'NV12');
      assert.equal(layers[0].mask.format, 'NV12');
      return {
        canvas: {}, width: 2, height: 2,
        async readRgba() { return new Uint8Array(16); },
        recordSink() {}, close() {},
      };
    },
    dispose() {},
  };
  const metrics = new FrameMetrics();
  const frame = await evaluateFrame({
    timeUs: 321,
    base: [],
    layers: [{
      id: 'matte', kind: 'matte',
      source: { async decode() { return color; } },
      sourceTimeUs: 321,
      mask: {
        kind: 'greyscale',
        source: { async decode() { return mask; } },
        sourceTimeUs: 321,
      },
      visual: {
        crop: { x: 0, y: 0, width: 1, height: 1 },
        perspective: null,
        transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
      },
      blend: 'normal', opacity: 1,
    }],
    output: { width: 2, height: 2, colorSpace: 'bt709-limited' },
  }, { compositor, metrics });

  assert.equal(attempts, 2);
  assert.equal(color.copies, 1);
  assert.equal(mask.copies, 1);
  assert.equal(color.closed, true);
  assert.equal(mask.closed, true);
  assert.equal(frame.uploadPath, 'copyTo');
  assert.equal(metrics.toJSON().uploadPath, 'copyTo');
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

test('evaluateFrame preserves filter slots without decoding them', async () => {
  const surface = { canvas:{}, width:2, height:2, async readRgba(){ return new Uint8Array(16); }, recordSink(){}, close(){} };
  let received;
  const compositor = { kind:'webgl2', async compose(_base, layers){ received = layers; return surface; }, dispose(){} };
  const frame = await evaluateFrame({
    timeUs:0, base:[],
    layers:[{ id:'f', kind:'filter', filter:{type:'invert'}, corners:[[0,0],[1,0],[0,1],[1,1]], opacity:1 }],
    output:{ width:2,height:2,colorSpace:'bt709-limited' },
  }, { compositor, metrics:new FrameMetrics() });
  assert.deepEqual(received, [{ kind:'filter' }]);
  assert.deepEqual(frame.nativeFormats, []);
  frame.close();
});

test('evaluateFrame loads a still image base without decoding and passes the bitmap through both upload paths (issue #30)', async () => {
  const bitmap = { bitmap: { close() {} }, width: 2, height: 2 };
  let loads = 0;
  const image = { async load() { loads += 1; return bitmap; }, destroy() {} };
  const surface = {
    canvas: {}, width: 2, height: 2,
    async readRgba() { return new Uint8Array(16); },
    recordSink() {}, close() {}
  };
  for (const uploadPath of ['direct', 'copyTo']) {
    let received;
    const compositor = {
      kind: 'webgl2',
      uploadPath,
      async compose(base) { received = base; return surface; },
      dispose() {}
    };
    const frame = await evaluateFrame({
      timeUs: 0,
      base: [{ kind: 'image', id: 'cut-0', image, sourceTimeUs: 0, visual }],
      layers: [],
      transition: { type: 'hard-cut', progress: 0 },
      output: { width: 2, height: 2, colorSpace: 'bt709-limited' }
    }, { compositor, metrics: new FrameMetrics() });
    assert.equal(received.length, 1);
    assert.equal(received[0], bitmap);
    assert.equal(frame.uploadPath, uploadPath);
    assert.deepEqual(frame.nativeFormats, []);
    frame.close();
  }
  assert.equal(loads, 2);
});
