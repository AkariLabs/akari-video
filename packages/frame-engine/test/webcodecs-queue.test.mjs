import assert from "node:assert/strict";
import test from "node:test";

import { WebCodecsH264Encoder } from "../dist/exits/webcodecs.js";

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
