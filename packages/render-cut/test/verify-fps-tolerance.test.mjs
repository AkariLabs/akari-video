import assert from "node:assert/strict";
import test from "node:test";

import { fpsWithinOneFrameTolerance, oneFrameFpsTolerance } from "../src/render-cut.mjs";

// task 2026-08-07-render-frame-accounting: verify.fps used to require exact equality
// (Math.abs(actualFps - expected.fps) < 0.001), but avg_frame_rate is ffprobe's own
// nb_frames/duration bookkeeping for the container -- not an independent measurement. Real
// footage run through render-cut's multi-segment trim/setpts/atempo/concat graph into a real
// encoder legitimately lands exactly 1 frame off nominal fps, in either direction, with zero
// actual content lost (full-decode frame count matches the plan exactly). Both empirical repros
// below are lifted verbatim from this task's investigation:
//
//   1. The real reel's v4/v5 production render (~/AkariVideo/channels/my-channel/videos/
//      2026-08-07-akari-reel, 13 cuts / 5 speed changes / 1 dissolve, --quality high --encoder
//      videotoolbox): ffprobe reported avg_frame_rate "44100/1471" = 29.97960571040109,
//      nb_frames 1470, for a plan whose predicted_duration_seconds (49.033266666666655s) implies
//      1471 frames at 30fps. verify.duration and verify.frame-count both already passed (1470 is
//      within frame-count's own ±3 tolerance); only the old exact-equality verify.fps failed.
//   2. This task's own repro: the SAME cuts against the reel's actual take-a.mp4/take-b.mp4
//      source footage and the same encoder args, rendered fresh. This run's full decode confirmed
//      exactly 1471 frames present (zero content lost) yet ffprobe still reported avg_frame_rate
//      "22065/736" = 29.97961956521739 -- the container's own declared video-track duration
//      (49.066667s) was inflated by 1 frame's worth of time relative to its true 1471-frame
//      content. Same failure mode as (1), opposite direction, proving this is mux-side rounding
//      noise rather than a deterministic content bug tied to any specific cut.
//
// The tolerance is intentionally exactly "1 frame" (not frame-count's own ±3-frame-equivalent
// window) so a genuine multi-frame drop -- like the original v1 render's real 3-frame loss, from
// before its cut boundaries were snapped to the fps grid -- still fails. That is the Goodhart
// guard this task's completion criteria call for.

test("oneFrameFpsTolerance is expectedFps / expectedFrameCount, and 0 when frame count is 0", () => {
  assert.equal(oneFrameFpsTolerance(30, 1471), 30 / 1471);
  assert.equal(oneFrameFpsTolerance(30, 0), 0);
});

test("verify.fps passes the real v4/v5 production numbers (1 frame of container rounding, zero real content lost)", () => {
  // measured avg_frame_rate 44100/1471, exactly 1 frame's worth of drift from a 1471-frame plan.
  const actualFps = 44100 / 1471;
  assert.ok(
    fpsWithinOneFrameTolerance(actualFps, 30, 1471),
    `expected ${actualFps} to be within 1 frame of 30fps @ 1471 frames`,
  );
});

test("verify.fps passes this task's own real-footage repro (22065/736, 1471 frames actually decoded)", () => {
  const actualFps = 22065 / 736;
  assert.ok(
    fpsWithinOneFrameTolerance(actualFps, 30, 1471),
    `expected ${actualFps} to be within 1 frame of 30fps @ 1471 frames`,
  );
});

test("verify.fps still fails the real v1 numbers (genuine 3-frame loss, pre-fps-grid-snap render)", () => {
  // v1: measured fps 29.9388 against a 1470-frame-shaped plan (3 real frames short, docs/
  // task.md's own table). This must keep failing -- the whole point of a 1-frame (not 3-frame)
  // tolerance is to not let this regress into a false pass.
  assert.equal(
    fpsWithinOneFrameTolerance(29.9388, 30, 1470),
    false,
    "a genuine 3-frame-equivalent drop must still fail verify.fps",
  );
});

test("boundary: exactly 1 frame short passes, exactly 2 frames short fails", () => {
  const expectedFps = 30;
  const expectedFrameCount = 100;
  const oneFrameShort = expectedFps * (expectedFrameCount - 1) / expectedFrameCount; // 29.7
  const twoFramesShort = expectedFps * (expectedFrameCount - 2) / expectedFrameCount; // 29.4
  assert.ok(fpsWithinOneFrameTolerance(oneFrameShort, expectedFps, expectedFrameCount));
  assert.equal(fpsWithinOneFrameTolerance(twoFramesShort, expectedFps, expectedFrameCount), false);
});

test("boundary is symmetric: 1 frame over nominal also passes, 2 frames over fails", () => {
  const expectedFps = 30;
  const expectedFrameCount = 100;
  const oneFrameOver = expectedFps * (expectedFrameCount + 1) / expectedFrameCount; // 30.3
  const twoFramesOver = expectedFps * (expectedFrameCount + 2) / expectedFrameCount; // 30.6
  assert.ok(fpsWithinOneFrameTolerance(oneFrameOver, expectedFps, expectedFrameCount));
  assert.equal(fpsWithinOneFrameTolerance(twoFramesOver, expectedFps, expectedFrameCount), false);
});

test("a non-finite actual fps always fails, regardless of tolerance", () => {
  assert.equal(fpsWithinOneFrameTolerance(Number.NaN, 30, 1471), false);
  assert.equal(fpsWithinOneFrameTolerance(Number.POSITIVE_INFINITY, 30, 1471), false);
});

test("an exact match always passes, even with zero expected frames", () => {
  assert.ok(fpsWithinOneFrameTolerance(30, 30, 0));
  assert.equal(fpsWithinOneFrameTolerance(29.9, 30, 0), false, "with 0 expected frames the tolerance is 0 -- any drift fails");
});
