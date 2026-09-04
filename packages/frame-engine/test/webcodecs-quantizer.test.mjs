import assert from "node:assert/strict";
import test from "node:test";

import { WebCodecsH264Encoder } from "../dist/exits/webcodecs.js";

class StubVideoEncoder extends EventTarget {
  static latest = null;
  static supported = true;
  static probeCalls = 0;

  constructor(init) {
    super();
    this.init = init;
    this.encoded = [];
    StubVideoEncoder.latest = this;
  }

  static async isConfigSupported(config) {
    StubVideoEncoder.probeCalls += 1;
    return { supported: StubVideoEncoder.supported, config };
  }

  get encodeQueueSize() { return 0; }
  configure(config) { this.config = config; }
  encode(frame, options) { this.encoded.push({ frame, options }); }
  async flush() {}
  close() {}
}

class StubVideoFrame {
  constructor(canvas, init) {
    this.canvas = canvas;
    this.timestamp = init.timestamp;
    this.closed = false;
  }

  close() { this.closed = true; }
}

function installStubs() {
  StubVideoEncoder.latest = null;
  StubVideoEncoder.supported = true;
  StubVideoEncoder.probeCalls = 0;
  globalThis.VideoEncoder = StubVideoEncoder;
  globalThis.VideoFrame = StubVideoFrame;
}

const sink = { write() {} };
const frame = { surface: { canvas: {} } };

test("default config remains bitrate-based with no bitrateMode", () => {
  installStubs();
  const encoder = new WebCodecsH264Encoder(sink, { width: 1920, height: 1080, fps: 30 });
  assert.equal("bitrateMode" in encoder.config, false);
  assert.equal(encoder.config.bitrate, 8_000_000);
  assert.equal(encoder.config.latencyMode, "quality");
  assert.equal(encoder.rateControl, "bitrate");
  assert.equal(encoder.rateControlFallbackReason, null);
  encoder.close();
});

test("H.264 quantizer config retains bitrate, quality latency, and Annex B format", () => {
  installStubs();
  const encoder = new WebCodecsH264Encoder(sink, {
    width: 1920, height: 1080, fps: 30, bitrate: 9_000_000, quantizer: 26,
  });
  assert.equal(encoder.config.bitrateMode, "quantizer");
  assert.equal(encoder.config.bitrate, 9_000_000);
  assert.equal(encoder.config.latencyMode, "quality");
  assert.deepEqual(encoder.config.avc, { format: "annexb" });
  assert.equal(encoder.rateControl, "quantizer");
  encoder.close();
});

test("HEVC quantizer config retains bitrate, quality latency, and HEVC format", () => {
  installStubs();
  const encoder = new WebCodecsH264Encoder(sink, {
    width: 1920, height: 1080, fps: 30, codec: "hevc", quantizer: 24,
  });
  assert.equal(encoder.config.bitrateMode, "quantizer");
  assert.equal(encoder.config.bitrate, 8_000_000);
  assert.equal(encoder.config.latencyMode, "quality");
  assert.deepEqual(encoder.config.hevc, { format: "hevc" });
  encoder.close();
});

test("encode passes codec-specific quantizer options only in quantizer mode", () => {
  installStubs();
  const h264 = new WebCodecsH264Encoder(sink, { width: 64, height: 64, fps: 30, quantizer: 26 });
  h264.encode(frame);
  assert.deepEqual(StubVideoEncoder.latest.encoded[0].options, { keyFrame: true, avc: { quantizer: 26 } });
  h264.close();

  const hevc = new WebCodecsH264Encoder(sink, { width: 64, height: 64, fps: 30, codec: "hevc", quantizer: 24 });
  hevc.encode(frame);
  assert.deepEqual(StubVideoEncoder.latest.encoded[0].options, { keyFrame: true, hevc: { quantizer: 24 } });
  hevc.close();

  const bitrate = new WebCodecsH264Encoder(sink, { width: 64, height: 64, fps: 30 });
  bitrate.encode(frame);
  assert.deepEqual(StubVideoEncoder.latest.encoded[0].options, { keyFrame: true });
  bitrate.close();
});

test("quantizer validation rejects values outside the integer 0..51 range", () => {
  installStubs();
  for (const quantizer of [-1, 52, 1.5]) {
    assert.throws(
      () => new WebCodecsH264Encoder(sink, { width: 64, height: 64, fps: 30, quantizer }),
      /quantizer must be an integer from 0 to 51/u,
    );
  }
});

test("async creation probes once and records quantizer fallback", async () => {
  installStubs();
  const supported = await WebCodecsH264Encoder.create(sink, {
    width: 64, height: 64, fps: 30, quantizer: 26,
  });
  assert.equal(StubVideoEncoder.probeCalls, 1);
  assert.equal(supported.rateControl, "quantizer");
  assert.equal(supported.rateControlFallbackReason, null);
  assert.equal(supported.config.bitrateMode, "quantizer");
  supported.close();

  installStubs();
  StubVideoEncoder.supported = false;
  const fallback = await WebCodecsH264Encoder.create(sink, {
    width: 64, height: 64, fps: 30, quantizer: 26,
  });
  assert.equal(StubVideoEncoder.probeCalls, 1);
  assert.equal(fallback.rateControl, "bitrate");
  assert.equal(fallback.rateControlFallbackReason, "quantizer-config-unsupported");
  assert.equal("bitrateMode" in fallback.config, false);
  fallback.close();
});

test("isSupported accepts quantizer-bearing options", async () => {
  installStubs();
  assert.equal(await WebCodecsH264Encoder.isSupported({
    width: 1920, height: 1080, fps: 30, quantizer: 26,
  }), true);
  assert.equal(StubVideoEncoder.probeCalls, 1);
});
