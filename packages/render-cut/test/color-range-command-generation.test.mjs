import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildTailPadCommand } from "../src/content-duration.mjs";
import { buildLayersCompositeCommand } from "../src/layers.mjs";
import { buildPlan } from "../src/plan.mjs";
import { compositeAnimatedOverlay, compositeStaticOverlays } from "../src/rasterize.mjs";
import { buildCutTrackCompositeCommand, buildTrackBaseCommand } from "../src/track-compose.mjs";

const baseCapabilities = {
  sourceDuration: 4,
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: "ffprobe",
  chromePath: "chrome",
  hyperframesAvailable: true,
  puppeteerAvailable: true,
};

function assertTvEncode(command, label) {
  const joined = command.args.join(" ");
  assert.match(joined, /scale=out_range=tv/u, `${label}: missing value normalization`);
  assert.match(joined, /-color_range tv/u, `${label}: missing metadata tag`);
}

test("cut builders and planned composite twins normalize values and tag every H.264 output as tv range", () => {
  const common = {
    version: 0,
    output: { width: 320, height: 180, fps: 10 },
    source: { path: "source.mp4", proxy: null },
    overlays: [],
  };
  const single = buildPlan({
    edit: { ...common, cuts: [{ in: 0, out: 1 }] },
    projectRoot: "/project",
    outputPath: "/project/exports/single.mp4",
    capabilities: baseCapabilities,
    hasSourceAudio: true,
  });
  assert.equal(single.preset.color_range, "tv");
  assertTvEncode(single.commands.cut, "buildCutCommand");
  assertTvEncode(single.commands.composite.hyperframes, "buildAnimatedCompositeCommand");
  assertTvEncode(single.commands.composite["static-screenshot"], "buildStaticCompositeCommand");

  const gapAware = buildPlan({
    edit: {
      ...common,
      cuts: [
        { in: 0, out: 1, at: 0, track: 0 },
        { in: 1, out: 2, at: 2, track: 0 },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/gap.mp4",
    capabilities: baseCapabilities,
    hasSourceAudio: true,
  });
  assertTvEncode(gapAware.commands.cut, "buildGapAwareCutCommand");

  const multi = buildPlan({
    edit: {
      version: 1,
      output: { width: 320, height: 180, fps: 10 },
      sources: [
        { id: "pc", path: "pc.mp4", proxy: null },
        { id: "tv", path: "tv.mp4", proxy: null },
      ],
      cuts: [
        { src: "pc", in: 0, out: 1 },
        { src: "tv", in: 0, out: 1 },
      ],
      overlays: [],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/multi.mp4",
    capabilities: {
      ...baseCapabilities,
      sourceInputs: [
        { id: "pc", path: "/project/pc.mp4", hasAudio: true },
        { id: "tv", path: "/project/tv.mp4", hasAudio: true },
      ],
    },
    hasSourceAudio: true,
  });
  assertTvEncode(multi.commands.cut, "buildMultiSourceCutCommand");
  const multiFilter = multi.commands.cut.args[multi.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.match(multiFilter, /\[vrange0\]scale=out_range=tv\[v0\]/u);
  assert.match(multiFilter, /\[vrange1\]scale=out_range=tv\[v1\]/u);
  assert.ok(
    multiFilter.indexOf("[vrange1]scale=out_range=tv[v1]") < multiFilter.indexOf("concat=n=2"),
    "each source must be normalized before concat",
  );
});

test("tail pad, track stack, and layers commands normalize values and tag H.264 output as tv range", () => {
  const commands = [
    ["tail_pad", buildTailPadCommand({
      ffmpegCommand: "ffmpeg",
      inputPath: "/project/cut.mp4",
      outputPath: "/project/tail.mp4",
      cutsEndSeconds: 1,
      finalDurationSeconds: 2,
    })],
    ["track_base", buildTrackBaseCommand({
      ffmpegCommand: "ffmpeg",
      inputPath: "/project/cut.mp4",
      outputPath: "/project/base.mp4",
      duration: 2,
      width: 320,
      height: 180,
      fps: 10,
    })],
    ["track_composite", buildCutTrackCompositeCommand({
      ffmpegCommand: "ffmpeg",
      inputPath: "/project/base.mp4",
      trackPath: "/project/track.mp4",
      outputPath: "/project/stacked.mp4",
      ranges: [{ inputStart: 0, outputStart: 0, outputEnd: 1 }],
      duration: 2,
    })],
    ["layers", buildLayersCompositeCommand({
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      layers: [{ id: "layer", kind: "baked", src: "layer.mov", t: 0, duration: 1 }],
      projectRoot: "/project",
      inputPath: "/project/cut.mp4",
      outputPath: "/project/layered.mp4",
      duration: 2,
      width: 320,
      height: 180,
    })],
  ];
  for (const [label, command] of commands) assertTvEncode(command, label);
});

test("rasterize execution commands normalize values and tag animated/static composites as tv range", async () => {
  const directory = await mkdtemp(join(tmpdir(), "render-cut-color-range-command-"));
  try {
    const logPath = join(directory, "args.jsonl");
    const recorderPath = join(directory, "ffmpeg-recorder.mjs");
    await writeFile(recorderPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.AKARI_COLOR_RANGE_COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`);
    await chmod(recorderPath, 0o755);
    const previous = process.env.AKARI_COLOR_RANGE_COMMAND_LOG;
    process.env.AKARI_COLOR_RANGE_COMMAND_LOG = logPath;
    try {
      await compositeAnimatedOverlay({
        ffmpegCommand: recorderPath,
        cutPath: join(directory, "cut.mp4"),
        overlayPath: join(directory, "overlay.mov"),
        outputPath: join(directory, "animated.mp4"),
        hasAudio: true,
      });
      await compositeStaticOverlays({
        ffmpegCommand: recorderPath,
        cutPath: join(directory, "cut.mp4"),
        captures: [{ path: join(directory, "still.png"), start: 0, duration: 1 }],
        outputPath: join(directory, "static.mp4"),
        hasAudio: true,
        duration: 1,
      });
    } finally {
      if (previous === undefined) delete process.env.AKARI_COLOR_RANGE_COMMAND_LOG;
      else process.env.AKARI_COLOR_RANGE_COMMAND_LOG = previous;
    }
    const invocations = (await readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(invocations.length, 2);
    for (const [index, args] of invocations.entries()) {
      assertTvEncode({ args }, index === 0 ? "animated composite" : "static composite");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
