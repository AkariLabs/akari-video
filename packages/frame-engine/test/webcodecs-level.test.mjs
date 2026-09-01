import assert from "node:assert/strict";
import test from "node:test";

import { WebCodecsH264Encoder, h264CodecString, selectH264Level } from "../dist/exits/webcodecs.js";

class StubVideoEncoder extends EventTarget {
  static latest = null;
  static probed = null;

  constructor(init) {
    super();
    this.init = init;
    this.configured = null;
    StubVideoEncoder.latest = this;
  }

  static async isConfigSupported(config) {
    StubVideoEncoder.probed = config;
    return { supported: true, config };
  }

  get encodeQueueSize() { return 0; }
  configure(config) { this.configured = config; }
  encode() {}
  async flush() {}
  close() {}
}

test("level follows resolution and frame rate; 1080p30 and below stay byte-identical at Level 4.0", () => {
  assert.equal(h264CodecString({ width: 1920, height: 1080, fps: 30 }), "avc1.640028");
  assert.equal(h264CodecString({ width: 1080, height: 1920, fps: 30 }), "avc1.640028"); // 縦型 1080p
  assert.equal(h264CodecString({ width: 1280, height: 720, fps: 60 }), "avc1.640028"); // 3600 MB × 60 = 216000 ≤ 245760
  assert.equal(h264CodecString({ width: 640, height: 360, fps: 24 }), "avc1.640028"); // 下限 4.0
  assert.equal(h264CodecString({ width: 1920, height: 1080, fps: 60 }), "avc1.64002a"); // 4.2
  assert.equal(h264CodecString({ width: 2560, height: 1440, fps: 30 }), "avc1.640032"); // 5.0
  assert.equal(h264CodecString({ width: 2560, height: 1440, fps: 60 }), "avc1.640033"); // 5.1
  assert.equal(h264CodecString({ width: 3840, height: 2160, fps: 30 }), "avc1.640033"); // 5.1（4K30）
  assert.equal(h264CodecString({ width: 3840, height: 2160, fps: 60 }), "avc1.640034"); // 5.2（4K60）
  assert.equal(h264CodecString({ width: 7680, height: 4320, fps: 30 }), "avc1.64003c"); // 6.0（8K30）
});

test("a bitrate above the level's MaxBR (High profile = 1.25 × Table A-1) bumps the level", () => {
  assert.equal(h264CodecString({ width: 1920, height: 1080, fps: 30, bitrate: 12_000_000 }), "avc1.640028");
  assert.equal(h264CodecString({ width: 1920, height: 1080, fps: 30, bitrate: 25_000_000 }), "avc1.640028");
  assert.equal(h264CodecString({ width: 1920, height: 1080, fps: 30, bitrate: 25_000_001 }), "avc1.640029");
  assert.equal(h264CodecString({ width: 3840, height: 2160, fps: 30, bitrate: 48_000_000 }), "avc1.640033");
});

test("selectH264Level reports macroblock counts and refuses frames beyond Level 6.2 or invalid sizes", () => {
  const selection = selectH264Level({ width: 3840, height: 2160, fps: 30 });
  assert.deepEqual(selection, { level: "5.1", idc: 0x33, codec: "avc1.640033", macroblocks: 32_400, macroblocksPerSecond: 972_000 });
  assert.equal(selectH264Level({ width: 1920, height: 1080, fps: 30 }).macroblocks, 8160);
  assert.throws(() => selectH264Level({ width: 16_000, height: 16_000, fps: 30 }), /no H\.264 High profile level fits 16000x16000@30fps/u);
  assert.throws(() => selectH264Level({ width: 0, height: 1080, fps: 30 }), /positive frame size/u);
  assert.throws(() => selectH264Level({ width: 1920, height: 1080, fps: 0 }), /positive frame rate/u);
});

test("an explicit codec string overrides the derivation and is validated", () => {
  assert.equal(h264CodecString({ width: 1920, height: 1080, fps: 30, codec: "avc1.640033" }), "avc1.640033");
  assert.equal(h264CodecString({ width: 3840, height: 2160, fps: 30, codec: "avc1.64002A" }), "avc1.64002A");
  assert.throws(() => h264CodecString({ width: 1920, height: 1080, fps: 30, codec: "hvc1.1.6.L93.B0" }), /invalid H\.264 codec string/u);
  assert.throws(() => h264CodecString({ width: 1920, height: 1080, fps: 30, codec: "avc1.6400" }), /invalid H\.264 codec string/u);
});

test("the encoder configures and probes with the derived codec (4K no longer probes Level 4.0)", async () => {
  globalThis.VideoEncoder = StubVideoEncoder;
  const encoder = new WebCodecsH264Encoder({ write() {} }, { width: 3840, height: 2160, fps: 30, bitrate: 48_000_000 });
  assert.equal(StubVideoEncoder.latest.configured.codec, "avc1.640033");
  assert.equal(encoder.config.codec, "avc1.640033");
  assert.equal(encoder.config.bitrate, 48_000_000);
  encoder.close();

  assert.equal(await WebCodecsH264Encoder.isSupported({ width: 3840, height: 2160, fps: 30 }), true);
  assert.equal(StubVideoEncoder.probed.codec, "avc1.640033");
  assert.equal(StubVideoEncoder.probed.bitrate, 8_000_000);
  assert.equal(await WebCodecsH264Encoder.isSupported({ width: 1920, height: 1080, fps: 30 }), true);
  assert.equal(StubVideoEncoder.probed.codec, "avc1.640028");
  assert.equal(await WebCodecsH264Encoder.isSupported({ width: 1920, height: 1080, fps: 30, codec: "avc1.640033" }), true);
  assert.equal(StubVideoEncoder.probed.codec, "avc1.640033");
});
