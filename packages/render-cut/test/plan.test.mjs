import assert from "node:assert/strict";
import test from "node:test";

import { buildAudioMixCommand, buildPlan, predictedDuration, selectDefaultOutput } from "../src/plan.mjs";

const edit = {
  version: 0,
  output: { width: 1280, height: 720, fps: 30 },
  source: { path: "source.mp4", proxy: "proxy.mp4" },
  cuts: [
    { in: 5, out: 10 },
    { in: 30, out: 35 },
  ],
  overlays: [],
};

const capabilities = {
  sourceDuration: 60,
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: "ffprobe",
  chromePath: "chrome",
  hyperframesAvailable: true,
  puppeteerAvailable: true,
};

test("the same input produces the same command plan from the original source", () => {
  const input = {
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  };
  const first = buildPlan(input);
  const second = buildPlan(input);
  assert.deepEqual(second.commands, first.commands);
  assert.equal(first.predicted_duration_seconds, 10);
  assert.ok(first.commands.cut.args.includes("/project/source.mp4"));
  assert.ok(!first.commands.cut.args.includes("/project/proxy.mp4"));
  assert.match(first.commands.cut.args.join(" "), /trim=start=5:end=10/);
  assert.match(first.commands.cut.args.join(" "), /concat=n=2:v=1:a=1/);
  assert.equal(first.rasterizer.selected, "hyperframes");
});

test("default output names are numbered rather than overwritten", () => {
  const existing = new Set(["/project/exports/source.mp4", "/project/exports/source-2.mp4"]);
  assert.equal(
    selectDefaultOutput("/project", edit, (path) => existing.has(path)),
    "/project/exports/source-3.mp4",
  );
});

test("3D plans require puppeteer-core and do not advertise still-image fallback", () => {
  const plan = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    hasThreeDimensionalOverlay: true,
  });
  assert.equal(plan.rasterizer.selected, "puppeteer-core");
  assert.deepEqual(plan.rasterizer.order, ["puppeteer-core"]);
});

test("BGM and SFX produce a deterministic direct ffmpeg mix command", () => {
  const command = buildAudioMixCommand({
    edit: {
      ...edit,
      audio: {
        bgm: { path: "audio/bgm.wav", gain_db: -18, ducking: true },
        sfx: [{ path: "audio/pop.wav", t: 1.25, gain_db: -6 }],
      },
    },
    projectRoot: "/project",
    inputPath: "/project/.akari/render-tmp/composite.mp4",
    outputPath: "/project/.akari/render-tmp/final.mp4",
    duration: 10,
    ffmpegCommand: "ffmpeg",
  });
  assert.equal(command.operation, "ffmpeg");
  assert.ok(command.args.includes("/project/audio/bgm.wav"));
  assert.ok(command.args.includes("/project/audio/pop.wav"));
  assert.match(command.args.join(" "), /volume=-18dB/);
  assert.match(command.args.join(" "), /adelay=1250:all=1/);
  assert.match(command.args.join(" "), /amix=inputs=3:duration=first/);
});

test("cuts without at or track keep the exact legacy cut command", () => {
  const plan = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });
  assert.deepEqual(plan.commands.cut.args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    "/project/source.mp4",
    "-filter_complex",
    "[0:v]trim=start=5:end=10,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=5:end=10,asetpts=PTS-STARTPTS[a0];[0:v]trim=start=30:end=35,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=30:end=35,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[joinedv][joineda];[joinedv]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[outv];[outv]scale=out_range=tv[outv_tv]",
    "-map",
    "[outv_tv]",
    "-map",
    "[joineda]",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-color_range",
    "tv",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-shortest",
    "/project/.akari/render-tmp/cut.mp4",
  ]);
});

test("cuts with an output-axis gap render black video for the gap", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      cuts: [
        { in: 0, out: 2, track: 0 },
        { at: 5, in: 10, out: 12, track: 0 },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });
  const filterComplex = plan.commands.cut.args[plan.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.equal(plan.predicted_duration_seconds, 7);
  assert.match(filterComplex, /color=c=black/);
  assert.match(filterComplex, /color=c=black[^;]*:d=3\[gv1\]/);
});

test("overlapping tracks show the higher track and mix every cut's audio", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      cuts: [
        { in: 0, out: 5, track: 0 },
        { at: 2, in: 20, out: 25, track: 1 },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });
  const filterComplex = plan.commands.cut.args[plan.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /trim=start=20:end=25/);
  assert.match(filterComplex, /adelay=0:all=1/);
  assert.match(filterComplex, /adelay=2000:all=1/);
  assert.match(filterComplex, /amix=inputs=2/);
});

test("content beyond the cuts extends predicted duration and inserts tail padding", () => {
  const plan = buildPlan({
    edit: {
      ...edit,
      layers: [
        {
          id: "late-layer",
          kind: "baked",
          src: "layers/late.mov",
          t: 9,
          duration: 4,
        },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });
  assert.equal(plan.predicted_duration_seconds, 13);
  assert.notEqual(plan.commands.tail_pad, null);
  assert.match(plan.commands.tail_pad.args.join(" "), /stop_duration=3:color=black/);
  assert.match(plan.commands.tail_pad.args.join(" "), /apad=whole_dur=13/);
  assert.ok(plan.commands.layers.args.includes("/project/.akari/render-tmp/cut-tail-padded.mp4"));
  assert.ok(plan.intermediates.includes(".akari/render-tmp/cut-tail-padded.mp4"));
});

test("task 2026-07-25-export-options backward-compat guard: omitting quality/encoder/fpsOverride reproduces the exact pre-feature ffmpeg command line (regression)", () => {
  const plan = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });
  assert.deepEqual(plan.commands.cut.args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    "/project/source.mp4",
    "-filter_complex",
    "[0:v]trim=start=5:end=10,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=5:end=10,asetpts=PTS-STARTPTS[a0];[0:v]trim=start=30:end=35,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=30:end=35,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[joinedv][joineda];[joinedv]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[outv];[outv]scale=out_range=tv[outv_tv]",
    "-map",
    "[outv_tv]",
    "-map",
    "[joineda]",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-color_range",
    "tv",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-shortest",
    "/project/.akari/render-tmp/cut.mp4",
  ]);
  assert.deepEqual(plan.commands.composite.hyperframes.args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    "/project/.akari/render-tmp/cut.mp4",
    "-i",
    "/project/.akari/render-tmp/overlay.mov",
    "-filter_complex",
    "[0:v][1:v]overlay=0:0:format=auto:shortest=1[composited];[composited]scale=out_range=tv[outv]",
    "-map",
    "[outv]",
    "-map",
    "0:a:0",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-color_range",
    "tv",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "/project/.akari/render-tmp/composite.mp4",
  ]);
  assert.equal(plan.preset.fps, 30);
});

test("quality/encoder/fpsOverride: passing them explicitly is a new command line, not the backward-compat default path", () => {
  const baseline = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });

  const high = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    quality: "high",
  });
  assert.notDeepEqual(high.commands.cut.args, baseline.commands.cut.args);
  assert.ok(high.commands.cut.args.includes("-crf"));
  assert.equal(high.commands.cut.args[high.commands.cut.args.indexOf("-crf") + 1], "18");
  assert.equal(high.commands.cut.args[high.commands.cut.args.indexOf("-preset") + 1], "slow");
  assert.equal(high.commands.cut.args[high.commands.cut.args.indexOf("-x264-params") + 1], "keyint=1");
  // Only the trailing encode-args segment changes; the filter_complex (the actual cut/concat/scale
  // work) is untouched by a quality change.
  assert.equal(
    high.commands.cut.args[high.commands.cut.args.indexOf("-filter_complex") + 1],
    baseline.commands.cut.args[baseline.commands.cut.args.indexOf("-filter_complex") + 1],
  );
  // The overlay composite step gets the exact same tuning (intermediate never coarser than final).
  assert.equal(high.commands.composite.hyperframes.args[high.commands.composite.hyperframes.args.indexOf("-crf") + 1], "18");

  const light = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    quality: "light",
  });
  assert.equal(light.commands.cut.args[light.commands.cut.args.indexOf("-crf") + 1], "26");

  const forcedVideotoolbox = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    encoder: "videotoolbox",
  });
  assert.equal(forcedVideotoolbox.commands.cut.args[forcedVideotoolbox.commands.cut.args.indexOf("-c:v") + 1], "h264_videotoolbox");
  assert.ok(forcedVideotoolbox.commands.cut.args.includes("-b:v"));
  assert.ok(!forcedVideotoolbox.commands.cut.args.includes("-crf"));
  assert.ok(!forcedVideotoolbox.commands.cut.args.includes("-x264-params"));

  const forcedX264 = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    encoder: "x264",
  });
  assert.equal(forcedX264.commands.cut.args[forcedX264.commands.cut.args.indexOf("-c:v") + 1], "libx264");
  assert.equal(forcedX264.commands.cut.args[forcedX264.commands.cut.args.indexOf("-x264-params") + 1], "keyint=1");

  const fpsOverridden = buildPlan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    fpsOverride: 24,
  });
  assert.equal(fpsOverridden.preset.fps, 24);
  assert.match(fpsOverridden.commands.cut.args[fpsOverridden.commands.cut.args.indexOf("-filter_complex") + 1], /fps=24/);
  assert.equal(fpsOverridden.predicted_duration_seconds, baseline.predicted_duration_seconds);
});

test("v2 rejects an fps override that bypasses retime, while the declared fps is accepted", () => {
  const internalEdit = { output: { fps: 30 }, sources: [], tracks: [], sourceTableDeclared: true };
  assert.throws(() => buildPlan({
    edit,
    internalEdit,
    sourceVersion: 2,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    fpsOverride: 24,
  }), /retime（全体再スケール）/);

  const plan = buildPlan({
    edit,
    internalEdit,
    sourceVersion: 2,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    fpsOverride: 30,
  });
  assert.equal(plan.preset.fps, 30);
});

test("content within the cuts skips tail padding and preserves every existing command", () => {
  const input = {
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  };
  const baseline = buildPlan(input);
  const withinCuts = buildPlan({
    ...input,
    captionOverlays: [{ start: 2, duration: 3 }],
  });
  assert.equal(withinCuts.predicted_duration_seconds, 10);
  assert.equal(withinCuts.commands.tail_pad, null);
  assert.deepEqual(withinCuts.commands, baseline.commands);
  assert.deepEqual(withinCuts.intermediates, baseline.intermediates);
});

// docs/contract-2026-08-18-v1-render-parity.md: v1's counterpart to the v0 gap-aware tests above
// (buildPlan's v1 branch now dispatches on needsGapAwareCutTimeline exactly like v0's buildCutCommand).
const v1Edit = {
  version: 1,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [
    { id: "a", path: "a.mp4", proxy: null },
    { id: "b", path: "b.mp4", proxy: null },
  ],
  cuts: [
    { src: "a", in: 5, out: 10 },
    { src: "b", in: 0, out: 5 },
  ],
  overlays: [],
};

const v1Capabilities = {
  sourceInputs: [
    { id: "a", path: "/project/a.mp4", hasAudio: true },
    { id: "b", path: "/project/b.mp4", hasAudio: true },
  ],
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: "ffprobe",
  chromePath: "chrome",
  hyperframesAvailable: true,
  puppeteerAvailable: true,
};

test("v1: cuts without at or track keep the exact legacy multi-source concat command (non-regression)", () => {
  const plan = buildPlan({
    edit: v1Edit,
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: v1Capabilities,
    hasSourceAudio: true,
  });
  const filterComplex = plan.commands.cut.args[plan.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /concat=n=2:v=1:a=1\[joinedv\]\[joineda\]/);
  assert.ok(!filterComplex.includes("color=c=black"));
  assert.ok(!filterComplex.includes("[gv1_"));
});

test("v1: cuts with an output-axis gap render black video for the gap", () => {
  const plan = buildPlan({
    edit: {
      ...v1Edit,
      cuts: [
        { src: "a", in: 0, out: 2, track: 0 },
        { src: "b", at: 5, in: 0, out: 2, track: 0 },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: v1Capabilities,
    hasSourceAudio: true,
  });
  const filterComplex = plan.commands.cut.args[plan.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.equal(plan.predicted_duration_seconds, 7);
  assert.match(filterComplex, /color=c=black/);
  assert.match(filterComplex, /color=c=black[^;]*:d=3\[gv1_1\]/);
});

test("v1: overlapping tracks show the higher track and mix every cut's audio", () => {
  const plan = buildPlan({
    edit: {
      ...v1Edit,
      cuts: [
        { src: "a", in: 0, out: 5, track: 0 },
        { src: "b", at: 2, in: 20, out: 25, track: 1 },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: v1Capabilities,
    hasSourceAudio: true,
  });
  const filterComplex = plan.commands.cut.args[plan.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /trim=start=20:end=25/);
  assert.match(filterComplex, /adelay=0:all=1/);
  assert.match(filterComplex, /adelay=2000:all=1/);
  assert.match(filterComplex, /amix=inputs=2/);
});

test("v1: a custom timeline.tracks order still routes through buildTrackStackPlan, unaffected by the new gap-aware dispatch", () => {
  const plan = buildPlan({
    edit: {
      ...v1Edit,
      cuts: [
        { src: "a", in: 0, out: 2, track: 0 },
        { src: "b", at: 0.5, in: 0, out: 1, track: 1 },
      ],
      timeline: { tracks: [{ id: "c1", kind: "cuts", ref: 1 }, { id: "c0", kind: "cuts", ref: 0 }] },
    },
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: v1Capabilities,
    hasSourceAudio: true,
  });
  assert.ok(plan.commands.track_stack, "expected the track-stack path, not the top-level gap-aware dispatch");
  assert.equal(plan.commands.track_stack.cutTracks.length, 2);
});

test("predictedDuration accounts for at/track gaps for both v0 and v1 instead of a plain segment sum", () => {
  const cuts = [
    { in: 0, out: 2, track: 0 },
    { at: 5, in: 0, out: 2, track: 0 },
  ];
  assert.equal(predictedDuration(cuts, null, 0), 7);
  assert.equal(predictedDuration(cuts, null, 1), 7);
  // Non-gap-aware v1 (no at/track) keeps its own existing transition-overlap-aware formula.
  const sequential = [{ in: 0, out: 2 }, { in: 0, out: 3 }];
  assert.equal(predictedDuration(sequential, null, 1), 5);
});
