import assert from "node:assert/strict";
import test from "node:test";

import { WebCodecsH264Encoder, describeMissingFrames } from "../dist/exits/webcodecs.js";

class StubVideoEncoder extends EventTarget {
  static latest = null;

  constructor(init) {
    super();
    this.init = init;
    this.queueSize = 0;
    this.closed = false;
    StubVideoEncoder.latest = this;
  }

  get encodeQueueSize() { return this.queueSize; }
  configure() {}
  encode() { this.queueSize += 1; }
  async flush() {}
  close() { this.closed = true; }

  dequeueTo(size) {
    this.queueSize = size;
    this.dispatchEvent(new Event("dequeue"));
  }

  fail(error) {
    this.init.error(error);
  }
}

function createEncoder() {
  globalThis.VideoEncoder = StubVideoEncoder;
  return new WebCodecsH264Encoder({ write() {} }, { width: 64, height: 64, fps: 30 });
}

class StubVideoFrame {
  constructor(_source, init) { this.timestamp = init.timestamp; }
  close() {}
}

// encode() ごとに出力チャンクを返す stub。dropFrames の frame 番号だけ出力を返さない（VideoToolbox の realtime 落ちを模す）。
function createEncoderWithOutputs({ dropFrames = [] } = {}) {
  globalThis.VideoEncoder = StubVideoEncoder;
  globalThis.VideoFrame = StubVideoFrame;
  const written = [];
  const encoder = new WebCodecsH264Encoder({ write(_bytes, chunk) { written.push(chunk.timestamp); } }, { width: 64, height: 64, fps: 30 });
  StubVideoEncoder.latest.encode = function encode(frame, options) {
    this.queueSize += 1;
    if (dropFrames.includes(Math.round(frame.timestamp / 1e6 * 30))) return;
    this.init.output({ byteLength: 1, type: options?.keyFrame ? "key" : "delta", timestamp: frame.timestamp, duration: null, copyTo() {} });
  };
  return { encoder, written };
}

const frame = { surface: { canvas: null } };

test("the encoder config asks for file-export quality, not realtime (realtime may drop frames)", () => {
  const encoder = createEncoder();
  assert.equal(encoder.config.latencyMode, "quality");
  encoder.close();
});

test("finish returns the submitted and output counts when every frame produced a chunk", async () => {
  const { encoder, written } = createEncoderWithOutputs();
  for (let index = 0; index < 3; index += 1) encoder.encode(frame);
  assert.deepEqual(await encoder.finish(), { frames: 3, outputs: 3 });
  assert.deepEqual(written, [0, 33_333, 66_667]);
});

test("finish fails closed and names the frames the encoder dropped", async () => {
  const { encoder, written } = createEncoderWithOutputs({ dropFrames: [1, 3] });
  for (let index = 0; index < 4; index += 1) encoder.encode(frame);
  await assert.rejects(encoder.finish(), /dropped 2 of 4 frames \(missing frame numbers: 1, 3\)/u);
  assert.deepEqual(written, [0, 66_667]);
  encoder.close();
});

test("describeMissingFrames lists at most 20 frames and counts the rest", () => {
  assert.equal(describeMissingFrames(3, 30, new Set([0, 66_667])), "1");
  assert.equal(describeMissingFrames(30, 30, new Set()), `${[...Array(20).keys()].join(", ")}, … and 10 more`);
});

test("waitForQueueBelow resolves immediately when the queue already satisfies the limit", async () => {
  const encoder = createEncoder();
  StubVideoEncoder.latest.queueSize = 2;
  await encoder.waitForQueueBelow(2);
  encoder.close();
});

test("waitForQueueBelow waits for a dequeue event instead of polling a timer", async () => {
  const encoder = createEncoder();
  StubVideoEncoder.latest.queueSize = 4;
  let settled = false;
  const pending = encoder.waitForQueueBelow(2).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  StubVideoEncoder.latest.dequeueTo(3);
  await Promise.resolve();
  assert.equal(settled, false);
  StubVideoEncoder.latest.dequeueTo(2);
  await pending;
  assert.equal(settled, true);
  encoder.close();
});

test("waitForQueueBelow rejects encoder failure without needing another dequeue", async () => {
  const encoder = createEncoder();
  StubVideoEncoder.latest.queueSize = 4;
  const pending = encoder.waitForQueueBelow(1);
  StubVideoEncoder.latest.fail(new Error("encoder failed"));
  await assert.rejects(pending, /encoder failed/);
  encoder.close();
});

test("waitForQueueBelow rejects invalid limits and a closed encoder", async () => {
  const encoder = createEncoder();
  await assert.rejects(encoder.waitForQueueBelow(-1), /non-negative/);
  encoder.close();
  await assert.rejects(encoder.waitForQueueBelow(0), /closed/);
});
