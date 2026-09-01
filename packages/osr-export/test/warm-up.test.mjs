import assert from "node:assert/strict";
import test from "node:test";

import { OSR_WARM_UP_BUDGET_MS, warmUpFailureMessage, warmUpOffscreenPaint } from "../src/paint-bitmap.mjs";

// 注入時計（契約 §11.8 裁定 5）: capture / settle の所要を決め打ちで進め、実時間には依存しない。
function harness({ captureMs, settleMs, results }) {
  let time = 0;
  let captures = 0;
  let settles = 0;
  const queue = [...results];
  return {
    now: () => time,
    capture: async () => { captures += 1; time += captureMs; return queue.length > 1 ? queue.shift() : queue[0]; },
    settle: async () => { settles += 1; time += settleMs; },
    readBitmap: (image) => ({ empty: image === "empty" }),
    counts: () => ({ captures, settles, time }),
  };
}

test("warm-up の既定予算は 5000 ms", () => {
  assert.equal(OSR_WARM_UP_BUDGET_MS, 5000);
});

test("warm-up: 最初の paint が非空なら attempts 1・empty_attempts 0・satisfied で settle は挟まない", async () => {
  const h = harness({ captureMs: 17, settleMs: 5, results: ["bitmap"] });
  const record = await warmUpOffscreenPaint({ capture: h.capture, settle: h.settle, readBitmap: h.readBitmap, now: h.now });
  assert.deepEqual(record, { attempts: 1, empty_attempts: 0, elapsed_ms: 17, satisfied: true });
  assert.deepEqual(h.counts(), { captures: 1, settles: 0, time: 17 });
});

test("warm-up: 空 N 回のあと非空なら attempts / empty_attempts / elapsed_ms（settle 込み）を記録し bitmap は返さない", async () => {
  // 空 12 回（従来の 8 回上限を超える）→ 13 回目で非空。120 ms × 13 + settle 10 ms × 12 = 1680 ms
  const h = harness({ captureMs: 120, settleMs: 10, results: [...Array(12).fill("empty"), "bitmap"] });
  const record = await warmUpOffscreenPaint({ capture: h.capture, settle: h.settle, readBitmap: h.readBitmap, budgetMs: 5000, now: h.now });
  assert.deepEqual(record, { attempts: 13, empty_attempts: 12, elapsed_ms: 1680, satisfied: true });
  assert.deepEqual(h.counts(), { captures: 13, settles: 12, time: 1680 });
  assert.equal("bitmap" in record, false);
});

test("warm-up: 予算に達したら satisfied false で返し、失敗文は回数・ms・GPU 名を含む", async () => {
  // 250 ms ごとに空 → 20 回目で 5000 ms に達する（予算超過後は settle しない）
  const h = harness({ captureMs: 250, settleMs: 0, results: ["empty"] });
  const record = await warmUpOffscreenPaint({ capture: h.capture, settle: h.settle, readBitmap: h.readBitmap, now: h.now });
  assert.deepEqual(record, { attempts: 20, empty_attempts: 20, elapsed_ms: 5000, satisfied: false });
  assert.deepEqual(h.counts(), { captures: 20, settles: 19, time: 5000 });
  assert.equal(
    warmUpFailureMessage({ ...record, activeDevice: "NVIDIA GeForce RTX 5060 Laptop GPU" }),
    "offscreen paint warm-up: 20 empty paints over 5000 ms（GPU: NVIDIA GeForce RTX 5060 Laptop GPU）",
  );
  assert.equal(warmUpFailureMessage(record), "offscreen paint warm-up: 20 empty paints over 5000 ms（GPU: unknown）");
});

test("warm-up: settle の所要も予算に含める（capture 0 ms・settle 1000 ms なら 6 回目の空で 5000 ms）", async () => {
  const h = harness({ captureMs: 0, settleMs: 1000, results: ["empty"] });
  const record = await warmUpOffscreenPaint({ capture: h.capture, settle: h.settle, readBitmap: h.readBitmap, budgetMs: 5000, now: h.now });
  assert.deepEqual(record, { attempts: 6, empty_attempts: 6, elapsed_ms: 5000, satisfied: false });
});

test("warm-up: readBitmap の例外（寸法不一致など）はそのまま伝播する", async () => {
  const h = harness({ captureMs: 1, settleMs: 1, results: ["bitmap"] });
  await assert.rejects(
    () => warmUpOffscreenPaint({ capture: h.capture, settle: h.settle, readBitmap: () => { throw new Error("frame warm-up bitmap size 1920x1032, expected 1920x1081"); }, now: h.now }),
    /frame warm-up bitmap size 1920x1032, expected 1920x1081/u,
  );
});
