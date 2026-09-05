import assert from "node:assert/strict";
import test from "node:test";

import { buildGpuReceipt } from "../src/receipt.mjs";

test("GPU receipt reports the mux method the run actually used", () => {
  const incremental = buildGpuReceipt({ tier: 2, run: { mux: { method: "incremental-mp4", samples: 3 } } });
  assert.equal(incremental.provenance.mux, "incremental-mp4");
});

test("a run recorded before the ffmpeg remux keeps reading as mp4box-direct", () => {
  assert.equal(buildGpuReceipt({ tier: 2, run: { status: "completed" } }).provenance.mux, "mp4box-direct");
  assert.equal(buildGpuReceipt({ tier: 2 }).provenance.mux, "mp4box-direct");
});

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

test("GPU receipt records normalized forced overlay reasons", () => {
  const forced = {
    entries: [
      { kind: "overlay", id: "a", classification: "dom", reason: "forced-dom:first", forced: true },
      { kind: "caption", id: "b", classification: "same", reason: "caption-sprite" },
      { kind: "overlay", id: "c", classification: "dom", reason: "forced-dom:second", forced: true },
    ],
  };
  assert.deepEqual(buildGpuReceipt({ forced }).gpu.forced, {
    reasons: [
      { id: "a", reason: "forced-dom:first" },
      { id: "c", reason: "forced-dom:second" },
    ],
  });
});

test("GPU receipt keeps an absent or malformed forced record null", () => {
  assert.equal(buildGpuReceipt().gpu.forced, null);
  assert.equal(buildGpuReceipt({ forced: { entries: "invalid" } }).gpu.forced, null);
  assert.equal(buildGpuReceipt({ forced: { entries: [{ id: 42, reason: null, forced: true }] } }).gpu.forced, null);
});

test("GPU receipt normalizes sampled 3D entrance mode and sampling costs", () => {
  const three = {
    overlays: [{ id: "three-title", entrance: { mode: "sampled" } }],
    sampling: { count: 450, p50: 0.21, p95: 0.68 },
  };
  assert.deepEqual(buildGpuReceipt({ run: { three } }).gpu.three, three);
  assert.equal(buildGpuReceipt({ run: { three: { overlays: [], sampling: { count: 1, p50: -1, p95: 2 } } } }).gpu.three, null);
  assert.equal(buildGpuReceipt({ run: { three: { overlays: [{ id: "x", entrance: { mode: "none" } }], sampling: { count: 0, p50: null, p95: null } } } }).gpu.three, null);
});

test("GPU receipt normalizes composite 3D diagnostics without changing legacy summaries", () => {
  const legacy = {
    overlays: [{ id: "curve", entrance: { mode: "curve" } }],
    sampling: { count: 0, p50: null, p95: null },
  };
  assert.deepEqual(buildGpuReceipt({ run: { three: legacy } }).gpu.three, legacy);
  const three = {
    overlays: [{ id: "scene", entrance: { mode: "composite" } }],
    sampling: { count: 0, p50: null, p95: null },
    composite: {
      overlays: 1,
      domElements: 14,
      copy: { count: 180, p50: 0.08, p95: 0.15 },
      domLayerCostMs: { p50: 0.7, p95: 1.4 },
    },
  };
  assert.deepEqual(buildGpuReceipt({ run: { three } }).gpu.three, three);
  assert.equal(buildGpuReceipt({ run: { three: { ...three, composite: { ...three.composite, domElements: -1 } } } }).gpu.three, null);
});

test("GPU receipt records each normalized audio mode", () => {
  for (const audio of [
    { mode: "copy", source: "cut-audio.mp4", source_has_audio: true },
    { mode: "silent-carrier", source: "mute.mp4", source_has_audio: false },
    { mode: "none", source: null, source_has_audio: null },
  ]) {
    assert.deepEqual(buildGpuReceipt({ audio }).audio, audio);
  }
});

test("GPU receipt normalizes missing or malformed audio records to null", () => {
  assert.equal(buildGpuReceipt().audio, null);
  assert.equal(buildGpuReceipt({ audio: { mode: "other", source: null, source_has_audio: null } }).audio, null);
  assert.equal(buildGpuReceipt({ audio: { mode: "copy", source: 42, source_has_audio: true } }).audio, null);
  assert.equal(buildGpuReceipt({ audio: { mode: "copy", source: "cut.mp4", source_has_audio: "yes" } }).audio, null);
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

test("GPU receipt normalizes caption startup diagnostics", () => {
  const captionStartup = {
    totalMs: 345.5,
    fontEncodeMs: 12.25,
    fontBase64Bytes: 12_800_000,
    measure: {
      stableCalls: 44,
      reusedStableCalls: 6,
      passes: 88,
      variantMeasurements: 132,
      totalMs: 300.5,
      p50: 3.5,
      p95: 7.25,
      max: 9.5,
      fontWaitMs: 40.5,
      layoutMs: 240.25,
      rootMs: 10.75,
      distinctKeys: 42,
      duplicatePasses: 46,
      degradedUnits: 2,
      faultInjected: true,
    },
    raster: {
      batches: 6,
      bands: 52,
      units: 44,
      svgBuildMs: 15.5,
      svgChars: 456_789,
      assertMs: 4.25,
      srcAssignMs: 120.5,
      decodeMs: 20_500.75,
      sheetDrawMs: 1_250.5,
      drawImageMs: 80.25,
      registerMs: 35.75,
      totalMs: 20_800.5,
      prefetchedBatches: 5,
      prefetchMs: 18_000.25,
    },
  };
  const receipt = buildGpuReceipt({ run: { gpu: { captionStartup } } });
  assert.deepEqual(receipt.gpu.captionStartup, captionStartup);
  const emptyMeasure = { ...captionStartup, measure: {
    stableCalls: 0,
    reusedStableCalls: 0,
    passes: 0,
    variantMeasurements: 0,
    totalMs: 0,
    p50: null,
    p95: null,
    max: null,
    fontWaitMs: 0,
    layoutMs: 0,
    rootMs: 0,
    distinctKeys: 0,
    duplicatePasses: 0,
    degradedUnits: 0,
    faultInjected: false,
  } };
  assert.deepEqual(buildGpuReceipt({ run: { gpu: { captionStartup: emptyMeasure } } }).gpu.captionStartup, emptyMeasure);
});

test("GPU receipt rejects malformed caption startup diagnostics", () => {
  assert.equal(buildGpuReceipt({ run: { gpu: { captionStartup: "invalid" } } }).gpu.captionStartup, null);
  assert.equal(buildGpuReceipt({
    run: { gpu: { captionStartup: {
      totalMs: -1,
      fontEncodeMs: 0,
      fontBase64Bytes: 0,
      measure: {},
      raster: {},
    } } },
  }).gpu.captionStartup, null);
});

test("GPU receipt rejects caption modes outside sprite and words-native", () => {
  assert.throws(() => buildGpuReceipt({
    run: { gpu: { captions: [{ id: "c-0001-01", mode: "karaoke", units: 1, words: 1, rasters: 2, tiles: 3 }] } },
  }), /sprite\|words-native/u);
});

test("GPU receipt carries machine_floor and total_memory_bytes from the run memory snapshot and falls back to this machine's default budget", async () => {
  const { resolveMemoryBudget } = await import("../../osr-export/src/memory.mjs");
  const sixteenGiB = 16 * 1024 * 1024 * 1024;
  const receipt = buildGpuReceipt({ tier: 2, run: { memory: {
    profile: "gpu",
    warningBytes: 3072 * 1024 * 1024,
    hardStopBytes: 4096 * 1024 * 1024,
    workerBudgetBytes: 4096 * 1024 * 1024,
    budgetScale: 1,
    machineFloor: true,
    machineCapped: false,
    totalMemoryBytes: sixteenGiB,
    peakBytes: 99,
  } } });
  assert.equal(receipt.memory.machine_floor, true);
  assert.equal(receipt.memory.machine_capped, false);
  assert.equal(receipt.memory.total_memory_bytes, sixteenGiB);
  assert.equal(receipt.memory.hard_stop_bytes, 4096 * 1024 * 1024);
  assert.equal(receipt.gpu.rss_peak, 99);
  const machine = resolveMemoryBudget({ env: {} });
  const fallback = buildGpuReceipt({ tier: 2 });
  assert.equal(fallback.memory.machine_floor, machine.machineFloor);
  assert.equal(fallback.memory.machine_capped, machine.machineCapped);
  assert.equal(fallback.memory.total_memory_bytes, machine.totalMemoryBytes);
  assert.equal(fallback.memory.hard_stop_bytes, machine.hardStopBytes);
});

test("GPU receipt carries provenance.gpu_preference (Windows per-app GPU override record, exit included: q) in snake_case", () => {
  const forced = buildGpuReceipt({ tier: 2, gpuPreference: {
    platform: "win32", policy: "force", exit: "gpu", executable: "C:\\x\\electron.exe", applied: true, previous: "GpuPreference=1;", restored: true, reason: "forced", recovered_stale: false,
  } });
  assert.deepEqual(forced.provenance.gpu_preference, {
    policy: "force", exit: "gpu", applied: true, previous: "GpuPreference=1;", restored: true, reason: "forced", recovered_stale: false,
  });
  const respected = buildGpuReceipt({ tier: 2, gpuPreference: { platform: "win32", policy: "auto", applied: false, previous: "GpuPreference=1;", restored: null, reason: "user-preference-respected" } });
  assert.equal(respected.provenance.gpu_preference.applied, false);
  assert.equal(respected.provenance.gpu_preference.reason, "user-preference-respected");
  assert.equal(buildGpuReceipt({ tier: 2 }).provenance.gpu_preference, null);
  assert.equal(buildGpuReceipt({ tier: 2, run: { status: "completed" } }).provenance.mux, "mp4box-direct");
});
