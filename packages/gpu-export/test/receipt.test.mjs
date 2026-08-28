import assert from "node:assert/strict";
import test from "node:test";

import { buildGpuReceipt } from "../src/receipt.mjs";

test("GPU receipt records direct mux, no re-encode, and every eligibility row", () => {
  const entries = [
    { kind: "overlay", id: "a", classification: "same", reason: "static", conditions: [] },
    { kind: "caption", id: "b", classification: "same", reason: "caption", conditions: [] },
  ];
  const receipt = buildGpuReceipt({
    tier: 2,
    eligibility: { entries },
    run: { gpu: { encoder: "WebCodecsH264Encoder", hardware: "prefer-hardware", uploadPath: "direct", quality: "high", bitrate: 12_000_000, queueDepth: 4, queueWaits: 7 }, memory: { peakBytes: 42 } },
  });
  assert.equal(receipt.provenance.engine, "gpu");
  assert.equal(receipt.provenance.video_reencode, false);
  assert.equal(receipt.provenance.mux, "mp4box-direct");
  assert.deepEqual(receipt.gpu.eligibility, entries);
  assert.equal(receipt.gpu.rss_peak, 42);
  assert.equal(receipt.gpu.queueWaits, 7);
  assert.equal(receipt.gpu.quality, "high");
  assert.equal(receipt.gpu.bitrate, 12_000_000);
});
