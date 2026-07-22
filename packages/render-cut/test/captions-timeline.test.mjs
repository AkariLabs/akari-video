import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays, sourceRangeToTimeline } from "../src/captions.mjs";

const cuts = [
  { in: 0.0, out: 10.62, transition_out: null },
  { in: 776.24, out: 795.78, transition_out: { type: "dissolve", duration: 0.5 } },
  { in: 795.78, out: 801.36, speed: 0.9, transition_out: { type: "dissolve", duration: 0.5 } },
  { in: 2550.34, out: 2567.34, transition_out: { type: "dissolve", duration: 0.5 } },
  { in: 2672.34, out: 2689.34, transition_out: { type: "dissolve", duration: 0.5 } },
  { in: 2773.34, out: 2796.34, transition_out: { type: "fade-black", duration: 0.5 } },
  { in: 2814.34, out: 2822.34, speed: 0.9, transition_out: null },
  { in: 2822.34, out: 2830.34, transition_out: null },
  { in: 3235.34, out: 3242.34, transition_out: null },
  { in: 3694.2, out: 3732.4, speed: 0.9, transition_out: null },
];

function assertClose(actual, expected, tolerance = 0.02) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test("source ranges account for transition overlap and cut speed across a multi-cut timeline", () => {
  const emotion = sourceRangeToTimeline(795.78, 801.36, cuts);
  const ending = sourceRangeToTimeline(3694.2, 3732.4, cuts);

  assert.equal(emotion.length, 1);
  assertClose(emotion[0].start, 29.66);
  assert.ok(Math.abs(emotion[0].start - 30.16) > 0.02);

  assert.equal(ending.length, 1);
  assertClose(ending[0].start, 114.7489);
  assert.ok(Math.abs(ending[0].start - 115.74) > 0.02);
});

test("plain caption generation uses the shared multi-cut timeline mapping", () => {
  const overlays = generateCaptionOverlays(
    [
      { id: "emotion", start: 795.78, end: 801.36, text: "感情を言葉にする" },
      { id: "ending", start: 3694.2, end: 3732.4, text: "最後までご覧いただきありがとうございます" },
    ],
    cuts,
  );

  assert.equal(overlays.length, 2);
  assertClose(overlays[0].start, 29.66);
  assert.ok(Math.abs(overlays[0].start - 30.16) > 0.02);
  assertClose(overlays[1].start, 114.7489);
  assert.ok(Math.abs(overlays[1].start - 115.74) > 0.02);
});
