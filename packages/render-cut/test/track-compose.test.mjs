import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPlan } from "../src/plan.mjs";
import { renderProject } from "../src/render-cut.mjs";
import { resolveCutTrackRanges } from "../src/track-compose.mjs";
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

function makeColorSource(path, color, frequency, duration) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=96x54:r=10:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
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

function assertColor({ r, g, b }, expected) {
  if (expected === "blue") assert.ok(b > 150 && r < 100 && g < 100, `rgb(${r},${g},${b})`);
  if (expected === "yellow") assert.ok(r > 180 && g > 180 && b < 100, `rgb(${r},${g},${b})`);
  if (expected === "green") assert.ok(g > 100 && r < 50 && b < 50, `rgb(${r},${g},${b})`);
}
