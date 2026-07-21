import assert from "node:assert/strict";
import test from "node:test";

import { buildAudioMixCommand, buildPlan, selectDefaultOutput } from "../src/plan.mjs";

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
