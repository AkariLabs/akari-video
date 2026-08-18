import assert from "node:assert/strict";
import test from "node:test";

import { slipAudioWindow, clampSfxFadeToEffectiveDuration } from "../lib/common/audio-clip-trimmer.js";

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §3 (ソーストリマー) applied to
// audio.sfx[] with the same slip semantics as cuts (cut-slip / slipCutInSource).

test("slipAudioWindow shifts in/out by the same delta and preserves the window duration", () => {
  const result = slipAudioWindow(1, 3, 0.5, 10);
  assert.equal(result.in, 1.5);
  assert.equal(result.out, 3.5);
  assert.equal(result.out - result.in, 2, "尺（out-in）は不変であるべき");
});

test("slipAudioWindow clamps at the left boundary (in >= 0) while keeping the window width", () => {
  const result = slipAudioWindow(1, 3, -5, 10);
  assert.equal(result.in, 0);
  assert.equal(result.out, 2, "尺 2 秒を保ったまま 0 起点にクランプ");
});

test("slipAudioWindow clamps at the right boundary (out <= sourceDuration) while keeping the window width", () => {
  const result = slipAudioWindow(1, 3, 100, 10);
  assert.equal(result.out, 10);
  assert.equal(result.in, 8, "尺 2 秒を保ったまま素材末尾にクランプ");
});

test("slipAudioWindow is a no-op when delta is 0", () => {
  const result = slipAudioWindow(2.5, 6.5, 0, 20);
  assert.equal(result.in, 2.5);
  assert.equal(result.out, 6.5);
});

test("clampSfxFadeToEffectiveDuration clamps each of fade_in/fade_out independently to half the effective duration", () => {
  // 実効尺 2 秒 → 半分は 1 秒。fade_in 1.5 は 1 秒へクランプ、fade_out 0.4 はそのまま。
  const result = clampSfxFadeToEffectiveDuration(1.5, 0.4, 2);
  assert.equal(result.fadeIn, 1);
  assert.equal(result.fadeOut, 0.4);
});

test("clampSfxFadeToEffectiveDuration follows a shrinking effective duration (トリムで尺が縮んだらフェード表示も追随)", () => {
  // トリム前: 実効尺 4 秒、fade_in/out ともに 1.5 秒（クランプ不要 <= 半分の 2 秒）。
  const before = clampSfxFadeToEffectiveDuration(1.5, 1.5, 4);
  assert.equal(before.fadeIn, 1.5);
  assert.equal(before.fadeOut, 1.5);
  // トリムで実効尺が 2 秒に縮む → 半分 1 秒へ両方ともクランプされる。
  const after = clampSfxFadeToEffectiveDuration(1.5, 1.5, 2);
  assert.equal(after.fadeIn, 1);
  assert.equal(after.fadeOut, 1);
});

test("clampSfxFadeToEffectiveDuration treats undefined/0/negative/non-finite as no fade", () => {
  assert.deepEqual(clampSfxFadeToEffectiveDuration(undefined, undefined, 4), { fadeIn: 0, fadeOut: 0 });
  assert.deepEqual(clampSfxFadeToEffectiveDuration(0, -1, 4), { fadeIn: 0, fadeOut: 0 });
  assert.deepEqual(clampSfxFadeToEffectiveDuration(Number.NaN, Number.POSITIVE_INFINITY, 4), { fadeIn: 0, fadeOut: 0 });
});

test("clampSfxFadeToEffectiveDuration clamps to 0 when the effective duration collapses to 0", () => {
  assert.deepEqual(clampSfxFadeToEffectiveDuration(1, 1, 0), { fadeIn: 0, fadeOut: 0 });
});
