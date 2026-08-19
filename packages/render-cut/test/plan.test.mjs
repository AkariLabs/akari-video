import assert from "node:assert/strict";
import test from "node:test";

import { buildAudioMixCommand, predictedDuration, selectDefaultOutput } from "../src/plan.mjs";
import { buildV2Plan, toRenderEdit } from "./helpers/v2-fixture.mjs";

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
  const first = buildV2Plan(input);
  const second = buildV2Plan(input);
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
    selectDefaultOutput("/project", toRenderEdit(edit), (path) => existing.has(path)),
    "/project/exports/source-3.mp4",
  );
});

test("3D plans require puppeteer-core and do not advertise still-image fallback", () => {
  const plan = buildV2Plan({
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

test("cuts without at or track use the deterministic v2 multi-source concat command", () => {
  const plan = buildV2Plan({ edit, projectRoot: "/project", outputPath: "/project/exports/source.mp4", capabilities, hasSourceAudio: true });
  const filter = plan.commands.cut.args[plan.commands.cut.args.indexOf("-filter_complex") + 1];
  assert.match(filter, /trim=start=5:end=10/);
  assert.match(filter, /trim=start=30:end=35/);
  assert.match(filter, /concat=n=2:v=1:a=1\[joinedv\]\[joineda\]/);
  assert.match(filter, /\[joinedv\]null\[outv_tv\]/);
});

test("cuts with an output-axis gap render black video for the gap", () => {
  const plan = buildV2Plan({
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
  assert.match(filterComplex, /color=c=black[^;]*:d=3\[gv1_1\]/);
});

test("overlapping tracks show the higher track and mix every cut's audio", () => {
  const plan = buildV2Plan({
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
  assert.ok(plan.commands.layers);
  assert.ok(plan.commands.layers.args.includes("/project/source.mp4"));
});

test("content beyond the cuts extends predicted duration and inserts tail padding", () => {
  const plan = buildV2Plan({
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

test("omitting quality and encoder keeps the deterministic default encode policy", () => {
  const first = buildV2Plan({ edit, projectRoot: "/project", outputPath: "/project/exports/source.mp4", capabilities, hasSourceAudio: true });
  const second = buildV2Plan({ edit, projectRoot: "/project", outputPath: "/project/exports/source.mp4", capabilities, hasSourceAudio: true });
  assert.deepEqual(second.commands, first.commands);
  assert.equal(first.preset.fps, 30);
  assert.equal(first.commands.cut.args[first.commands.cut.args.indexOf("-c:v") + 1], "libx264");
});

test("quality/encoder/fpsOverride: passing them explicitly is a new command line, not the backward-compat default path", () => {
  const baseline = buildV2Plan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
  });

  const high = buildV2Plan({
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

  const light = buildV2Plan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    quality: "light",
  });
  assert.equal(light.commands.cut.args[light.commands.cut.args.indexOf("-crf") + 1], "26");

  const forcedVideotoolbox = buildV2Plan({
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

  const forcedX264 = buildV2Plan({
    edit,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    encoder: "x264",
  });
  assert.equal(forcedX264.commands.cut.args[forcedX264.commands.cut.args.indexOf("-c:v") + 1], "libx264");
  assert.equal(forcedX264.commands.cut.args[forcedX264.commands.cut.args.indexOf("-x264-params") + 1], "keyint=1");

  assert.throws(() => buildV2Plan({
    edit, projectRoot: "/project", outputPath: "/project/exports/source.mp4", capabilities,
    hasSourceAudio: true, fpsOverride: 24,
  }), /retime/);
});

test("v2 rejects an fps override that bypasses retime, while the declared fps is accepted", () => {
  const internalEdit = { output: { fps: 30 }, sources: [], tracks: [], sourceTableDeclared: true };
  assert.throws(() => buildV2Plan({
    edit,
    internalEdit,
    sourceVersion: 2,
    projectRoot: "/project",
    outputPath: "/project/exports/source.mp4",
    capabilities,
    hasSourceAudio: true,
    fpsOverride: 24,
  }), /retime（全体再スケール）/);

  const plan = buildV2Plan({
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
  const baseline = buildV2Plan(input);
  const withinCuts = buildV2Plan({
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
  const plan = buildV2Plan({
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
  const plan = buildV2Plan({
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
  const plan = buildV2Plan({
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
  assert.ok(plan.commands.layers);
  assert.ok(plan.commands.layers.args.includes("/project/b.mp4"));
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
