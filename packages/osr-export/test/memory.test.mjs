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
    scale: 1,
    machineCapped: false,
  });
  assert.deepEqual(resolveMemoryBudget({ soft: true, env: {
    AKARI_OSR_MEMORY_WARN_MIB: "1200",
    AKARI_OSR_MEMORY_HARD_STOP_MIB: "1800",
  } }), {
    profile: "soft",
    warningBytes: 1200 * 1024 * 1024,
    hardStopBytes: 1800 * 1024 * 1024,
    workerBudgetBytes: 1800 * 1024 * 1024,
    scale: 1,
    machineCapped: false,
  });
  assert.throws(() => resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "0" } }), /positive integer/);
  assert.throws(() => resolveMemoryBudget({ env: {
    AKARI_OSR_MEMORY_WARN_MIB: "2048",
    AKARI_OSR_MEMORY_HARD_STOP_MIB: "1024",
  } }), /warning < hard stop/);
});

test("既定予算は 1080p を超える出力にピクセル比でスケールし、1080p 以下は変えない", () => {
  const big = 64 * 1024 * 1024 * 1024; // 64 GiB 機: 上限は効かない
  assert.deepEqual(resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes: big }), {
    profile: "gpu",
    warningBytes: 3072 * 1024 * 1024,
    hardStopBytes: 4096 * 1024 * 1024,
    workerBudgetBytes: 4096 * 1024 * 1024,
    scale: 4,
    machineCapped: false,
  });
  const qhd = resolveMemoryBudget({ env: {}, width: 2560, height: 1440, totalMemoryBytes: big });
  assert.equal(qhd.scale, 1.7778);
  assert.equal(qhd.hardStopBytes, Math.ceil(1024 * (2560 * 1440) / (1920 * 1080)) * 1024 * 1024); // 1821 MiB
  assert.equal(resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: big }).hardStopBytes, 1024 * 1024 * 1024);
  assert.equal(resolveMemoryBudget({ env: {}, width: 1080, height: 1920, totalMemoryBytes: big }).scale, 1);
  assert.equal(resolveMemoryBudget({ env: {}, width: 1280, height: 720, totalMemoryBytes: big }).hardStopBytes, 1024 * 1024 * 1024);
  assert.equal(resolveMemoryBudget({ env: {}, soft: true, width: 3840, height: 2160, totalMemoryBytes: big }).hardStopBytes, 8192 * 1024 * 1024);
});

test("スケール後の hard stop は物理メモリの 50% で切り詰め、warning はその 75% に置く（1080p 既定は切り詰めない）", () => {
  const eightGiB = 8 * 1024 * 1024 * 1024;
  const gpu4k = resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(gpu4k.hardStopBytes, 4096 * 1024 * 1024); // ちょうど 50% なので切り詰め無し
  assert.equal(gpu4k.machineCapped, false);
  const soft4k = resolveMemoryBudget({ env: {}, soft: true, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(soft4k.hardStopBytes, 4096 * 1024 * 1024);
  assert.equal(soft4k.warningBytes, 3072 * 1024 * 1024);
  assert.equal(soft4k.machineCapped, true);
  // 小さい機種でも 1080p 以下の既定値は従来どおり（上限はスケール分にだけ効く）
  const tiny = resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: 1024 * 1024 * 1024 });
  assert.equal(tiny.hardStopBytes, 1024 * 1024 * 1024);
  assert.equal(tiny.machineCapped, false);
});

test("env 上書きは絶対値でスケールも上限も受けず、hard stop だけの上書きには warning が追従する", () => {
  const eightGiB = 8 * 1024 * 1024 * 1024;
  const explicit = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "5000", AKARI_OSR_MEMORY_HARD_STOP_MIB: "6000" }, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(explicit.hardStopBytes, 6000 * 1024 * 1024);
  assert.equal(explicit.warningBytes, 5000 * 1024 * 1024);
  assert.equal(explicit.machineCapped, false);
  // 4K で hard stop=1600 MiB だけ指定（今回の実機報告の形）: 既定 warning 3072 MiB ≥ 1600 なので 1200 MiB へ追従
  const hardOnly = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_HARD_STOP_MIB: "1600" }, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(hardOnly.hardStopBytes, 1600 * 1024 * 1024);
  assert.equal(hardOnly.warningBytes, 1200 * 1024 * 1024);
  // warning だけを既定 hard stop 以上にするのは従来どおり拒否
  assert.throws(() => resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "4096" }, width: 3840, height: 2160, totalMemoryBytes: eightGiB }), /warning < hard stop/);
});

test("サンプラーの snapshot と receipt は予算のスケールと上限適用を運ぶ", async () => {
  const { buildOsrReceipt } = await import("../src/receipt.mjs");
  const budget = resolveMemoryBudget({ env: {}, soft: true, width: 3840, height: 2160, totalMemoryBytes: 8 * 1024 * 1024 * 1024 });
  const snapshot = createMemorySampler({ intervalMs: 60_000, sample: () => 1, budget }).stop();
  assert.equal(snapshot.budgetScale, 4);
  assert.equal(snapshot.machineCapped, true);
  const receipt = buildOsrReceipt({ tier: 2, profile: "soft", memory: snapshot });
  assert.equal(receipt.memory.budget_scale, 4);
  assert.equal(receipt.memory.machine_capped, true);
  assert.equal(receipt.memory.hard_stop_bytes, 4096 * 1024 * 1024);
  const fallback = buildOsrReceipt({ tier: 2 });
  assert.equal(fallback.memory.budget_scale, 1);
  assert.equal(fallback.memory.machine_capped, false);
});
