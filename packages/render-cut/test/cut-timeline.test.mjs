import assert from "node:assert/strict";
import test from "node:test";

import { needsGapAwareCutTimeline, resolveCutSegments } from "../src/cut-timeline.mjs";

test("multiple cuts without at or track keep the legacy timeline", () => {
  const cuts = [
    { in: 0, out: 5 },
    { in: 10, out: 15 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), false);
});

test("explicit track 0 and natural at positions keep the legacy timeline", () => {
  const cuts = [
    { at: 0, in: 0, out: 5, track: 0 },
    { at: 5, in: 10, out: 15, track: 0 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), false);
});

test("at can create a gap and resolved segment ends use output-axis duration", () => {
  const cuts = [
    { in: 0, out: 5 },
    { at: 8, in: 10, out: 15 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), true);
  assert.deepEqual(
    resolveCutSegments(cuts).map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 5 },
      { start: 8, end: 13 },
    ],
  );
});

test("any cut on a higher track requires the gap-aware timeline", () => {
  assert.equal(needsGapAwareCutTimeline([{ in: 0, out: 5, track: 1 }]), true);
});

test("resolved segment ends account for cut speed", () => {
  const segments = resolveCutSegments([
    { in: 0, out: 6, speed: 2 },
    { in: 10, out: 14 },
  ]);
  assert.deepEqual(
    segments.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 3 },
      { start: 3, end: 7 },
    ],
  );
});
