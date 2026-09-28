import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStampSamples,
  retryUntilVerified,
  stampRetryDelayMs,
  stampVerifyFailureMessage,
} from "../src/paint-bitmap.mjs";

test("stampRetryDelayMs caps the exponential delay and rejects invalid input", () => {
  for (const [retry, expected] of [[1, 0], [2, 16], [3, 32], [7, 500], [20, 500], [0, 0], [-1, 0], [NaN, 0]]) {
    assert.equal(stampRetryDelayMs(retry), expected);
  }
});

test("retryUntilVerified returns immediately for a matching first capture", async () => {
  let calls = 0;
  const result = await retryUntilVerified({
    check: () => true, settle: () => { calls += 1; }, recapture: () => { calls += 1; }, now: () => 5,
  });
  assert.deepEqual(result, { satisfied: true, retries: 0, elapsedMs: 0 });
  assert.equal(calls, 0);
});

test("retryUntilVerified waits before settle from the second retry", async () => {
  let captures = 0;
  const waits = [];
  const calls = [];
  const result = await retryUntilVerified({
    check: () => captures === 3,
    settle: () => { calls.push("settle"); },
    recapture: () => { captures += 1; calls.push("capture"); },
    wait: (ms) => { waits.push(ms); calls.push("wait"); },
    now: () => 0,
  });
  assert.equal(result.satisfied, true);
  assert.equal(result.retries, 3);
  assert.deepEqual(waits, [16, 32]);
  assert.deepEqual(calls, ["settle", "capture", "wait", "settle", "capture", "wait", "settle", "capture"]);
});

test("retryUntilVerified stops at the count or time budget", async () => {
  let count = 0;
  const countResult = await retryUntilVerified({
    check: () => false, settle: () => {}, recapture: () => { count += 1; },
    wait: () => {}, now: () => 0, maximumRetries: 4,
  });
  assert.equal(count, 4);
  assert.deepEqual(countResult, { satisfied: false, retries: 4, elapsedMs: 0 });

  let clock = 0;
  const timeResult = await retryUntilVerified({
    check: () => false, settle: () => {}, recapture: () => { clock += 1_000; },
    wait: () => {}, now: () => clock, budgetMs: 3_000,
  });
  assert.equal(timeResult.satisfied, false);
  assert.equal(timeResult.retries, 3);
  assert.ok(timeResult.elapsedMs >= 3_000);
});

test("retryUntilVerified disables waits for hash verification", async () => {
  let captures = 0;
  let waits = 0;
  await retryUntilVerified({
    check: () => captures === 3, settle: () => {}, recapture: () => { captures += 1; },
    wait: () => { waits += 1; }, now: () => 0, backoff: false,
  });
  assert.equal(waits, 0);
});

const sample = (frameNumber, validColor = true, x = 0) => ({ x, frameNumber, bgra: [85, 1, 2, 255], validColor });

test("classifyStampSamples distinguishes stale, ahead, torn, color and wraparound", () => {
  assert.equal(classifyStampSamples([sample(294), sample(294)], 295), "stale");
  assert.equal(classifyStampSamples([sample(296), sample(296)], 295), "ahead");
  assert.equal(classifyStampSamples([sample(294), sample(295)], 295), "torn");
  assert.equal(classifyStampSamples([sample(294), sample(294, false)], 295), "color");
  assert.equal(classifyStampSamples([sample(295), sample(295)], 295), "match");
  assert.equal(classifyStampSamples([sample(65_535), sample(65_535)], 0), "stale");
});

test("stamp failure includes measurements, cause, overlays, budget and retry advice", () => {
  const base = {
    frame: 295, retries: 12, elapsedMs: 3012, activeDevice: "Intel(R) UHD Graphics",
    expectedFrameNumber: 295, samples: [sample(294)],
    overlays: [{ id: "warm", blend: "normal", cssFeatures: ["mix-blend-mode: soft-light"] }],
  };
  const message = stampVerifyFailureMessage(base);
  assert.match(message, /^frame 295 stamp verify failed after 12 retries over 3012 ms（GPU: Intel\(R\) UHD Graphics）/);
  for (const part of ["expected stamp 295", "x=0:294", "1 コマ前の絵のまま", "active overlays: warm（CSS: mix-blend-mode: soft-light）", "予算 3000 ms / 32 回"]) {
    assert.ok(message.includes(part), part);
  }
  assert.ok(message.endsWith("同じ内容で再実行してください"));
  assert.match(stampVerifyFailureMessage({ ...base, overlays: null }), /active overlays: 取得できませんでした/);
  assert.match(stampVerifyFailureMessage({ ...base, overlays: [] }), /active overlays: なし/);
  const color = stampVerifyFailureMessage({ ...base, samples: [sample(294, false)] });
  assert.match(color, /色不一致 BGRA/);
  assert.match(color, /stamp 行の色が崩れている/);
  assert.match(stampVerifyFailureMessage({ ...base, overlays: Array.from({ length: 9 }, (_, id) => ({ id: String(id) })) }), /ほか 1 件/);
});
