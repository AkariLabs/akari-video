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
    run: { gpu: {
      platform: "win32",
      chromium: "140.0.0.0",
      renderer: { vendor: "NVIDIA Corporation", renderer: "ANGLE (NVIDIA GeForce RTX)" },
      encoder_support: { "prefer-hardware": true, "prefer-software": false },
      encoder: "WebCodecsH264Encoder",
      hardware: "prefer-hardware",
      uploadPath: "direct",
      quality: "high",
      bitrate: 12_000_000,
      queueDepth: 4,
      queueWaits: 7,
    }, domLayer: { runs: 1, overlays: 2, policy: "sync-layout" }, memory: { peakBytes: 42 } },
  });
  assert.equal(receipt.provenance.engine, "gpu");
  assert.equal(receipt.provenance.video_reencode, false);
  assert.equal(receipt.provenance.mux, "mp4box-direct");
  assert.deepEqual(receipt.gpu.eligibility, entries);
  assert.equal(receipt.gpu.rss_peak, 42);
  assert.equal(receipt.gpu.queueWaits, 7);
  assert.equal(receipt.gpu.quality, "high");
  assert.equal(receipt.gpu.bitrate, 12_000_000);
  assert.equal(receipt.gpu.platform, "win32");
  assert.equal(receipt.gpu.chromium, "140.0.0.0");
  assert.deepEqual(receipt.gpu.renderer, {
    vendor: "NVIDIA Corporation",
    renderer: "ANGLE (NVIDIA GeForce RTX)",
  });
  assert.deepEqual(receipt.gpu.encoder_support, {
    "prefer-hardware": true,
    "prefer-software": false,
  });
  assert.deepEqual(receipt.gpu.domLayer, { runs: 1, overlays: 2, policy: "sync-layout" });
});

test("GPU receipt keeps unavailable renderer and encoder support explicit", () => {
  const receipt = buildGpuReceipt({ run: { gpu: {} } });
  assert.equal(receipt.gpu.platform, process.platform);
  assert.equal(receipt.gpu.chromium, process.versions.chrome ?? null);
  assert.equal(receipt.gpu.renderer, null);
  assert.equal(receipt.gpu.encoder_support, null);
});

test("GPU receipt carries caption measurement and raster batch diagnostics", () => {
  const receipt = buildGpuReceipt({
    run: { gpu: {
      captionMeasureAttempts: { count: 6, p50: 2, max: 4 },
      captionMeasureDiffs: {
        totalCount: 1, shownCount: 1, truncated: false,
        entries: [{ cueId: "c-1", unitIndex: 0, variantIndex: 0, tokenIndex: 0, rectIndex: 0, role: "plain", field: "y", previous: 2, current: 2.5, delta: 0.5 }],
      },
      captionRasterTotalMs: 1234.5,
      captionRasterBatches: { batches: 2, unitsPerBatchMax: 8, bandsMax: 16 },
    } },
  });
  assert.deepEqual(receipt.gpu.captionMeasureAttempts, { count: 6, p50: 2, max: 4 });
  assert.equal(receipt.gpu.captionMeasureDiffs.entries[0].delta, 0.5);
  assert.equal(receipt.gpu.captionRasterTotalMs, 1234.5);
  assert.deepEqual(receipt.gpu.captionRasterBatches, { batches: 2, unitsPerBatchMax: 8, bandsMax: 16 });
  const empty = buildGpuReceipt({ run: { gpu: { captionMeasureAttempts: { count: 0, p50: null, max: null } } } });
  assert.deepEqual(empty.gpu.captionMeasureAttempts, { count: 0, p50: null, max: null });
});

test("GPU receipt rejects caption modes outside sprite and words-native", () => {
  assert.throws(() => buildGpuReceipt({
    run: { gpu: { captions: [{ id: "c-0001-01", mode: "karaoke", units: 1, words: 1, rasters: 2, tiles: 3 }] } },
  }), /sprite\|words-native/u);
});
