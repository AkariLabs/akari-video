import assert from "node:assert/strict";
import test from "node:test";

import { sourceCutRuns, sourceTimeToTimeline } from "../bin/face-mosaic/timeline-map.mjs";

test("逐次 cut の source 時刻を speed 込みで render-cut と同じタイムラインへ写像する", () => {
  const runs = sourceCutRuns([{ in: 0, out: 2 }, { in: 4, out: 8, speed: 2 }]);
  assert.equal(runs.length, 2);
  assert.equal(sourceTimeToTimeline(runs[1], 6), 3);
});

test("gap-aware の高位 track に隠れる区間は visible run から除かれる", () => {
  const runs = sourceCutRuns([
    { in: 0, out: 5, at: 0, track: 0 },
    { in: 0, out: 1, at: 2, track: 1, src: "other" },
  ], null);
  assert.deepEqual(runs.map((run) => [run.outStart, run.outEnd]), [[0, 2], [3, 5]]);
});
