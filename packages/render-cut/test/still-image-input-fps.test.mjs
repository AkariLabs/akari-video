import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildGapAwareMultiSourceCutCommand,
  buildMultiSourceCutCommand,
} from "../src/plan.mjs";
import { renderProject } from "../src/render-cut.mjs";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);
const WIDTH = 320;
const HEIGHT = 180;
const STILL_DURATION = 3.5;

function hasMediaTools() {
  return spawnSync("ffmpeg", ["-version"]).status === 0
    && spawnSync("ffprobe", ["-version"]).status === 0;
}

function ffmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function probeMedia(path) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-show_entries", "stream=codec_type,duration,nb_read_frames:format=duration",
    "-of", "json",
    path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function decodedVideoFramemd5(path) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", path,
    "-map", "0:v:0", "-f", "framemd5", "-",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function makeStill(path, color = "red") {
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${WIDTH}x${HEIGHT}`,
    "-frames:v", "1", path,
  ]);
}

function makeVideo(path, { duration, fps, color = "blue" }) {
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${WIDTH}x${HEIGHT}:r=${fps}:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ]);
}

async function makeProject({ fps, sources, cuts }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-still-input-fps-"));
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  await writeFile(join(root, "edit.json"), `${JSON.stringify({
    version: 1,
    output: { width: WIDTH, height: HEIGHT, fps },
    sources: sources.map(({ id, file }) => ({ id, path: file, proxy: null })),
    cuts,
    overlays: [],
  }, null, 2)}\n`);
  return root;
}

async function renderStillProject(fps, output = "exports/render.mp4") {
  const root = await makeProject({
    fps,
    sources: [{ id: "still", file: "still.png" }],
    cuts: [{ src: "still", in: 0, out: STILL_DURATION }],
  });
  makeStill(join(root, "still.png"));
  const originalEdit = await readFile(join(root, "edit.json"), "utf8");
  // This suite measures legacy still-image timing; engine resolution has separate unit coverage.
  const state = await renderProject(root, { out: output, engine: "legacy" });
  assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
  return { root, outputPath: join(root, state.plan.output), originalEdit };
}

test("five still-image cuts render end-to-end with exactly the planned frames at 24, 30, and 60fps", async (t) => {
  if (!hasMediaTools()) return t.skip("ffmpeg/ffprobe unavailable");

  const cutDuration = 1.3;
  const cutCount = 5;
  const plannedDuration = cutDuration * cutCount;
  const sources = Array.from({ length: cutCount }, (_, index) => ({
    id: `still-${index}`,
    file: `still-${index}.png`,
  }));
  const cuts = sources.map((source) => ({ src: source.id, in: 0, out: cutDuration }));

  // A single still cut does not reproduce this because -shortest and its duration-matched
  // anullsrc absorb the extra frame. Multiple cuts expose the per-cut image2 25fps-grid drift.
  // Before the fix, 30fps produced 199 frames and 60fps produced 394; expected is 156 / 195 / 390.
  for (const [fps, expectedFrames] of [[24, 156], [30, 195], [60, 390]]) {
    const root = await makeProject({ fps, sources, cuts });
    try {
      for (const source of sources) makeStill(join(root, source.file));
      const state = await renderProject(root, { out: "exports/render.mp4", engine: "legacy" });
      assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
      const outputPath = join(root, state.plan.output);
      const video = probeMedia(outputPath).streams.find((stream) => stream.codec_type === "video");
      assert.equal(Number(video.nb_read_frames), Math.round(plannedDuration * fps));
      assert.equal(Number(video.nb_read_frames), expectedFrames);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("still-image source inputs receive project framerate before -loop 1; video inputs do not", () => {
  const common = {
    cutPath: "cut.mp4",
    cuts: [{ src: "source", in: 0, out: 1.3 }],
    width: WIDTH,
    height: HEIGHT,
    fps: 30,
    ffmpegCommand: "ffmpeg",
    ffprobeCommand: null,
    projectRoot: ".",
  };
  const still = buildMultiSourceCutCommand({
    ...common,
    sourceInputs: [{ id: "source", path: "still.png", hasAudio: false }],
  });
  const stillInput = still.args.indexOf("still.png");
  assert.deepEqual(still.args.slice(stillInput - 5, stillInput + 1), [
    "-framerate", "30", "-loop", "1", "-i", "still.png",
  ]);

  const gapAwareStill = buildGapAwareMultiSourceCutCommand({
    ...common,
    duration: 1.3,
    sourceInputs: [{ id: "source", path: "still.png", hasAudio: false }],
  });
  const gapInput = gapAwareStill.args.indexOf("still.png");
  assert.deepEqual(gapAwareStill.args.slice(gapInput - 5, gapInput + 1), [
    "-framerate", "30", "-loop", "1", "-i", "still.png",
  ]);

  const video = buildMultiSourceCutCommand({
    ...common,
    sourceInputs: [{ id: "source", path: "video.mp4", hasAudio: true }],
  });
  assert.equal(video.args.includes("-framerate"), false);
});

test("video-only command adds only segment audio padding and omits cut-level -shortest", () => {
  const built = buildMultiSourceCutCommand({
    sourceInputs: [{ id: "video", path: "video.mp4", hasAudio: true }],
    cutPath: "cut.mp4",
    cuts: [{ src: "video", in: 0, out: 1.3 }],
    width: WIDTH,
    height: HEIGHT,
    fps: 30,
    ffmpegCommand: "ffmpeg",
    ffprobeCommand: null,
    projectRoot: ".",
  });
  const expectedFilter = "[0:v]trim=start=0:end=1.3,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange0];[vrange0]scale=out_range=tv[v0];[0:a]atrim=start=0:end=1.3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=1.3[a0];[v0][a0]concat=n=1:v=1:a=1[joinedv][joineda];[joinedv]null[outv_tv]";
  const expectedArgs = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "video.mp4",
    "-filter_complex", expectedFilter,
    "-map", "[outv_tv]", "-map", "[joineda]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "cut.mp4",
  ];
  assert.deepEqual(built.args, expectedArgs);
  assert.equal(built.args[built.args.indexOf("-filter_complex") + 1], expectedFilter);
});

test("mixed still-image and video render keeps planned frame count, duration, and A/V sync", async (t) => {
  if (!hasMediaTools()) return t.skip("ffmpeg/ffprobe unavailable");
  const fps = 30;
  const stillDuration = 1.3;
  const videoDuration = 0.7;
  const plannedDuration = stillDuration + videoDuration;
  const root = await makeProject({
    fps,
    sources: [
      { id: "still", file: "still.png" },
      { id: "video", file: "video.mp4" },
    ],
    cuts: [
      { src: "still", in: 0, out: stillDuration },
      { src: "video", in: 0, out: videoDuration },
    ],
  });
  try {
    makeStill(join(root, "still.png"));
    makeVideo(join(root, "video.mp4"), { duration: videoDuration, fps });
    const state = await renderProject(root, { out: "exports/mixed.mp4", engine: "legacy" });
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const measured = probeMedia(join(root, state.plan.output));
    const video = measured.streams.find((stream) => stream.codec_type === "video");
    const audio = measured.streams.find((stream) => stream.codec_type === "audio");
    assert.ok(audio, "expected the mixed render to contain an audio stream");
    assert.equal(Number(video.nb_read_frames), Math.round(plannedDuration * fps));
    assert.ok(Math.abs(Number(measured.format.duration) - plannedDuration) <= 1 / fps);
    assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) <= 1 / fps);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rendering the same still-image input twice is pixel-equivalent", async (t) => {
  if (!hasMediaTools()) return t.skip("ffmpeg/ffprobe unavailable");
  const {
    root,
    outputPath: firstOutput,
    originalEdit,
  } = await renderStillProject(30, "exports/first.mp4");
  try {
    // renderProject records its output as a reusable source. Restore the same declared input before
    // the second run so this assertion exercises identical project input, not the updated receipt.
    await writeFile(join(root, "edit.json"), originalEdit);
    const second = await renderProject(root, { out: "exports/second.mp4", engine: "legacy" });
    assert.equal(second.verify.verdict, "pass", JSON.stringify(second.verify.findings));
    assert.equal(
      decodedVideoFramemd5(join(root, second.plan.output)),
      decodedVideoFramemd5(firstOutput),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
