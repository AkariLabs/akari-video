import assert from "node:assert/strict";
import test from "node:test";

import { slipCutInSource } from "../lib/common/edit-store.js";

const cutSource = `{
  "cuts": [
    { "in": 10, "out": 15, "at": 2 },
    { "in": 0, "out": 4 }
  ],
  "overlays": []
}
`;

test("slipCutInSource shifts in/out by the same amount and leaves at untouched (尺・タイムライン位置は不変)", () => {
  const updated = slipCutInSource(cutSource, 0, 12, 17);
  const parsed = JSON.parse(updated);
  assert.equal(parsed.cuts[0].in, 12);
  assert.equal(parsed.cuts[0].out, 17);
  assert.equal(parsed.cuts[0].at, 2, "at はソース秒の変化に関わらず不変であるべき");
  assert.equal(parsed.cuts[1].in, 0, "他クリップは無変更");
  assert.equal(parsed.cuts[1].out, 4);
});

test("slipCutInSource clamps out against maxOutSeconds and rejects an out beyond it", () => {
  assert.throws(() => slipCutInSource(cutSource, 0, 10, 20, 15), /実尺を超えています/u);
  const updated = slipCutInSource(cutSource, 0, 8, 13, 15);
  const parsed = JSON.parse(updated);
  assert.equal(parsed.cuts[0].in, 8);
  assert.equal(parsed.cuts[0].out, 13);
});

test("slipCutInSource rejects invalid or too-short ranges", () => {
  assert.throws(() => slipCutInSource(cutSource, 0, -1, 4), /時刻が不正/u);
  assert.throws(() => slipCutInSource(cutSource, 0, 0, 0.1), /短すぎます/u);
  assert.throws(() => slipCutInSource(cutSource, 99, 0, 1), /見つかりません/u);
});

test("slipCutInSource preserves the exact duration (out−in) across a shift", () => {
  const originalDuration = 15 - 10;
  const updated = slipCutInSource(cutSource, 0, 11.5, 11.5 + originalDuration);
  const parsed = JSON.parse(updated);
  assert.equal(parsed.cuts[0].out - parsed.cuts[0].in, originalDuration);
});
