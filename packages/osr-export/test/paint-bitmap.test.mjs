import assert from "node:assert/strict";
import test from "node:test";

import {
  OSR_EMPTY_PAINT_BUDGET_MS,
  OSR_MAXIMUM_EMPTY_ATTEMPTS,
  captureNonEmptyBitmap,
  createEmptyPaintRecorder,
  emptyPaintFailureMessage,
  readPaintBitmap,
  recordEmptyPaints,
} from "../src/paint-bitmap.mjs";

function image(width, height, bytes = width * height * 4) {
  return {
    getSize: () => ({ width, height }),
    toBitmap: () => Buffer.alloc(bytes),
  };
}

// 注入時計（契約 §11.8 裁定 5）: capture / settle の所要を決め打ちで進める。frames が尽きたら最後の要素を返し続ける。
function harness({ captureMs = 0, settleMs = 0, frames }) {
  let time = 0;
  let captures = 0;
  let settles = 0;
  const queue = [...frames];
  return {
    now: () => time,
    capture: async () => { captures += 1; time += captureMs; return queue.length > 1 ? queue.shift() : queue[0]; },
    settle: async () => { settles += 1; time += settleMs; },
    counts: () => ({ captures, settles, time }),
  };
}

test("空 paint は settle 後に再取得して成功する", async () => {
  const frames = [image(0, 0, 0), image(2, 0, 0), image(4, 4)];
  let settles = 0;
  let emptyCallbacks = 0;
  const result = await captureNonEmptyBitmap({
    frame: 7, width: 4, height: 3,
    capture: async () => frames.shift(),
    settle: async () => { settles += 1; },
    onEmpty: () => { emptyCallbacks += 1; },
  });
  assert.equal(result.emptyAttempts, 2);
  assert.equal(result.bitmap.length, 64);
  assert.equal(settles, 2);
  assert.equal(emptyCallbacks, 2);
});

test("既定の上限は時間 2000 ms と回数 64 回", () => {
  assert.equal(OSR_EMPTY_PAINT_BUDGET_MS, 2000);
  assert.equal(OSR_MAXIMUM_EMPTY_ATTEMPTS, 64);
});

test("(a) 空 8 回のあと非空（予算 2000 ms 内）なら成功し、emptyAttempts 8 と emptyPaints の elapsed_ms が記録される（従来は 8 回で throw）", async () => {
  // capture 100 ms・settle 50 ms: 8 回目の空 paint は 8×100 + 7×50 = 1150 ms、9 回目（非空）で 1300 ms
  const h = harness({ captureMs: 100, settleMs: 50, frames: [...Array(8).fill(image(0, 0, 0)), image(4, 4)] });
  const emptyPaints = [];
  const result = await captureNonEmptyBitmap({
    frame: 0, width: 4, height: 3,
    capture: h.capture, settle: h.settle, now: h.now,
    onEmpty: createEmptyPaintRecorder(emptyPaints, 0, h.now),
  });
  assert.equal(result.emptyAttempts, 8);
  assert.equal(result.bitmap.length, 64);
  assert.deepEqual(h.counts(), { captures: 9, settles: 8, time: 1300 });
  assert.deepEqual(emptyPaints, [{ frame: 0, attempts: 8, elapsed_ms: 1150 }]);
});

test("(b) 予算 2000 ms に達したら throw し、文言に回数・ms・GPU 名が入る", async () => {
  // 300 ms ごとに空 → 7 回目で 2100 ms ≥ 2000 ms
  const h = harness({ captureMs: 300, settleMs: 0, frames: [image(0, 0, 0)] });
  await assert.rejects(() => captureNonEmptyBitmap({
    frame: 0, width: 4, height: 3,
    capture: h.capture, settle: h.settle, now: h.now,
    activeDevice: "Intel(R) UHD Graphics",
  }), { message: "frame 0: offscreen paint returned an empty bitmap 7 times over 2100 ms（GPU: Intel(R) UHD Graphics）" });
  assert.deepEqual(h.counts(), { captures: 7, settles: 6, time: 2100 });
});

test("(b') settle の所要も予算に含める（capture 0 ms・settle 500 ms なら 5 回目の空で 2000 ms）", async () => {
  const h = harness({ captureMs: 0, settleMs: 500, frames: [image(4, 4, 0)] });
  await assert.rejects(() => captureNonEmptyBitmap({
    frame: 3, width: 4, height: 3, capture: h.capture, settle: h.settle, now: h.now, emptyPaintBudgetMs: 2000,
  }), { message: "frame 3: offscreen paint returned an empty bitmap 5 times over 2000 ms（GPU: unknown）" });
  assert.deepEqual(h.counts(), { captures: 5, settles: 4, time: 2000 });
});

test("(c) 時計が進まないときは 64 回で throw する（GPU 不明は unknown）", async () => {
  const h = harness({ captureMs: 0, settleMs: 0, frames: [image(0, 0, 0)] });
  let empties = 0;
  await assert.rejects(() => captureNonEmptyBitmap({
    frame: 12, width: 4, height: 3, capture: h.capture, settle: h.settle, now: h.now, onEmpty: () => { empties += 1; },
  }), { message: "frame 12: offscreen paint returned an empty bitmap 64 times over 0 ms（GPU: unknown）" });
  assert.deepEqual(h.counts(), { captures: 64, settles: 63, time: 0 });
  assert.equal(empties, 64);
});

test("maximumEmptyAttempts を 8 に下げれば従来どおり 8 回で throw する", async () => {
  const h = harness({ captureMs: 10, settleMs: 0, frames: [image(0, 0, 0)] });
  await assert.rejects(() => captureNonEmptyBitmap({
    frame: 12, width: 4, height: 3, capture: h.capture, settle: h.settle, now: h.now, maximumEmptyAttempts: 8,
  }), /^Error: frame 12: offscreen paint returned an empty bitmap 8 times over 80 ms/u);
  assert.equal(h.counts().captures, 8);
});

test("emptyPaintFailureMessage は ms を整数に丸め、GPU 名が無ければ unknown", () => {
  assert.equal(
    emptyPaintFailureMessage({ frame: 0, attempts: 9, elapsedMs: 2003.6, activeDevice: "NVIDIA GeForce RTX 5060 Laptop GPU" }),
    "frame 0: offscreen paint returned an empty bitmap 9 times over 2004 ms（GPU: NVIDIA GeForce RTX 5060 Laptop GPU）",
  );
  assert.equal(emptyPaintFailureMessage({ frame: 1, attempts: 2, elapsedMs: 10 }), "frame 1: offscreen paint returned an empty bitmap 2 times over 10 ms（GPU: unknown）");
});

test("(e) emptyPaints[] は { frame, attempts, elapsed_ms } で、同じ frame の再 capture は attempts / elapsed_ms を足し込む", () => {
  const records = [];
  assert.equal(recordEmptyPaints(records, 0, 0), null);
  assert.deepEqual(records, []);
  recordEmptyPaints(records, 0, 2, 120.4);
  recordEmptyPaints(records, 0, 1, 30);
  recordEmptyPaints(records, 5, 1, 7);
  assert.deepEqual(records, [{ frame: 0, attempts: 3, elapsed_ms: 150 }, { frame: 5, attempts: 1, elapsed_ms: 7 }]);

  // 記録子: 生成時からの経過を既存 elapsed_ms に上乗せ（stamp 再試行で同じ frame を 2 回 capture した形）
  let time = 0;
  const now = () => time;
  const first = createEmptyPaintRecorder(records, 9, now);
  time = 40; first();
  time = 90; first();
  assert.deepEqual(records.at(-1), { frame: 9, attempts: 2, elapsed_ms: 90 });
  time = 100;
  const second = createEmptyPaintRecorder(records, 9, now);
  time = 130; second();
  assert.deepEqual(records.at(-1), { frame: 9, attempts: 3, elapsed_ms: 120 });
});

test("空ではないサイズ不一致は requested / measured を含む文言で即失敗し、DPR 1 では device scale factor を案内しない", () => {
  assert.throws(() => readPaintBitmap(image(8, 8), 4, 3, 1), /^Error: frame 1 bitmap size 8x8, expected 4x4; requested 4x4, measured 8x8/u);
  assert.throws(() => readPaintBitmap(image(8, 8), 4, 3, 1), (error) => !/--force-device-scale-factor/u.test(error.message));
  assert.throws(() => readPaintBitmap(image(8, 8), 4, 3, 1, { devicePixelRatio: 2 }), /--force-device-scale-factor=1/u);
});

test("寸法が正しくても bitmap 長 0 は空 paint として扱う", () => {
  assert.equal(readPaintBitmap(image(4, 4, 0), 4, 3, 2).empty, true);
});
