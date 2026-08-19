import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { verifyArtifact } from "../src/render-cut.mjs";
import {
  CONTACT_SHEET_MAX_FRAMES,
  contactSheetGridDimensions,
  deriveContactSheetTimestamps,
  renderContactSheet,
} from "../src/contact-sheet.mjs";

// task 2026-08-04-render-verify-media-checks: verify.frame-count / verify.decode / contact sheet.
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const ffprobeAvailable = spawnSync("ffprobe", ["-version"]).status === 0;

function makePlan({ durationSeconds, fps, width = 320, height = 180, hasNarration = false }) {
  return {
    predicted_duration_seconds: durationSeconds,
    duration_tolerance_seconds: Math.max(0.1, 2 / fps),
    preset: { video_codec: "h264", profile: "high", pixel_format: "yuv420p", audio_codec: "aac", width, height, fps },
    commands: { audio_mix: { hasNarration } },
  };
}

// render-cut の実出力と同じエンコード形（h264/High/yuv420p + aac）で lavfi 合成した MP4 を作る。
// 既存の verify.* 検査（resolution/fps/codec/profile/pixel-format/audio）を素通りさせ、
// 新設の frame-count/decode 検査だけを狙って動かせるようにする。
async function makeVideo({ path, width, height, fps, durationSeconds, withAudio = true, faststart = false }) {
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSeconds}`,
    ...(withAudio ? ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`] : []),
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    ...(withAudio ? ["-c:a", "aac", "-ar", "48000", "-shortest"] : ["-an"]),
    ...(faststart ? ["-movflags", "+faststart"] : []),
    path,
  ];
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("verify.frame-count and verify.decode pass on a normal render artifact; measured records the frame count", async (t) => {
  if (!ffmpegAvailable || !ffprobeAvailable) return t.skip("ffmpeg/ffprobe unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-"));
  try {
    const outputPath = join(directory, "out.mp4");
    await makeVideo({ path: outputPath, width: 320, height: 180, fps: 10, durationSeconds: 2 });
    const plan = makePlan({ durationSeconds: 2, fps: 10 });
    const verification = verifyArtifact({ outputPath, plan, ffprobeCommand: "ffprobe", ffmpegCommand: "ffmpeg" });
    assert.equal(verification.verdict, "pass", JSON.stringify(verification.findings, null, 2));
    assert.ok(
      verification.findings.every((finding) => finding.severity !== "error"),
      JSON.stringify(verification.findings, null, 2),
    );
    assert.ok(verification.findings.some((finding) => finding.check === "verify.frame-count"));
    assert.ok(verification.findings.some((finding) => finding.check === "verify.decode"));
    assert.equal(verification.measured.frame_count, 20);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a tail-truncated artifact (fewer frames than plan expects) fails verify.frame-count", async (t) => {
  if (!ffmpegAvailable || !ffprobeAvailable) return t.skip("ffmpeg/ffprobe unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-"));
  try {
    const outputPath = join(directory, "out.mp4");
    // plan expects 2s @ 10fps = 20 frames (tolerance ±2 frames); the artifact only has 15.
    await makeVideo({ path: outputPath, width: 320, height: 180, fps: 10, durationSeconds: 1.5 });
    const plan = makePlan({ durationSeconds: 2, fps: 10 });
    const verification = verifyArtifact({ outputPath, plan, ffprobeCommand: "ffprobe", ffmpegCommand: "ffmpeg" });
    assert.equal(verification.verdict, "fail");
    const frameCountFinding = verification.findings.find((finding) => finding.check === "verify.frame-count");
    assert.equal(frameCountFinding?.severity, "error", JSON.stringify(verification.findings, null, 2));
    assert.equal(verification.measured.frame_count, 15);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a mid-file truncated (corrupted) artifact fails verify.decode", async (t) => {
  if (!ffmpegAvailable || !ffprobeAvailable) return t.skip("ffmpeg/ffprobe unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-"));
  try {
    const wholePath = join(directory, "whole.mp4");
    const outputPath = join(directory, "out.mp4");
    // faststart puts moov at the front, so ffprobe (and verifyArtifact's own duration/resolution/
    // etc. probe) still reads valid stream metadata even after the tail is cut away — isolating
    // the failure to the full-decode pass instead of failing earlier at ffprobe itself.
    await makeVideo({ path: wholePath, width: 320, height: 180, fps: 10, durationSeconds: 2, faststart: true });
    const whole = await readFile(wholePath);
    await writeFile(outputPath, whole.subarray(0, Math.floor(whole.length * 0.7)));
    const plan = makePlan({ durationSeconds: 2, fps: 10 });
    const verification = verifyArtifact({ outputPath, plan, ffprobeCommand: "ffprobe", ffmpegCommand: "ffmpeg" });
    assert.equal(verification.verdict, "fail");
    const decodeFinding = verification.findings.find((finding) => finding.check === "verify.decode");
    assert.equal(decodeFinding?.severity, "error", JSON.stringify(verification.findings, null, 2));
    assert.match(decodeFinding.message, /partial file|error/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("contact sheet timestamps are pure and deterministic across repeated calls with the same input", () => {
  const cuts = [
    { in: 0, out: 2 },
    { in: 5, out: 8 },
    { in: 10, out: 11 },
  ];
  const overlays = [
    { start: 0.2, duration: 0.6 },
    { start: 3.5, duration: 1.2 },
  ];
  const args = { cuts, overlays, durationSeconds: 6, fps: 10 };
  const first = deriveContactSheetTimestamps(args);
  const second = deriveContactSheetTimestamps({
    cuts: JSON.parse(JSON.stringify(cuts)),
    overlays: JSON.parse(JSON.stringify(overlays)),
    durationSeconds: 6,
    fps: 10,
  });
  assert.deepEqual(second, first);
  assert.ok(first.length > 0);
  assert.equal(first[0], 0, "opening frame is included");
  assert.ok(first.at(-1) < 6, "closing frame lands before the end of the timeline");
  assert.deepEqual([...first], [...first].sort((a, b) => a - b), "timestamps are sorted ascending");
});

test("contact sheet timestamps are thinned to the fixed cap and stay deterministic under thinning", () => {
  // Many short cuts push the raw candidate count comfortably past the cap.
  const cuts = Array.from({ length: 30 }, (_, index) => ({ in: index * 2, out: index * 2 + 1 }));
  const durationSeconds = 30;
  const first = deriveContactSheetTimestamps({ cuts, overlays: [], durationSeconds, fps: 10 });
  const second = deriveContactSheetTimestamps({ cuts, overlays: [], durationSeconds, fps: 10 });
  assert.ok(first.length <= CONTACT_SHEET_MAX_FRAMES);
  assert.deepEqual(second, first);
  assert.equal(first[0], 0);
});

test("contact sheet grid dimensions are deterministic and cover every requested frame", () => {
  assert.deepEqual(contactSheetGridDimensions(1), { cols: 1, rows: 1 });
  assert.deepEqual(contactSheetGridDimensions(4), { cols: 2, rows: 2 });
  assert.deepEqual(contactSheetGridDimensions(5), { cols: 3, rows: 2 });
  assert.deepEqual(contactSheetGridDimensions(12), { cols: 4, rows: 3 });
});

test("renderContactSheet produces one tiled PNG sized to the grid, or null when there are no timestamps", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-contact-sheet-"));
  try {
    const videoPath = join(directory, "source.mp4");
    await makeVideo({ path: videoPath, width: 64, height: 36, fps: 10, durationSeconds: 2 });
    const outputPath = join(directory, "contact-sheet.png");
    const temporaryDirectory = join(directory, "tmp");
    await mkdir(temporaryDirectory, { recursive: true });
    const timestamps = [0, 0.5, 1.0, 1.5, 1.9];
    const produced = await renderContactSheet({
      ffmpegCommand: "ffmpeg",
      videoPath,
      timestamps,
      temporaryDirectory,
      outputPath,
    });
    assert.equal(produced, outputPath);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", outputPath],
      { encoding: "utf8" },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const { cols, rows } = contactSheetGridDimensions(timestamps.length);
    assert.equal(probe.stdout.trim(), `${cols * 64},${rows * 36}`);

    const empty = await renderContactSheet({
      ffmpegCommand: "ffmpeg",
      videoPath,
      timestamps: [],
      temporaryDirectory,
      outputPath: join(directory, "unused.png"),
    });
    assert.equal(empty, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
