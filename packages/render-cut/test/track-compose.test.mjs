import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { buildPlan } from "../src/plan.mjs";
import { renderProject } from "../src/render-cut.mjs";
import { buildTailPadCommand } from "../src/content-duration.mjs";
import { buildVideoEncodeArgs } from "../src/encode-preset.mjs";
import { compositeAnimatedOverlay, compositeStaticOverlays, runChecked } from "../src/rasterize.mjs";
import {
  buildCutTrackCompositeCommand,
  buildTrackBaseCommand,
  resolveCutTrackRanges,
} from "../src/track-compose.mjs";
import { usesDefaultTrackOrder } from "../src/track-order.mjs";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const edit = {
  version: 1,
  output: { width: 96, height: 54, fps: 10 },
  sources: [
    { id: "green", path: "green.mp4", proxy: null },
    { id: "blue", path: "blue.mp4", proxy: null },
  ],
  cuts: [
    { src: "green", in: 0, out: 1.5, at: 0, track: 0 },
    { src: "blue", in: 0, out: 0.75, at: 0.5, track: 1 },
  ],
  layers: [
    { id: "telop", t: 0.2, duration: 1, kind: "baked", src: "telop.mov", track: 0 },
  ],
  overlays: [],
};

test("default track order is structural and ignores timeline track metadata", () => {
  assert.equal(usesDefaultTrackOrder(edit), true);
  assert.equal(usesDefaultTrackOrder({
    ...edit,
    timeline: {
      tracks: [
        { id: "bottom", label: "A", kind: "cuts", ref: 0 },
        { id: "middle", hidden: false, kind: "cuts", ref: 1 },
        { id: "top", locked: true, kind: "layers", ref: 0 },
      ],
    },
  }), true);
  assert.equal(usesDefaultTrackOrder({
    ...edit,
    timeline: {
      tracks: [
        { id: "bottom", kind: "cuts", ref: 0 },
        { id: "middle", kind: "layers", ref: 0 },
        { id: "top", kind: "cuts", ref: 1 },
      ],
    },
  }), false);
});

test("v1 cut-track ranges align a concatenated track clip to its declared output windows", () => {
  assert.deepEqual(resolveCutTrackRanges([
    { src: "a", in: 0, out: 1, at: 1, track: 2 },
    { src: "a", in: 2, out: 3, at: 3, track: 2 },
  ], { version: 1 }), [
    { outputStart: 1, outputEnd: 2, inputStart: 0 },
    { outputStart: 3, outputEnd: 4, inputStart: 1 },
  ]);
});

test("an interleaved declaration plans per-track cuts and ordered cuts/layers stages", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      timeline: {
        tracks: [
          { id: "c0", kind: "cuts", ref: 0 },
          { id: "l0", kind: "layers", ref: 0 },
          { id: "c1", kind: "cuts", ref: 1 },
        ],
      },
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: {
      sourceInputs: [
        { id: "green", path: "/project/green.mp4", hasAudio: true },
        { id: "blue", path: "/project/blue.mp4", hasAudio: true },
      ],
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      chromePath: "chrome",
      hyperframesAvailable: false,
      puppeteerAvailable: false,
    },
    hasSourceAudio: true,
  });
  assert.equal(plan.commands.layers, null);
  assert.deepEqual(plan.commands.track_stack.stages.map(({ kind, ref }) => ({ kind, ref })), [
    { kind: "cuts", ref: 0 },
    { kind: "layers", ref: 0 },
    { kind: "cuts", ref: 1 },
  ]);
  assert.equal(plan.commands.track_stack.cutTracks.length, 2);
  assert.match(plan.commands.track_stack.outputPath, /layered\.mp4$/u);
});

test("custom track order includes overlays and captions in the same bottom-to-top stage plan", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      overlays: [{ id: "title", html: "title.html", start: 0, duration: 1, track: 2 }],
      timeline: {
        tracks: [
          { id: "captions", kind: "captions" },
          { id: "c0", kind: "cuts", ref: 0 },
          { id: "overlay2", kind: "overlays", ref: 2 },
          { id: "l0", kind: "layers", ref: 0 },
          { id: "c1", kind: "cuts", ref: 1 },
        ],
      },
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: {
      sourceInputs: [
        { id: "green", path: "/project/green.mp4", hasAudio: true },
        { id: "blue", path: "/project/blue.mp4", hasAudio: true },
      ],
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      chromePath: "chrome",
      hyperframesAvailable: false,
      puppeteerAvailable: false,
    },
    hasSourceAudio: true,
    captionOverlays: [{ id: "caption-01", start: 0, duration: 1 }],
  });
  assert.deepEqual(plan.commands.track_stack.stages.map(({ kind, ref }) => ({ kind, ref })), [
    { kind: "captions", ref: null },
    { kind: "cuts", ref: 0 },
    { kind: "overlays", ref: 2 },
    { kind: "layers", ref: 0 },
    { kind: "cuts", ref: 1 },
  ]);
  assert.deepEqual(
    plan.commands.track_stack.stages.filter(stage => stage.command === null)
      .map(({ kind, overlayIds }) => ({ kind, overlayIds })),
    [
      { kind: "captions", overlayIds: ["caption-01"] },
      { kind: "overlays", overlayIds: ["title"] },
    ],
  );
});

// task 2026-08-07-track-transition-lint-guard: defensive backstop for direct render-cut
// invocations that skip edit-lint (whose cuts.track-transition-unsupported check is the primary
// guard). See task #14 for the real-render evidence this rejects: gap-aware track compositing
// splits an xfade-blended pair of same-track cuts into two separate, non-overlapping composite
// windows, and the second window points past where the actually-shrunk clip's content ends --
// verified to show the base track's background visibly leaking through early.
test("buildPlan rejects transition_out on a track composited through a non-default timeline.tracks order", () => {
  assert.throws(
    () => buildPlan({
      edit: {
        ...edit,
        cuts: [
          { src: "green", in: 0, out: 1, track: 1, transition_out: { type: "dissolve", duration: 0.2 } },
          { src: "green", in: 1, out: 2, track: 1 },
          { src: "blue", in: 0, out: 1, track: 0 },
        ],
        timeline: {
          tracks: [
            { id: "c1", kind: "cuts", ref: 1 },
            { id: "c0", kind: "cuts", ref: 0 },
          ],
        },
      },
      projectRoot: "/project",
      outputPath: "/project/exports/out.mp4",
      capabilities: {
        sourceInputs: [
          { id: "green", path: "/project/green.mp4", hasAudio: true },
          { id: "blue", path: "/project/blue.mp4", hasAudio: true },
        ],
        ffmpegCommand: "ffmpeg",
        ffprobeCommand: "ffprobe",
        chromePath: "chrome",
        hyperframesAvailable: false,
        puppeteerAvailable: false,
      },
      hasSourceAudio: true,
    }),
    /gap-aware track engine/,
  );
});

test("buildPlan allows transition_out on the LAST cut of a gap-aware track (no-op, matches predictedDuration's overlap accounting)", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      cuts: [
        { src: "green", in: 0, out: 1, track: 1 },
        { src: "green", in: 1, out: 2, track: 1, transition_out: { type: "dissolve", duration: 0.2 } },
        { src: "blue", in: 0, out: 1, track: 0 },
      ],
      timeline: {
        tracks: [
          { id: "c1", kind: "cuts", ref: 1 },
          { id: "c0", kind: "cuts", ref: 0 },
        ],
      },
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: {
      sourceInputs: [
        { id: "green", path: "/project/green.mp4", hasAudio: true },
        { id: "blue", path: "/project/blue.mp4", hasAudio: true },
      ],
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      chromePath: "chrome",
      hyperframesAvailable: false,
      puppeteerAvailable: false,
    },
    hasSourceAudio: true,
  });
  assert.ok(plan.commands.track_stack, "expected the track-stack path to still build a plan");
});

test("master policy reaches every video encode stage while audio-only mux is explicitly copy", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      output: { ...edit.output, encoding: { quality: "master" } },
      audio: { master: {} },
      layers: [{ ...edit.layers[0], t: 1, duration: 1 }],
      timeline: {
        tracks: [
          { id: "c0", kind: "cuts", ref: 0 },
          { id: "l0", kind: "layers", ref: 0 },
          { id: "c1", kind: "cuts", ref: 1 },
        ],
      },
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: {
      sourceInputs: [
        { id: "green", path: "/project/green.mp4", hasAudio: true },
        { id: "blue", path: "/project/blue.mp4", hasAudio: true },
      ],
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      chromePath: "chrome",
      hyperframesAvailable: false,
      puppeteerAvailable: false,
    },
    hasSourceAudio: true,
  });
  const commands = [
    plan.commands.cut,
    plan.commands.tail_pad,
    ...Object.values(plan.commands.composite),
    plan.commands.track_stack.base,
    ...plan.commands.track_stack.cutTracks.map(track => track.command),
    ...plan.commands.track_stack.stages.map(stage => stage.command),
  ].filter(command => command?.args);
  assert.ok(commands.length >= 10, `expected broad stage coverage, got ${commands.length}`);
  for (const command of commands) {
    const joined = command.args.join(" ");
    assert.match(joined, /-c:v libx264/u);
    assert.match(joined, /-profile:v high/u);
    assert.match(joined, /-preset slow/u);
    assert.match(joined, /-crf 15/u);
  }
  assert.deepEqual(plan.encoding.effective, {
    quality: { value: "master", origin: "edit" },
    encoder: { value: "x264", origin: "master-required" },
  });
  assert.deepEqual(plan.encoding.non_encoding_stages, [
    {
      stage: "overlay_alpha_intermediate",
      reason: "qtrle/ProRes 4444 carries transparency into composite and is not an H.264 delivery-video reencode",
    },
    {
      stage: "audio_mix",
      reason: "audio-only mix/mux preserves the already encoded video with -c:v copy",
    },
  ]);
  assert.match(plan.commands.audio_mix.args.join(" "), /-c:v copy/u);
});

test("tail, animated overlay, and static overlay execution boundaries issue the master x264 policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "render-cut-master-stage-recorder-"));
  try {
    const logPath = join(directory, "ffmpeg-stage-execution.jsonl");
    const wrapper = join(directory, "ffmpeg-stage-recorder.mjs");
    await writeFile(wrapper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.AKARI_FFMPEG_STAGE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`);
    await chmod(wrapper, 0o755);
    const previous = process.env.AKARI_FFMPEG_STAGE_LOG;
    process.env.AKARI_FFMPEG_STAGE_LOG = logPath;
    try {
      const videoEncodeArgs = buildVideoEncodeArgs({
        quality: "master",
        encoderChoice: { engine: "x264" },
        profile: "high",
      });
      const tail = buildTailPadCommand({
        ffmpegCommand: wrapper,
        inputPath: join(directory, "cut.mp4"),
        outputPath: join(directory, "tail-padded.mp4"),
        cutsEndSeconds: 1,
        finalDurationSeconds: 2,
        videoEncodeArgs,
      });
      runChecked(tail.command, tail.args);
      await compositeAnimatedOverlay({
        ffmpegCommand: wrapper,
        cutPath: join(directory, "tail-padded.mp4"),
        overlayPath: join(directory, "overlay.mov"),
        outputPath: join(directory, "animated-composite.mp4"),
        hasAudio: true,
        videoEncodeArgs,
      });
      await compositeStaticOverlays({
        ffmpegCommand: wrapper,
        cutPath: join(directory, "tail-padded.mp4"),
        captures: [{ path: join(directory, "static.png"), start: 0, duration: 2 }],
        outputPath: join(directory, "static-composite.mp4"),
        hasAudio: true,
        duration: 2,
        videoEncodeArgs,
      });
    } finally {
      if (previous === undefined) delete process.env.AKARI_FFMPEG_STAGE_LOG;
      else process.env.AKARI_FFMPEG_STAGE_LOG = previous;
    }
    const invocations = (await readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(invocations.map(args => basename(args.at(-1))), [
      "tail-padded.mp4",
      "animated-composite.mp4",
      "static-composite.mp4",
    ]);
    for (const args of invocations) {
      assert.deepEqual(executedEncoding(args), {
        codec: "libx264", profile: "high", preset: "slow", crf: "15",
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real master render records identical encoding policy at every executed video FFmpeg boundary", async (t) => {
  const ffmpegPath = spawnSync("which", ["ffmpeg"], { encoding: "utf8" }).stdout.trim();
  if (!ffmpegPath || !existsSync(chromePath)) return t.skip("ffmpeg or Chrome unavailable");
  const project = await mkdtemp(join(tmpdir(), "render-cut-master-execution-test-"));
  try {
    await mkdir(join(project, ".akari"));
    await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    makeColorSource(join(project, "green.mp4"), "green", 220, 1.5);
    makeColorSource(join(project, "blue.mp4"), "blue", 660, 1);
    makeLayer(join(project, "telop.mov"));
    await writeFile(join(project, "edit.json"), `${JSON.stringify({
      ...edit,
      output: { ...edit.output, encoding: { quality: "master" } },
      audio: { master: { denoise: "off", loudnorm: -14, true_peak_dbtp: -1.7 } },
      timeline: { tracks: [
        { id: "c0", kind: "cuts", ref: 0 },
        { id: "l0", kind: "layers", ref: 0 },
        { id: "c1", kind: "cuts", ref: 1 },
      ] },
    }, null, 2)}\n`);
    const logPath = join(project, "ffmpeg-execution.jsonl");
    const wrapper = join(project, "ffmpeg-recorder.mjs");
    await writeFile(wrapper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(process.env.AKARI_FFMPEG_LOG, JSON.stringify(args) + "\\n");
const result = spawnSync(${JSON.stringify(ffmpegPath)}, args, { stdio: "inherit" });
process.exit(result.status ?? 2);
`);
    await chmod(wrapper, 0o755);
    const previousFfmpeg = process.env.FFMPEG;
    const previousLog = process.env.AKARI_FFMPEG_LOG;
    const previousChrome = process.env.CHROME_PATH;
    process.env.FFMPEG = wrapper;
    process.env.AKARI_FFMPEG_LOG = logPath;
    process.env.CHROME_PATH = chromePath;
    let state;
    try {
      state = await renderProject(project);
    } finally {
      if (previousFfmpeg === undefined) delete process.env.FFMPEG; else process.env.FFMPEG = previousFfmpeg;
      if (previousLog === undefined) delete process.env.AKARI_FFMPEG_LOG; else process.env.AKARI_FFMPEG_LOG = previousLog;
      if (previousChrome === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = previousChrome;
    }
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const invocations = (await readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
    const videoEncodes = invocations.filter(args => {
      const codecIndex = args.lastIndexOf("-c:v");
      return codecIndex !== -1 && args[codecIndex + 1] !== "copy";
    });
    const outputs = videoEncodes.map(args => basename(args.at(-1)));
    assert.ok(outputs.includes("cut.mp4"), JSON.stringify(outputs));
    assert.ok(outputs.includes("track-base.mp4"), JSON.stringify(outputs));
    assert.ok(outputs.some(value => value.startsWith("cut-track-")), JSON.stringify(outputs));
    assert.ok(outputs.some(value => value.startsWith("track-stage-") || value === "layered.mp4"), JSON.stringify(outputs));
    assert.ok(videoEncodes.length >= 7, `captured video stages: ${JSON.stringify(outputs)}`);
    for (const args of videoEncodes) {
      assert.deepEqual(executedEncoding(args), { codec: "libx264", profile: "high", preset: "slow", crf: "15" });
    }
    assert.deepEqual(state.plan.encoding.effective, {
      quality: { value: "master", origin: "edit" },
      encoder: { value: "x264", origin: "master-required" },
    });
    t.diagnostic(`captured real FFmpeg video stages (${videoEncodes.length}): ${outputs.join(", ")}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("real render follows interleaved cuts/layers z order in both directions", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0 || !existsSync(chromePath)) {
    return t.skip("ffmpeg or Chrome unavailable");
  }
  const frontCut = await renderFixture(["cuts0", "layers0", "cuts1"]);
  const frontLayer = await renderFixture(["cuts0", "cuts1", "layers0"]);
  try {
    assertColor(sampleCenter(frontCut.outputPath, 0.8), "blue");
    assertColor(sampleCenter(frontLayer.outputPath, 0.8), "yellow");
    assertColor(sampleCenter(frontCut.outputPath, 0.1), "green");
    assertColor(sampleCenter(frontLayer.outputPath, 0.1), "green");
  } finally {
    await rm(frontCut.project, { recursive: true, force: true });
    await rm(frontLayer.project, { recursive: true, force: true });
  }
});

test("default and explicitly-derived track orders remain byte-equivalent", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0 || !existsSync(chromePath)) {
    return t.skip("ffmpeg or Chrome unavailable");
  }
  const implicit = await renderDefaultOrderFixture(false);
  const explicit = await renderDefaultOrderFixture(true);
  try {
    assert.deepEqual(await readFile(explicit.outputPath), await readFile(implicit.outputPath));
    assert.equal(implicit.state.plan.commands.track_stack, null);
    assert.equal(explicit.state.plan.commands.track_stack, null);
  } finally {
    await rm(implicit.project, { recursive: true, force: true });
    await rm(explicit.project, { recursive: true, force: true });
  }
});

test("real FFmpeg frames hide caption alpha when its track stage is below an opaque cut", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await mkdtemp(join(tmpdir(), "render-cut-caption-z-frame-test-"));
  try {
    const sourcePath = join(project, "green.mp4");
    const basePath = join(project, "base.mp4");
    const captionPath = join(project, "caption.mov");
    const belowCaptionPath = join(project, "caption-below.mp4");
    const belowOutputPath = join(project, "below.mp4");
    const aboveCutPath = join(project, "cut-below.mp4");
    const aboveOutputPath = join(project, "above.mp4");
    makeColorSource(sourcePath, "green", 220, 1.5);
    makeCaptionAlpha(captionPath);
    const base = buildTrackBaseCommand({
      ffmpegCommand: "ffmpeg", inputPath: sourcePath, outputPath: basePath,
      duration: 1.5, width: 96, height: 54, fps: 10,
    });
    runChecked(base.command, base.args);
    const cutRanges = [{ outputStart: 0, outputEnd: 1.5, inputStart: 0 }];
    await compositeAnimatedOverlay({
      ffmpegCommand: "ffmpeg", cutPath: basePath, overlayPath: captionPath,
      outputPath: belowCaptionPath, hasAudio: true,
    });
    const coverCaption = buildCutTrackCompositeCommand({
      ffmpegCommand: "ffmpeg", inputPath: belowCaptionPath, trackPath: sourcePath,
      outputPath: belowOutputPath, ranges: cutRanges, duration: 1.5,
    });
    runChecked(coverCaption.command, coverCaption.args);
    const cutBelow = buildCutTrackCompositeCommand({
      ffmpegCommand: "ffmpeg", inputPath: basePath, trackPath: sourcePath,
      outputPath: aboveCutPath, ranges: cutRanges, duration: 1.5,
    });
    runChecked(cutBelow.command, cutBelow.args);
    await compositeAnimatedOverlay({
      ffmpegCommand: "ffmpeg", cutPath: aboveCutPath, overlayPath: captionPath,
      outputPath: aboveOutputPath, hasAudio: true,
    });

    const belowWhitePixels = countNearWhitePixels(belowOutputPath, 0.8);
    const aboveWhitePixels = countNearWhitePixels(aboveOutputPath, 0.8);
    assert.ok(aboveWhitePixels > 10, `expected visible caption pixels, got ${aboveWhitePixels}`);
    assert.ok(
      belowWhitePixels < aboveWhitePixels / 4,
      `caption below cut must be occluded: below=${belowWhitePixels}, above=${aboveWhitePixels}`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function renderFixture(order) {
  const project = await mkdtemp(join(tmpdir(), "render-cut-track-compose-test-"));
  await mkdir(join(project, ".akari"));
  await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  makeColorSource(join(project, "green.mp4"), "green", 220, 1.5);
  makeColorSource(join(project, "blue.mp4"), "blue", 660, 1);
  makeLayer(join(project, "telop.mov"));
  const byKey = {
    cuts0: { id: "c0", kind: "cuts", ref: 0 },
    layers0: { id: "l0", kind: "layers", ref: 0 },
    cuts1: { id: "c1", kind: "cuts", ref: 1 },
  };
  await writeFile(join(project, "edit.json"), `${JSON.stringify({
    ...edit,
    timeline: { tracks: order.map(key => byKey[key]) },
  }, null, 2)}\n`);
  process.env.CHROME_PATH = chromePath;
  const state = await renderProject(project);
  assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
  return { project, outputPath: join(project, state.plan.output) };
}

async function renderDefaultOrderFixture(explicitTimeline) {
  const project = await mkdtemp(join(tmpdir(), "render-cut-default-z-byte-test-"));
  await mkdir(join(project, ".akari"));
  await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  makeColorSource(join(project, "green.mp4"), "green", 220, 1.5);
  await writeFile(join(project, "edit.json"), `${JSON.stringify({
    version: 1,
    output: { width: 96, height: 54, fps: 10 },
    sources: [{ id: "green", path: "green.mp4", proxy: null }],
    cuts: [{ src: "green", in: 0, out: 1.5, at: 0, track: 0 }],
    layers: [],
    overlays: [],
    ...(explicitTimeline ? { timeline: { tracks: [{ id: "c0", kind: "cuts", ref: 0 }] } } : {}),
  }, null, 2)}\n`);
  const previousChrome = process.env.CHROME_PATH;
  process.env.CHROME_PATH = chromePath;
  try {
    const state = await renderProject(project);
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    return { project, state, outputPath: join(project, state.plan.output) };
  } catch (error) {
    await rm(project, { recursive: true, force: true });
    throw error;
  } finally {
    if (previousChrome === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = previousChrome;
  }
}

function makeColorSource(path, color, frequency, duration) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=96x54:r=10:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function makeCaptionAlpha(path) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "nullsrc=s=96x54:r=10:d=1.5,format=rgba",
    "-vf", "geq=r=255:g=255:b=255:a='if(between(X,10,85)*between(Y,35,46),255,0)'",
    "-c:v", "qtrle", "-pix_fmt", "argb", path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function makeLayer(path) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=yellow:s=96x54:r=10:d=1",
    "-vf", "format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255'",
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function sampleCenter(path, time) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", path,
    "-vf", "crop=2:2:47:26,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

function countNearWhitePixels(path, time) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", path,
    "-vf", "format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  let count = 0;
  for (let offset = 0; offset + 2 < result.stdout.length; offset += 3) {
    if (result.stdout[offset] > 210 && result.stdout[offset + 1] > 210 && result.stdout[offset + 2] > 210) {
      count += 1;
    }
  }
  return count;
}

function assertColor({ r, g, b }, expected) {
  if (expected === "blue") assert.ok(b > 150 && r < 100 && g < 100, `rgb(${r},${g},${b})`);
  if (expected === "yellow") assert.ok(r > 180 && g > 180 && b < 100, `rgb(${r},${g},${b})`);
  if (expected === "green") assert.ok(g > 100 && r < 50 && b < 50, `rgb(${r},${g},${b})`);
}

function executedEncoding(args) {
  const valueAfter = flag => {
    const index = args.lastIndexOf(flag);
    return index === -1 ? null : args[index + 1];
  };
  return {
    codec: valueAfter("-c:v"),
    profile: valueAfter("-profile:v"),
    preset: valueAfter("-preset"),
    crf: valueAfter("-crf"),
  };
}
