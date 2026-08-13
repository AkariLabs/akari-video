import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLayersCompositeCommand } from "../src/layers.mjs";

const cornersA = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
const cornersB = [[0.25, 0.15], [0.75, 0.2], [0.2, 0.75], [0.8, 0.85]];
const width = 64;
const height = 36;

function withTempProject(callback) {
  const projectRoot = mkdtempSync(join(tmpdir(), "akari-layers-filter-"));
  try {
    return callback(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

function buildInTemp(options) {
  return withTempProject((projectRoot) => buildLayersCompositeCommand({
    projectRoot,
    ffmpegCommand: "ffmpeg",
    inputPath: join(projectRoot, "base.mp4"),
    outputPath: join(projectRoot, "output.mp4"),
    width,
    height,
    fps: 30,
    ...options,
  }));
}

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
  return buildInTemp({ layers: [layer], duration: 5 });
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
    test(`filter layer ${name} (${keyframes ? "keyframed" : "static"}) adds one mask input`, () => {
      const result = command(filter, { keyframes });
      const graph = graphOf(result);
      assert.equal(result.args.filter((arg) => arg === "-i").length, 2);
      assert.match(graph, expected);
      assert.match(graph, /\[1:v\]scale=64:36:flags=bilinear,format=gray,tpad=stop_mode=clone:stop_duration=0\.03333333333333333\[l0_mask\]/u);
      assert.doesNotMatch(graph, /color=c=white/u);
      assert.doesNotMatch(graph, /alphaextract/u);
      assert.equal(count(graph, /maskedmerge/gu), 1);
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
  const result = buildInTemp({
    layers: [{ id: "missing-region", t: 1, duration: 2, kind: "filter", filter: { type: "invert" } }],
    duration: 5,
  });
  assert.equal(result.args.filter((arg) => arg === "-i").length, 1);
  assert.match(result.warnings[0], /no usable perspective region; skipped/u);
});

test("a source-backed layer after a filter keeps its pre-registered input index", () => {
  const result = buildInTemp({
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
    duration: 5,
  });
  const graph = graphOf(result);
  assert.equal(result.args.filter((arg) => arg === "-i").length, 3);
  assert.match(graph, /\[1:v\]split=1\[vsrc0_0\]/u);
  assert.match(graph, /\[2:v\]scale=64:36:flags=bilinear,format=gray,tpad=stop_mode=clone:stop_duration=0\.03333333333333333\[l0_mask\]/u);
});

test("filter trim boundaries snap to the CFR frame grid", () => {
  const t = 1.0833333333333333;
  const layerDuration = 3.6666666666666665;
  const fps = 30;
  const result = buildInTemp({
    layers: [{
      id: "region-filter",
      t,
      duration: layerDuration,
      kind: "filter",
      filter: { type: "invert" },
      perspective: { corners: cornersA },
    }],
    duration: 8,
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
  const result = buildInTemp({
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
    duration: 8,
  });
  const graph = graphOf(result);
  const firstDuring = graph.match(/\[l0_prev1\]trim=start=[^:]+:end=([^,]+)/u);
  const secondBefore = graph.match(/\[l1_prev0\]trim=start=0:end=([^,]+)/u);
  assert.ok(firstDuring, "the first filter should have an active segment");
  assert.ok(secondBefore, "the second filter should have a preceding segment");
  assert.equal(firstDuring[1], secondBefore[1]);
});

test("filter trim boundaries use edit.json fps before the cut input exists", () => {
  withTempProject((projectRoot) => {
    writeFileSync(
      join(projectRoot, "edit.json"),
      JSON.stringify({ version: 0, output: { width, height, fps: 30 } }),
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
      width,
      height,
    });
    const frame = 1 / 30;
    const snappedT = (Math.round(t / frame) * frame).toString();
    const snappedEnd = (Math.round((t + layerDuration) / frame) * frame).toString();
    assert.ok(
      graphOf(result).includes(`trim=start=${snappedT}:end=${snappedEnd}`),
      "edit.json output.fps should activate snapping before the cut file exists",
    );
  });
});

test("filter quad mask input uses the same explicit fps as the base video", () => {
  const result = command({ type: "invert" });
  const maskInput = result.args.findIndex((arg) => arg.endsWith("region-filter_0.gray"));
  assert.ok(maskInput > 0);
  assert.deepEqual(result.args.slice(maskInput - 9, maskInput + 1), [
    "-f", "rawvideo", "-pix_fmt", "gray", "-s", "32x18", "-r", "30", "-i", result.args[maskInput],
  ]);
});

test("filter output is fps-normalized before the next filter layer consumes it", () => {
  const result = buildInTemp({
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
    duration: 5,
  });
  const graph = graphOf(result);
  assert.equal(result.args.filter((arg) => arg === "-i").length, 3);
  assert.match(graph, /maskedmerge,format=yuv420p,fps=30,trim=end_frame=30,setpts=PTS-STARTPTS\[l0_segB\]/u);
  assert.match(graph, /concat=n=3:v=1:a=0\[l0_concat\];\[l0_concat\]fps=30\[l0_out\];\[l0_out\]split=/u);
});

test("one or two filter layers preserve the base video's exact frame count", () => {
  withTempProject((projectRoot) => {
    const inputPath = join(projectRoot, "base.mp4");
    const source = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", inputPath,
    ], { encoding: "utf8" });
    assert.equal(source.status, 0, source.stderr);

    const layers = [
      {
        id: "region-filter-a",
        t: 0.2,
        duration: 0.4,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersA },
      },
      {
        id: "region-filter-b",
        t: 1,
        duration: 0.3,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersB },
      },
    ];

    for (const count of [1, 2]) {
      const outputPath = join(projectRoot, `output-${count}.mp4`);
      const command = buildLayersCompositeCommand({
        layers: layers.slice(0, count),
        projectRoot,
        ffmpegCommand: "ffmpeg",
        inputPath,
        outputPath,
        duration: 2,
        width,
        height,
        fps: 30,
      });
      const rendered = spawnSync(command.command, command.args, { encoding: "utf8" });
      assert.equal(rendered.status, 0, rendered.stderr);
      const probed = spawnSync("ffprobe", [
        "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=duration,nb_read_frames", "-of", "json", outputPath,
      ], { encoding: "utf8" });
      assert.equal(probed.status, 0, probed.stderr);
      const stream = JSON.parse(probed.stdout).streams[0];
      assert.equal(stream.nb_read_frames, "60", `${count} filter layer(s)`);
      assert.equal(stream.duration, "2.000000", `${count} filter layer(s)`);
    }
  });
});

test("filter mask command generation is deterministic", () => {
  withTempProject((projectRoot) => {
    const options = {
      layers: [{
        id: "region/filter",
        t: 0,
        duration: 1,
        kind: "filter",
        filter: { type: "invert" },
        perspective: { corners: cornersA },
      }],
      projectRoot,
      ffmpegCommand: "ffmpeg",
      inputPath: join(projectRoot, "base.mp4"),
      outputPath: join(projectRoot, "output.mp4"),
      duration: 2,
      width,
      height,
      fps: 30,
    };
    const first = buildLayersCompositeCommand(options);
    const second = buildLayersCompositeCommand(options);
    assert.deepEqual(second, first);
    assert.ok(first.args.some((arg) => arg.endsWith("region_filter_0.gray")));
  });
});
