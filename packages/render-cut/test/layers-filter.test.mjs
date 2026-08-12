import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLayersCompositeCommand } from "../src/layers.mjs";

const cornersA = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
const cornersB = [[0.25, 0.15], [0.75, 0.2], [0.2, 0.75], [0.8, 0.85]];

function command(filter, { keyframes = false } = {}) {
  const layer = {
    id: "region-filter",
    t: 1,
    duration: 2,
    kind: "filter",
    filter,
    perspective: { corners: cornersA },
    ...(keyframes ? {
      keyframes: [
        { t: 0, perspective: { corners: cornersA } },
        { t: 2, perspective: { corners: cornersB } },
      ],
    } : {}),
  };
  return buildLayersCompositeCommand({
    layers: [layer],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 5,
    width: 1280,
    height: 720,
  });
}

function graphOf(result) {
  return result.args[result.args.indexOf("-filter_complex") + 1];
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

for (const [name, filter, expected] of [
  ["invert", { type: "invert" }, /negate/u],
  ["lut", { type: "lut", id: "mono" }, /lut3d=file=/u],
  ["saturation", { type: "saturation", value: 1.6 }, /eq=saturation=1\.6/u],
]) {
  for (const keyframes of [false, true]) {
    test(`filter layer ${name} (${keyframes ? "keyframed" : "static"}) adds no -i and builds a quad mask`, () => {
      const result = command(filter, { keyframes });
      const graph = graphOf(result);
      assert.equal(result.args.filter((arg) => arg === "-i").length, 1);
      assert.match(graph, expected);
      assert.match(graph, /color=c=white/u);
      assert.match(graph, /alphaextract/u);
      assert.match(graph, /maskedmerge/u);
      if (keyframes) {
        assert.ok(count(graph, /color=c=white/gu) > 1, "perspective keyframes should expand into multiple filter sub-layers");
        assert.ok(count(graph, /maskedmerge/gu) > 1, "each expanded region should be composited");
      }
    });
  }
}

test("lut intensity 1 uses one lut3d without a blend", () => {
  const graph = graphOf(command({ type: "lut", id: "mono" }));
  assert.match(graph, /lut3d=file=/u);
  assert.doesNotMatch(graph, /blend=all_mode=normal/u);
});

test("partial lut intensity blends LUT output over the original", () => {
  const graph = graphOf(command({ type: "lut", id: "mono", intensity: 0.6 }));
  assert.match(graph, /lut3d=file=/u);
  assert.match(graph, /blend=all_mode=normal:all_opacity=0\.6/u);
});

test("a filter without perspective is skipped with a warning", () => {
  const result = buildLayersCompositeCommand({
    layers: [{ id: "missing-region", t: 1, duration: 2, kind: "filter", filter: { type: "invert" } }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 5,
    width: 1280,
    height: 720,
  });
  assert.equal(result.args.filter((arg) => arg === "-i").length, 1);
  assert.match(result.warnings[0], /no usable perspective region; skipped/u);
});

test("a source-backed layer after a filter still uses the next actual ffmpeg input", () => {
  const result = buildLayersCompositeCommand({
    layers: [
      {
        id: "region-filter",
        t: 0,
        duration: 1,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersA },
      },
      { id: "pinp", t: 2, duration: 1, kind: "video", src: "pinp.mp4" },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 5,
    width: 1280,
    height: 720,
  });
  const graph = graphOf(result);
  assert.equal(result.args.filter((arg) => arg === "-i").length, 2);
  assert.match(graph, /\[1:v\]/u);
  assert.doesNotMatch(graph, /\[2:v\]/u);
});

test("filter trim boundaries snap to the CFR frame grid", () => {
  const t = 1.0833333333333333;
  const layerDuration = 3.6666666666666665;
  const fps = 30;
  const result = buildLayersCompositeCommand({
    layers: [{
      id: "region-filter",
      t,
      duration: layerDuration,
      kind: "filter",
      filter: { type: "invert" },
      perspective: { corners: cornersA },
    }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 8,
    width: 1280,
    height: 720,
    fps,
  });
  const frame = 1 / fps;
  const snappedT = (Math.round(t / frame) * frame).toString();
  const snappedEnd = (Math.round((t + layerDuration) / frame) * frame).toString();
  assert.ok(
    graphOf(result).includes(`trim=start=${snappedT}:end=${snappedEnd}`),
    "the active segment should use frame-snapped start and end values",
  );
});

test("adjacent filter layers share exactly the same snapped boundary", () => {
  const result = buildLayersCompositeCommand({
    layers: [
      {
        id: "region-filter-a",
        t: 1.0833333333333333,
        duration: 3.6666666666666665,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersA },
      },
      {
        id: "region-filter-b",
        t: 4.75,
        duration: 0.75,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersB },
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 8,
    width: 1280,
    height: 720,
    fps: 30,
  });
  const graph = graphOf(result);
  const firstDuring = graph.match(/\[l0_prev1\]trim=start=[^:]+:end=([^,]+)/u);
  const secondBefore = graph.match(/\[l1_prev0\]trim=start=0:end=([^,]+)/u);
  assert.ok(firstDuring, "the first filter should have an active segment");
  assert.ok(secondBefore, "the second filter should have a preceding segment");
  assert.equal(firstDuring[1], secondBefore[1]);
});

test("filter trim boundaries use edit.json fps before the cut input exists", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "akari-filter-fps-"));
  try {
    writeFileSync(
      join(projectRoot, "edit.json"),
      JSON.stringify({
        version: 0,
        output: { width: 1280, height: 720, fps: 30 },
      }),
    );
    const t = 1.0833333333333333;
    const layerDuration = 3.6666666666666665;
    const result = buildLayersCompositeCommand({
      layers: [{
        id: "region-filter",
        t,
        duration: layerDuration,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersA },
      }],
      projectRoot,
      ffmpegCommand: "ffmpeg",
      inputPath: join(projectRoot, "cut-not-created-yet.mp4"),
      outputPath: join(projectRoot, "output.mp4"),
      duration: 8,
      width: 1280,
      height: 720,
    });
    const frame = 1 / 30;
    const snappedT = (Math.round(t / frame) * frame).toString();
    const snappedEnd = (Math.round((t + layerDuration) / frame) * frame).toString();
    assert.ok(
      graphOf(result).includes(`trim=start=${snappedT}:end=${snappedEnd}`),
      "edit.json output.fps should activate snapping before the cut file exists",
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("filter quad mask uses the same explicit fps as the base video", () => {
  const result = buildLayersCompositeCommand({
    layers: [{
      id: "region-filter",
      t: 1,
      duration: 2,
      kind: "filter",
      filter: { type: "invert" },
      perspective: { corners: cornersA },
    }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 5,
    width: 1280,
    height: 720,
    fps: 30,
  });
  assert.match(graphOf(result), /color=c=white:s=1280x720:d=2:r=30\[l0_maskraw\]/u);
});

test("filter output is fps-normalized before the next filter layer consumes it", () => {
  const result = buildLayersCompositeCommand({
    layers: [
      {
        id: "region-filter-a",
        t: 1,
        duration: 1,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersA },
      },
      {
        id: "region-filter-b",
        t: 2,
        duration: 1,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersB },
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/base.mp4",
    outputPath: "/project/output.mp4",
    duration: 5,
    width: 1280,
    height: 720,
    fps: 30,
  });
  const graph = graphOf(result);
  assert.match(graph, /maskedmerge,format=yuv420p,fps=30\[l0_segB\]/u);
  assert.match(graph, /concat=n=3:v=1:a=0\[l0_concat\];\[l0_concat\]fps=30\[l0_out\];\[l0_out\]split=/u);
});
