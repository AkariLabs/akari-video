import assert from "node:assert/strict";
import test from "node:test";

import { createMemorySampler, resolveMemoryBudget } from "../src/memory.mjs";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

test("afterDestroy のメモリサンプルは stop で1回だけ追加する", () => {
  const sampler = createMemorySampler({ intervalMs: 60_000, sample: () => 123 });
  const result = sampler.stop("afterDestroy");
  assert.deepEqual(result.samples.map((sample) => sample.phase), ["start", "afterDestroy"]);
  assert.equal(result.samples.filter((sample) => sample.phase === "afterDestroy").length, 1);
});

test("soft は専用予算を選び env 上書きと大小関係を検証する（2026-09-01 裁定: 物理メモリ 25% の下限は常に効くので、下限 1,024 MiB が SOFT 基準以下になる totalmem 4 GiB を固定して基準値 1,536 / 2,048 MiB を検証）", () => {
  const fourGiB = 4 * GIB;
  assert.deepEqual(resolveMemoryBudget({ soft: true, env: {}, totalMemoryBytes: fourGiB }), {
    profile: "soft",
    warningBytes: 1536 * MIB,
    hardStopBytes: 2048 * MIB,
    workerBudgetBytes: 2048 * MIB,
    scale: 1,
    machineFloor: false,
    machineCapped: false,
    totalMemoryBytes: fourGiB,
  });
  assert.deepEqual(resolveMemoryBudget({ soft: true, env: {
    AKARI_OSR_MEMORY_WARN_MIB: "1200",
    AKARI_OSR_MEMORY_HARD_STOP_MIB: "1800",
  }, totalMemoryBytes: fourGiB }), {
    profile: "soft",
    warningBytes: 1200 * MIB,
    hardStopBytes: 1800 * MIB,
    workerBudgetBytes: 1800 * MIB,
    scale: 1,
    machineFloor: false,
    machineCapped: false,
    totalMemoryBytes: fourGiB,
  });
  assert.throws(() => resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "0" } }), /positive integer/);
  assert.throws(() => resolveMemoryBudget({ env: {
    AKARI_OSR_MEMORY_WARN_MIB: "2048",
    AKARI_OSR_MEMORY_HARD_STOP_MIB: "1024",
  } }), /warning < hard stop/);
});

test("既定予算は 1080p を超える出力にピクセル比でスケールする（2026-09-01 裁定: 下限が基準値以下・上限がスケール値以上になる totalmem で検証。64 GiB 機の従来期待値は下限 16 GiB が効くため撤回）", () => {
  const fourGiB = 4 * GIB; // 下限 1,024 MiB = GPU 基準・上限 2,048 MiB
  const sixteenGiB = 16 * GIB; // 下限 4,096 MiB・上限 8,192 MiB
  assert.deepEqual(resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes: sixteenGiB }), {
    profile: "gpu",
    warningBytes: 3072 * MIB,
    hardStopBytes: 4096 * MIB,
    workerBudgetBytes: 4096 * MIB,
    scale: 4,
    machineFloor: false,
    machineCapped: false,
    totalMemoryBytes: sixteenGiB,
  });
  const qhd = resolveMemoryBudget({ env: {}, width: 2560, height: 1440, totalMemoryBytes: fourGiB });
  assert.equal(qhd.scale, 1.7778);
  assert.equal(qhd.hardStopBytes, Math.ceil(1024 * (2560 * 1440) / (1920 * 1080)) * MIB); // 1821 MiB
  assert.equal(qhd.machineFloor, false);
  assert.equal(qhd.machineCapped, false);
  assert.equal(resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: fourGiB }).hardStopBytes, 1024 * MIB);
  assert.equal(resolveMemoryBudget({ env: {}, width: 1080, height: 1920, totalMemoryBytes: fourGiB }).scale, 1);
  assert.equal(resolveMemoryBudget({ env: {}, width: 1280, height: 720, totalMemoryBytes: fourGiB }).hardStopBytes, 1024 * MIB);
  assert.equal(resolveMemoryBudget({ env: {}, soft: true, width: 3840, height: 2160, totalMemoryBytes: sixteenGiB }).hardStopBytes, 8192 * MIB);
});

test("スケール後の hard stop は物理メモリの 50% で切り詰め、warning はその 75% に置く（2026-09-01 裁定: 上限は 1080p 以下にも常に効くので、1 GiB 機の 1080p 既定 1,024 MiB は 512 MiB に切り詰める — 従来の「切り詰めない」を撤回）", () => {
  const eightGiB = 8 * GIB;
  const gpu4k = resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(gpu4k.hardStopBytes, 4096 * MIB); // ちょうど 50% なので切り詰め無し
  assert.equal(gpu4k.machineCapped, false);
  assert.equal(gpu4k.machineFloor, false); // 下限 2,048 MiB < 4,096 MiB
  const soft4k = resolveMemoryBudget({ env: {}, soft: true, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(soft4k.hardStopBytes, 4096 * MIB);
  assert.equal(soft4k.warningBytes, 3072 * MIB);
  assert.equal(soft4k.machineCapped, true);
  assert.equal(soft4k.machineFloor, false);
  const tiny = resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: 1 * GIB });
  assert.equal(tiny.hardStopBytes, 512 * MIB);
  assert.equal(tiny.warningBytes, 384 * MIB);
  assert.equal(tiny.machineCapped, true);
  assert.equal(tiny.machineFloor, false);
});

test("env 上書きは絶対値でスケールも上限も受けず、hard stop だけの上書きには warning が追従する", () => {
  const eightGiB = 8 * GIB;
  const explicit = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "5000", AKARI_OSR_MEMORY_HARD_STOP_MIB: "6000" }, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(explicit.hardStopBytes, 6000 * MIB);
  assert.equal(explicit.warningBytes, 5000 * MIB);
  assert.equal(explicit.machineCapped, false);
  assert.equal(explicit.machineFloor, false);
  // 4K で hard stop=1600 MiB だけ指定（今回の実機報告の形）: 既定 warning 3072 MiB ≥ 1600 なので 1200 MiB へ追従
  const hardOnly = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_HARD_STOP_MIB: "1600" }, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  assert.equal(hardOnly.hardStopBytes, 1600 * MIB);
  assert.equal(hardOnly.warningBytes, 1200 * MIB);
  // warning だけを既定 hard stop 以上にするのは従来どおり拒否
  assert.throws(() => resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "4096" }, width: 3840, height: 2160, totalMemoryBytes: eightGiB }), /warning < hard stop/);
});

// ---- 2026-09-01 裁定: 物理メモリ 25% の下限（issue #28 の 720p / 1080p が 1 GiB 固定に当たる問題） ----

test("(a) 720p・totalmem 16 GiB: 物理メモリ 25% の下限が効いて hard stop 4,096 MiB・warning はその 75% の 3,072 MiB・machineFloor true", () => {
  const sixteenGiB = 16 * GIB;
  assert.deepEqual(resolveMemoryBudget({ env: {}, width: 1280, height: 720, totalMemoryBytes: sixteenGiB }), {
    profile: "gpu",
    warningBytes: 3072 * MIB,
    hardStopBytes: 4096 * MIB,
    workerBudgetBytes: 4096 * MIB,
    scale: 1,
    machineFloor: true,
    machineCapped: false,
    totalMemoryBytes: sixteenGiB,
  });
  // 1080p も同じ下限（解像度スケールは 1 のまま）
  const fhd = resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: sixteenGiB });
  assert.equal(fhd.hardStopBytes, 4096 * MIB);
  assert.equal(fhd.warningBytes, 3072 * MIB);
  assert.equal(fhd.machineFloor, true);
});

test("(b) 4K・totalmem 16 GiB: max(4,096, 4,096) = 4,096 MiB で従来の 4K 期待値と同値・同値なので machineFloor は false・warning はスケール側の 3,072 MiB", () => {
  const budget = resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes: 16 * GIB });
  assert.equal(budget.hardStopBytes, 4096 * MIB);
  assert.equal(budget.warningBytes, 3072 * MIB);
  assert.equal(budget.scale, 4);
  assert.equal(budget.machineFloor, false);
  assert.equal(budget.machineCapped, false);
});

test("(c) 720p・totalmem 4 GiB: 下限 1,024 MiB は GPU 基準と同値なので 1,024 / 768 MiB のまま・machineFloor false", () => {
  const budget = resolveMemoryBudget({ env: {}, width: 1280, height: 720, totalMemoryBytes: 4 * GIB });
  assert.equal(budget.hardStopBytes, 1024 * MIB);
  assert.equal(budget.warningBytes, 768 * MIB);
  assert.equal(budget.machineFloor, false);
  assert.equal(budget.machineCapped, false);
});

test("(d) 4K・totalmem 4 GiB: スケール 4,096 MiB を上限 2,048 MiB で切り詰め・warning 1,536 MiB・machineCapped true・machineFloor false", () => {
  const budget = resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes: 4 * GIB });
  assert.equal(budget.hardStopBytes, 2048 * MIB);
  assert.equal(budget.warningBytes, 1536 * MIB);
  assert.equal(budget.scale, 4);
  assert.equal(budget.machineCapped, true);
  assert.equal(budget.machineFloor, false);
});

test("(e) env 上書きは絶対値で下限も上限も受けない: 720p・16 GiB で 500 / 700 MiB がそのまま、hard stop だけなら warning は 75% に追従、warning だけの 2,000 MiB は下限 4,096 MiB の下なので許容（4 GiB 機では拒否）", () => {
  const sixteenGiB = 16 * GIB;
  const both = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "500", AKARI_OSR_MEMORY_HARD_STOP_MIB: "700" }, width: 1280, height: 720, totalMemoryBytes: sixteenGiB });
  assert.equal(both.warningBytes, 500 * MIB);
  assert.equal(both.hardStopBytes, 700 * MIB);
  assert.equal(both.workerBudgetBytes, 700 * MIB);
  // 4K の上限側も同じく絶対値（4 GiB 機の上限 2,048 MiB を超える 6,000 MiB がそのまま）
  const above = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "5000", AKARI_OSR_MEMORY_HARD_STOP_MIB: "6000" }, width: 3840, height: 2160, totalMemoryBytes: 4 * GIB });
  assert.equal(above.hardStopBytes, 6000 * MIB);
  assert.equal(above.warningBytes, 5000 * MIB);
  // hard stop だけ 700 MiB: 下限適用後の既定 warning 3,072 MiB ≥ 700 なので 525 MiB（75%）へ追従
  const hardOnly = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_HARD_STOP_MIB: "700" }, width: 1280, height: 720, totalMemoryBytes: sixteenGiB });
  assert.equal(hardOnly.hardStopBytes, 700 * MIB);
  assert.equal(hardOnly.warningBytes, 525 * MIB);
  // machineFloor / machineCapped は budget scale と同じく既定値の導出を表す（env 上書きでも導出結果を残す）
  assert.equal(hardOnly.machineFloor, true);
  assert.equal(hardOnly.scale, 1);
  const warnOnly = resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "2000" }, width: 1280, height: 720, totalMemoryBytes: sixteenGiB });
  assert.equal(warnOnly.warningBytes, 2000 * MIB);
  assert.equal(warnOnly.hardStopBytes, 4096 * MIB);
  assert.throws(() => resolveMemoryBudget({ env: { AKARI_OSR_MEMORY_WARN_MIB: "2000" }, width: 1280, height: 720, totalMemoryBytes: 4 * GIB }), /warning < hard stop/);
});

test("--soft も同じ式: 720p・16 GiB は max(2,048, 4,096) = 4,096 / 3,072 MiB で machineFloor true、1080p・8 GiB は下限 2,048 MiB が SOFT 基準と同値なので 1,536 / 2,048 MiB・false", () => {
  const soft720 = resolveMemoryBudget({ env: {}, soft: true, width: 1280, height: 720, totalMemoryBytes: 16 * GIB });
  assert.equal(soft720.profile, "soft");
  assert.equal(soft720.hardStopBytes, 4096 * MIB);
  assert.equal(soft720.warningBytes, 3072 * MIB);
  assert.equal(soft720.machineFloor, true);
  assert.equal(soft720.machineCapped, false);
  const soft1080 = resolveMemoryBudget({ env: {}, soft: true, width: 1920, height: 1080, totalMemoryBytes: 8 * GIB });
  assert.equal(soft1080.hardStopBytes, 2048 * MIB);
  assert.equal(soft1080.warningBytes, 1536 * MIB);
  assert.equal(soft1080.machineFloor, false);
});

test("実機と CI の下限（MiB 切り捨て）: 15.7 GB（16,866,897,920 B）機の 720p は 4,021 / 3,015 MiB、8 GiB 機は 2,048 / 1,536 MiB、7 GiB runner は 1,792 / 1,344 MiB", () => {
  const owner = resolveMemoryBudget({ env: {}, width: 1280, height: 720, totalMemoryBytes: 16_866_897_920 });
  assert.equal(owner.hardStopBytes, 4021 * MIB);
  assert.equal(owner.warningBytes, 3015 * MIB);
  assert.equal(owner.machineFloor, true);
  assert.equal(owner.totalMemoryBytes, 16_866_897_920);
  const eight = resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: 8 * GIB });
  assert.equal(eight.hardStopBytes, 2048 * MIB);
  assert.equal(eight.warningBytes, 1536 * MIB);
  assert.equal(eight.machineFloor, true);
  const runner = resolveMemoryBudget({ env: {}, width: 1920, height: 1080, totalMemoryBytes: 7 * GIB });
  assert.equal(runner.hardStopBytes, 1792 * MIB);
  assert.equal(runner.warningBytes, 1344 * MIB);
  assert.equal(runner.machineFloor, true);
});

test("totalMemoryBytes が 0 / 負 / 非数 / null のときは下限も上限も効かず totalMemoryBytes は null", () => {
  for (const totalMemoryBytes of [0, -1, Number.NaN, null, "x"]) {
    const budget = resolveMemoryBudget({ env: {}, width: 3840, height: 2160, totalMemoryBytes });
    assert.equal(budget.hardStopBytes, 4096 * MIB, String(totalMemoryBytes));
    assert.equal(budget.warningBytes, 3072 * MIB);
    assert.equal(budget.machineFloor, false);
    assert.equal(budget.machineCapped, false);
    assert.equal(budget.totalMemoryBytes, null);
  }
});

test("サンプラーの snapshot と receipt は予算のスケール・下限・上限適用と物理メモリを運ぶ", async () => {
  const { buildOsrReceipt } = await import("../src/receipt.mjs");
  const eightGiB = 8 * GIB;
  const budget = resolveMemoryBudget({ env: {}, soft: true, width: 3840, height: 2160, totalMemoryBytes: eightGiB });
  const snapshot = createMemorySampler({ intervalMs: 60_000, sample: () => 1, budget }).stop();
  assert.equal(snapshot.budgetScale, 4);
  assert.equal(snapshot.machineCapped, true);
  assert.equal(snapshot.machineFloor, false);
  assert.equal(snapshot.totalMemoryBytes, eightGiB);
  const receipt = buildOsrReceipt({ tier: 2, profile: "soft", memory: snapshot });
  assert.equal(receipt.memory.budget_scale, 4);
  assert.equal(receipt.memory.machine_capped, true);
  assert.equal(receipt.memory.machine_floor, false);
  assert.equal(receipt.memory.total_memory_bytes, eightGiB);
  assert.equal(receipt.memory.hard_stop_bytes, 4096 * MIB);
  // 下限が効いた snapshot（720p・16 GiB）
  const floored = createMemorySampler({ intervalMs: 60_000, sample: () => 1, budget: resolveMemoryBudget({ env: {}, width: 1280, height: 720, totalMemoryBytes: 16 * GIB }) }).stop();
  assert.equal(floored.machineFloor, true);
  assert.equal(floored.hardStopBytes, 4096 * MIB);
  assert.equal(buildOsrReceipt({ tier: 2, memory: floored }).memory.machine_floor, true);
  assert.equal(buildOsrReceipt({ tier: 2, memory: floored }).memory.total_memory_bytes, 16 * GIB);
  // snapshot 無しの fallback は本機の物理メモリで導出した既定（下限込み）
  const machine = resolveMemoryBudget({ env: {} });
  const fallback = buildOsrReceipt({ tier: 2 });
  assert.equal(fallback.memory.budget_scale, 1);
  assert.equal(fallback.memory.machine_capped, machine.machineCapped);
  assert.equal(fallback.memory.machine_floor, machine.machineFloor);
  assert.equal(fallback.memory.total_memory_bytes, machine.totalMemoryBytes);
  assert.equal(fallback.memory.hard_stop_bytes, machine.hardStopBytes);
});
