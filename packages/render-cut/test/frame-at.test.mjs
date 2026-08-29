import assert from "node:assert/strict";
import test from "node:test";

import { insertFrameLimit } from "../src/frame-at.mjs";
import { buildAnimatedCompositeArgs } from "../src/plan.mjs";

test("renderFrameAt inserts the prefix frame limit immediately before the planned output", () => {
  assert.deepEqual(
    insertFrameLimit(["-i", "source.mp4", "-pix_fmt", "yuv420p", "cut.mp4"], 136),
    ["-i", "source.mp4", "-pix_fmt", "yuv420p", "-frames:v", "136", "cut.mp4"],
  );
});

test("capture and production share the animated overlay filter and yuv420p/tv path", () => {
  const args = buildAnimatedCompositeArgs({
    cutPath: "cut.mp4",
    overlayPath: "overlay.mov",
    outputPath: "out.mp4",
  });
  assert.equal(
    args[args.indexOf("-filter_complex") + 1],
    "[0:v][1:v]overlay=0:0:format=auto:shortest=1[composited];[composited]scale=out_range=tv[outv]",
  );
  assert.deepEqual(args.slice(args.indexOf("-pix_fmt"), args.indexOf("-pix_fmt") + 2), ["-pix_fmt", "yuv420p"]);
});
