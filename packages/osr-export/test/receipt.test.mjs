import assert from "node:assert/strict";
import test from "node:test";

import { resolveMemoryBudget } from "../src/memory.mjs";
import { buildOsrReceipt, normalizeOsrWarmUp } from "../src/receipt.mjs";

test("OSR receipt は engine、器、verify、メモリ予算を記録する（2026-09-01 裁定: 既定 hard stop は物理メモリ 25% の下限込みなので固定 768 / 1,024 MiB ではなく本機の resolveMemoryBudget と比較）", () => {
  const receipt = buildOsrReceipt({ tier: 2, verify: "stamp", memory: { peakBytes: 123 } });
  const machine = resolveMemoryBudget({ env: {} });
  assert.equal(receipt.provenance.engine, "osr");
  assert.equal(receipt.provenance.launcher_tier, 2);
  assert.equal(receipt.provenance.verify, "stamp");
  assert.equal(receipt.memory.profile, "gpu");
  assert.equal(receipt.memory.warning_bytes, machine.warningBytes);
  assert.equal(receipt.memory.hard_stop_bytes, machine.hardStopBytes);
  assert.ok(receipt.memory.hard_stop_bytes >= 1024 * 1024 * 1024);
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

test("OSR receipt は machine_floor と total_memory_bytes を snapshot から snake_case で運び、無ければ本機の既定で埋める", () => {
  const sixteenGiB = 16 * 1024 * 1024 * 1024;
  const receipt = buildOsrReceipt({ tier: 2, memory: {
    profile: "gpu",
    warningBytes: 3072 * 1024 * 1024,
    hardStopBytes: 4096 * 1024 * 1024,
    workerBudgetBytes: 4096 * 1024 * 1024,
    budgetScale: 1,
    machineFloor: true,
    machineCapped: false,
    totalMemoryBytes: sixteenGiB,
    peakBytes: 7,
  } });
  assert.equal(receipt.memory.machine_floor, true);
  assert.equal(receipt.memory.machine_capped, false);
  assert.equal(receipt.memory.total_memory_bytes, sixteenGiB);
  assert.equal(receipt.memory.budget_scale, 1);
  const machine = resolveMemoryBudget({ env: {} });
  const fallback = buildOsrReceipt({ tier: 2 });
  assert.equal(fallback.memory.machine_floor, machine.machineFloor);
  assert.equal(fallback.memory.total_memory_bytes, machine.totalMemoryBytes);
  assert.equal(typeof fallback.memory.total_memory_bytes, "number");
});

test("OSR receipt は provenance.gpu_preference に Windows の GPU 設定一時上書きの記録（exit 込み・q）を snake_case で載せる", () => {
  const applied = buildOsrReceipt({ tier: 2, gpuPreference: {
    platform: "win32", policy: "auto", exit: "osr", executable: "C:\\x\\electron.exe", applied: true, previous: null, restored: true, reason: "unset", recovered_stale: true,
  } });
  assert.deepEqual(applied.provenance.gpu_preference, {
    policy: "auto", exit: "osr", applied: true, previous: null, restored: true, reason: "unset", recovered_stale: true,
  });
  const skipped = buildOsrReceipt({ tier: 1, gpuPreference: { platform: "darwin", policy: "auto", reason: "platform", applied: false, restored: null } });
  assert.deepEqual(skipped.provenance.gpu_preference, {
    policy: "auto", exit: null, applied: false, previous: null, restored: null, reason: "platform", recovered_stale: false,
  });
  const osrAuto = buildOsrReceipt({ tier: 2, gpuPreference: { platform: "win32", policy: "auto", exit: "osr", applied: false, reason: "not-gpu-exit" } });
  assert.deepEqual(osrAuto.provenance.gpu_preference, {
    policy: "auto", exit: "osr", applied: false, previous: null, restored: null, reason: "not-gpu-exit", recovered_stale: false,
  });
  assert.equal(buildOsrReceipt({ tier: 2 }).provenance.gpu_preference, null);
});

test("(e) OSR receipt は warm_up（起動直後の空 paint の warm-up 記録・契約 §11.8）を snake_case で載せ、無ければ null", () => {
  const record = { attempts: 9, empty_attempts: 8, elapsed_ms: 1234, satisfied: true };
  assert.deepEqual(buildOsrReceipt({ tier: 2, warmUp: record }).warm_up, record);
  assert.deepEqual(normalizeOsrWarmUp({ attempts: 1, emptyAttempts: 0, elapsedMs: 17.5, satisfied: true }), {
    attempts: 1, empty_attempts: 0, elapsed_ms: 17.5, satisfied: true,
  });
  assert.deepEqual(normalizeOsrWarmUp({ attempts: 20, empty_attempts: 20, elapsed_ms: 5000, satisfied: false }), {
    attempts: 20, empty_attempts: 20, elapsed_ms: 5000, satisfied: false,
  });
  assert.equal(buildOsrReceipt({ tier: 2 }).warm_up, null);
  assert.equal(buildOsrReceipt({ tier: 2, warmUp: undefined }).warm_up, null);
  assert.equal(normalizeOsrWarmUp(null), null);
  assert.equal(normalizeOsrWarmUp("1"), null);
  assert.equal(normalizeOsrWarmUp({ attempts: -1, empty_attempts: 0, elapsed_ms: 1, satisfied: true }), null);
  assert.equal(normalizeOsrWarmUp({ attempts: 1, empty_attempts: 0.5, elapsed_ms: 1, satisfied: true }), null);
  assert.equal(normalizeOsrWarmUp({ attempts: 1, empty_attempts: 0, elapsed_ms: Number.NaN, satisfied: true }), null);
  assert.equal(normalizeOsrWarmUp({ attempts: 1, empty_attempts: 0, elapsed_ms: -1, satisfied: true }), null);
  assert.equal(normalizeOsrWarmUp({ attempts: 1, empty_attempts: 0, elapsed_ms: 1, satisfied: "yes" }), null);
  assert.equal(normalizeOsrWarmUp({ attempts: 1, empty_attempts: 0, elapsed_ms: 1 }), null);
});
