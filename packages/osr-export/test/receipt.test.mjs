import assert from "node:assert/strict";
import test from "node:test";

import { resolveMemoryBudget } from "../src/memory.mjs";
import { buildOsrReceipt } from "../src/receipt.mjs";

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
