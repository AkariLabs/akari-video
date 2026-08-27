import assert from "node:assert/strict";
import test from "node:test";

import { createMemorySampler, resolveMemoryBudget } from "../src/memory.mjs";

test("afterDestroy のメモリサンプルは stop で1回だけ追加する", () => {
  const sampler = createMemorySampler({ intervalMs: 60_000, sample: () => 123 });
  const result = sampler.stop("afterDestroy");
  assert.deepEqual(result.samples.map((sample) => sample.phase), ["start", "afterDestroy"]);
  assert.equal(result.samples.filter((sample) => sample.phase === "afterDestroy").length, 1);
});

test("soft は専用予算を選び env 上書きと大小関係を検証する", () => {
  assert.deepEqual(resolveMemoryBudget({ soft: true, env: {} }), {
    profile: "soft",
    warningBytes: 1536 * 1024 * 1024,
    hardStopBytes: 2048 * 1024 * 1024,
    workerBudgetBytes: 2048 * 1024 * 1024,
  });
  assert.deepEqual(resolveMemoryBudget({ soft: true, env: {
    AKARI_OSR_MEMORY_WARN_MIB: "1200",
    AKARI_OSR_MEMORY_HARD_STOP_MIB: "1800",
  } }), {
    profile: "soft",
    warningBytes: 1200 * 1024 * 1024,
    hardStopBytes: 1800 * 1024 * 1024,
    workerBudgetBytes: 1800 * 1024 * 1024,
  });
  assert.throws(() => resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "0" } }), /positive integer/);
  assert.throws(() => resolveMemoryBudget({ env: {
    AKARI_OSR_MEMORY_WARN_MIB: "2048",
    AKARI_OSR_MEMORY_HARD_STOP_MIB: "1024",
  } }), /warning < hard stop/);
});
