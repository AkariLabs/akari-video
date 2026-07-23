import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderProject } from "../../src/render-cut.mjs";

const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const project = await mkdtemp(join(tmpdir(), "render-cut-v1-evidence-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function makeSource(path, color, frequency) {
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=320x180:r=10:d=2`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=48000:duration=2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path,
  ]);
}

function probe(path) {
  return JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ]).stdout,
  );
}

function extractFrame(input, time, output) {
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(time),
    "-i",
    input,
    "-frames:v",
    "1",
    output,
  ]);
}

function sampleCenterRgb(path) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
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

try {
  process.env.CHROME_PATH = chromePath;
  makeSource(join(project, "a.mp4"), "red", 440);
  makeSource(join(project, "b.mp4"), "blue", 880);
  await mkdir(join(project, ".akari"));
  await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  await writeFile(
    join(project, "edit.json"),
    `${JSON.stringify(
      {
        version: 1,
        output: { width: 320, height: 180, fps: 10 },
        sources: [
          { id: "a", path: "a.mp4", proxy: null },
          { id: "b", path: "b.mp4", proxy: null },
        ],
        cuts: [
          { src: "a", in: 0, out: 0.6 },
          { src: "b", in: 0.2, out: 1 },
          { src: "a", in: 1, out: 1.7 },
        ],
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );

  const state = await renderProject(project);
  assert.equal(state.verify.verdict, "pass");
  const output = join(project, state.plan.output);
  const frames = [
    { file: "frame-01-a.png", time: 0.3 },
    { file: "frame-02-b.png", time: 1 },
    { file: "frame-03-a.png", time: 1.7 },
  ];
  for (const frame of frames) {
    const path = join(evidenceRoot, frame.file);
    extractFrame(output, frame.time, path);
    frame.center_rgb = sampleCenterRgb(path);
  }

  const measured = probe(output);
  const video = measured.streams.find((stream) => stream.codec_type === "video");
  await writeFile(
    join(evidenceRoot, "l2-result.json"),
    `${JSON.stringify(
      {
        verdict: state.verify.verdict,
        expected_duration_seconds: 2.1,
        measured_duration_seconds: Number(measured.format.duration),
        width: video.width,
        height: video.height,
        fps: video.avg_frame_rate,
        sequence: frames,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(await readFile(join(evidenceRoot, "l2-result.json"), "utf8"));
} finally {
  await rm(project, { recursive: true, force: true });
}
