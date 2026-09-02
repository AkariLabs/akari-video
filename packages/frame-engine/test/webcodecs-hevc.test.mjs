import assert from "node:assert/strict";
import test from "node:test";

import { RefusalError, WebCodecsH264Encoder, hevcEncoderCodecString } from "../dist/exits/webcodecs.js";

class StubVideoEncoder extends EventTarget {
  static latest = null;
  static probed = null;

  constructor(init) {
    super();
    this.init = init;
    StubVideoEncoder.latest = this;
  }

  static async isConfigSupported(config) {
    StubVideoEncoder.probed = config;
    return { supported: true, config };
  }

  get encodeQueueSize() { return 0; }
  configure(config) { this.config = config; }
  encode() {}
  async flush() {}
  close() {}
}

test("hevcEncoderCodecString selects Level 4 for 1080p30", () => {
  assert.equal(hevcEncoderCodecString({ width: 1920, height: 1080, fps: 30 }), "hvc1.1.6.L120.B0");
});

test("hevcEncoderCodecString selects Level 4.1 for 1080p60 and 1440p30", () => {
  assert.equal(hevcEncoderCodecString({ width: 1920, height: 1080, fps: 60 }), "hvc1.1.6.L123.B0");
  assert.equal(hevcEncoderCodecString({ width: 2560, height: 1440, fps: 30 }), "hvc1.1.6.L123.B0");
});

test("hevcEncoderCodecString selects Level 5 for 4K30", () => {
  assert.equal(hevcEncoderCodecString({ width: 3840, height: 2160, fps: 30 }), "hvc1.1.6.L150.B0");
});

test("hevcEncoderCodecString selects Level 5.1 for 4K60", () => {
  assert.equal(hevcEncoderCodecString({ width: 3840, height: 2160, fps: 60 }), "hvc1.1.6.L153.B0");
});

test("hevcEncoderCodecString selects Level 5.2 above 4K60 and refuses beyond its limit", () => {
  assert.equal(hevcEncoderCodecString({ width: 4096, height: 2160, fps: 120 }), "hvc1.1.6.L156.B0");
  assert.throws(() => hevcEncoderCodecString({ width: 7680, height: 4320, fps: 30 }), RefusalError);
});

test("HEVC config uses length-prefixed chunks and forwards decoderConfig description once", async () => {
  globalThis.VideoEncoder = StubVideoEncoder;
  const writes = [];
  const encoder = new WebCodecsH264Encoder({ write(bytes, chunk) { writes.push({ bytes, chunk }); } }, {
    width: 1920, height: 1080, fps: 30, codec: "hevc",
  });
  assert.equal(encoder.config.codec, "hvc1.1.6.L120.B0");
  assert.deepEqual(encoder.config.hevc, { format: "hevc" });
  assert.equal("avc" in encoder.config, false);

  const description = new Uint8Array([1, 2, 3, 4]);
  const emit = StubVideoEncoder.latest.init.output;
  emit({ byteLength: 2, type: "key", timestamp: 0, duration: 33_333, copyTo(target) { target.set([9, 8]); } }, {
    decoderConfig: { description },
  });
  emit({ byteLength: 1, type: "delta", timestamp: 33_333, duration: 33_333, copyTo(target) { target.set([7]); } }, {
    decoderConfig: { description: new Uint8Array([5, 6]) },
  });
  await encoder.finish();
  assert.deepEqual(writes[0].chunk.description, description);
  assert.equal(writes[1].chunk.description, undefined);
  assert.equal(await WebCodecsH264Encoder.isSupported({ width: 1920, height: 1080, fps: 30, codec: "hevc" }), true);
  assert.deepEqual(StubVideoEncoder.probed.hevc, { format: "hevc" });
});

test("the default H.264 path keeps Annex B config and does not forward metadata", async () => {
  globalThis.VideoEncoder = StubVideoEncoder;
  const writes = [];
  const encoder = new WebCodecsH264Encoder({ write(_bytes, chunk) { writes.push(chunk); } }, {
    width: 1920, height: 1080, fps: 30,
  });
  assert.deepEqual(encoder.config.avc, { format: "annexb" });
  assert.equal("hevc" in encoder.config, false);
  StubVideoEncoder.latest.init.output({
    byteLength: 1, type: "key", timestamp: 0, duration: 33_333, copyTo(target) { target[0] = 1; },
  }, { decoderConfig: { description: new Uint8Array([1, 2, 3]) } });
  await encoder.finish();
  assert.equal(writes[0].description, undefined);
});
