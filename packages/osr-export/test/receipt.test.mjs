import assert from "node:assert/strict";
import test from "node:test";

import { buildOsrReceipt } from "../src/receipt.mjs";

test("OSR receipt は engine、器、verify、メモリ予算を記録する", () => {
  const receipt = buildOsrReceipt({ tier: 2, verify: "stamp", memory: { peakBytes: 123 } });
  assert.equal(receipt.provenance.engine, "osr");
  assert.equal(receipt.provenance.launcher_tier, 2);
  assert.equal(receipt.provenance.verify, "stamp");
  assert.equal(receipt.memory.profile, "gpu");
  assert.equal(receipt.memory.warning_bytes, 768 * 1024 * 1024);
  assert.equal(receipt.memory.hard_stop_bytes, 1024 * 1024 * 1024);
  assert.equal(receipt.memory.peak_bytes, 123);
});

test("OSR receipt は実走で適用した soft 予算を保存する", () => {
  const receipt = buildOsrReceipt({ tier: 2, profile: "soft", memory: {
    profile: "soft",
    warningBytes: 1200 * 1024 * 1024,
    hardStopBytes: 1800 * 1024 * 1024,
    workerBudgetBytes: 1800 * 1024 * 1024,
  } });
  assert.equal(receipt.memory.profile, "soft");
  assert.equal(receipt.memory.warning_bytes, 1200 * 1024 * 1024);
  assert.equal(receipt.memory.hard_stop_bytes, 1800 * 1024 * 1024);
});

test("OSR receipt は provenance.gpu_preference に Windows の GPU 設定一時上書きの記録を snake_case で載せる", () => {
  const applied = buildOsrReceipt({ tier: 2, gpuPreference: {
    platform: "win32", policy: "auto", executable: "C:\\x\\electron.exe", applied: true, previous: null, restored: true, reason: "unset", recovered_stale: true,
  } });
  assert.deepEqual(applied.provenance.gpu_preference, {
    policy: "auto", applied: true, previous: null, restored: true, reason: "unset", recovered_stale: true,
  });
  const skipped = buildOsrReceipt({ tier: 1, gpuPreference: { platform: "darwin", policy: "auto", reason: "platform", applied: false, restored: null } });
  assert.deepEqual(skipped.provenance.gpu_preference, {
    policy: "auto", applied: false, previous: null, restored: null, reason: "platform", recovered_stale: false,
  });
  assert.equal(buildOsrReceipt({ tier: 2 }).provenance.gpu_preference, null);
});
