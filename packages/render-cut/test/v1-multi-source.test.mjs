import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { generateCaptionOverlays } from "../src/captions.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function run(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], {
    encoding: "utf8",
    env: { ...process.env, CHROME_PATH: chromePath },
  });
}

function ffprobe(path) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function sampleCenterRgb(path, time) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(time),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      "crop=1:1:(iw-1)/2:(ih-1)/2,format=rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

async function makeSource(path, { color, size, fps = 10, frequency = 440, duration = 2 }) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${size}:r=${fps}:d=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

async function makeProject({
  firstSize = "320x180",
  secondSize = "320x180",
  cuts = [
    { src: "s1", in: 0, out: 0.6 },
    { src: "s2", in: 0.2, out: 1 },
    { src: "s1", in: 1, out: 1.7 },
  ],
  captions = null,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-v1-test-"));
  await makeSource(join(root, "first.mp4"), {
    color: "red",
    size: firstSize,
    frequency: 440,
  });
  await makeSource(join(root, "second.mp4"), {
    color: "blue",
    size: secondSize,
    frequency: 880,
  });
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 1,
        output: { width: 320, height: 180, fps: 10 },
        sources: [
          { id: "s1", path: "first.mp4", proxy: null },
          { id: "unused", path: "does-not-exist.mp4", proxy: null },
          { id: "s2", path: "second.mp4", proxy: null },
        ],
        cuts,
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  if (captions !== null) {
    await writeFile(join(root, "captions.json"), `${JSON.stringify(captions, null, 2)}\n`);
  }
  return root;
}

test("v1 renders s1 -> s2 -> s1, omits an unused source input, and measures the cuts total", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject();
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    const outputPath = join(project, state.plan.output);
    const measured = ffprobe(outputPath);
    const duration = Number(measured.format.duration);
    assert.ok(Math.abs(duration - 2.1) <= 0.12, `duration=${duration}`);
    const firstAppearance = sampleCenterRgb(outputPath, 0.3);
    const secondSource = sampleCenterRgb(outputPath, 1);
    const secondAppearance = sampleCenterRgb(outputPath, 1.7);
    assert.ok(firstAppearance.r > 200 && firstAppearance.b < 30, JSON.stringify(firstAppearance));
    assert.ok(secondSource.b > 200 && secondSource.r < 30, JSON.stringify(secondSource));
    assert.ok(secondAppearance.r > 200 && secondAppearance.b < 30, JSON.stringify(secondAppearance));

    const inputPaths = [];
    for (let index = 0; index < state.plan.commands.cut.args.length; index += 1) {
      if (state.plan.commands.cut.args[index] === "-i") {
        inputPaths.push(state.plan.commands.cut.args[index + 1]);
      }
    }
    assert.deepEqual(inputPaths, [join(project, "first.mp4"), join(project, "second.mp4")]);
    assert.deepEqual(state.provenance.sources.map((source) => source.id), ["s1", "s2"]);
    assert.deepEqual(
      state.provenance.sources.map(({ width, height, fps, has_audio, pix_fmt, color_range }) => ({
        width,
        height,
        fps,
        has_audio,
        pix_fmt,
        color_range,
      })),
      [
        { width: 320, height: 180, fps: 10, has_audio: true, pix_fmt: "yuv420p", color_range: null },
        { width: 320, height: 180, fps: 10, has_audio: true, pix_fmt: "yuv420p", color_range: null },
      ],
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
test("v1 refuses an empty timeline instead of rendering a zero-second video", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ cuts: [] });
  try {
    const executed = run(project, ["--plan-only"]);
    assert.equal(executed.status, 1);
    assert.match(executed.stderr, /no output duration because cuts is empty/);

    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    delete edit.cuts;
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
    const missing = run(project, ["--plan-only"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no output duration because cuts is empty/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("v1 normalizes differently-sized sources before concat", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    firstSize: "320x180",
    secondSize: "160x90",
    cuts: [
      { src: "s1", in: 0, out: 0.5 },
      { src: "s2", in: 0, out: 0.5 },
    ],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    const measured = ffprobe(join(project, state.plan.output));
    const video = measured.streams.find((stream) => stream.codec_type === "video");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    const filter = state.plan.commands.cut.args[
      state.plan.commands.cut.args.indexOf("-filter_complex") + 1
    ];
    assert.equal((filter.match(/scale=320:180/g) ?? []).length, 2);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("v1 captions project by matching src and skip missing src with a warning", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const captions = [
    { id: "c-with-src", src: "s2", start: 0.2, end: 0.6, text: "kept" },
    { id: "c-without-src", start: 0, end: 0.4, text: "skipped" },
  ];
  const cuts = [
    { src: "s1", in: 0, out: 0.5 },
    { src: "s2", in: 0.2, out: 0.8 },
  ];
  const warnings = [];
  const overlays = generateCaptionOverlays(captions, cuts, {
    sourceCount: 2,
    onWarning: (warning) => warnings.push(warning),
  });
  assert.deepEqual(overlays.map(({ generatedFrom, start, duration }) => ({ generatedFrom, start, duration })), [
    { generatedFrom: "c-with-src", start: 0.5, duration: 0.39999999999999997 },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /c-without-src.*omits src.*skipped/);

  const project = await makeProject({ cuts, captions });
  try {
    const executed = run(project, ["--plan-only"]);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.warnings.filter((warning) => warning.includes("c-without-src")).length, 1);
    assert.equal(
      state.plan.intermediates.filter((path) => /static-\d{4}\.html$/u.test(path)).length,
      1,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
