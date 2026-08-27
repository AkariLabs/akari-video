import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze). L1 requires a real render +
// ffprobe/frame measurement: output duration = original + duration_sec, 2 frames inside the
// frozen span are pixel-identical, and the declared audio behavior (silence) is measured, not
// just asserted from the command plan.

import { appendFreezeAwareAudioTrim, freezeDurationSeconds, hasCutFreeze } from "../src/cut-freeze.mjs";
import { buildGapAwareMultiSourceCutCommand, buildMultiSourceCutCommand } from "../src/plan.mjs";
import { buildCutCommand } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: null });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result;
}

function runCli(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], { encoding: "utf8" });
}

function ffmpegAvailable() {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

function ffprobe(args) {
  const result = spawnSync("ffprobe", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// testsrc has continuously-changing content (unlike a solid color), so "two frames are
// pixel-identical" is a meaningful assertion -- it would fail immediately on unfrozen footage.
async function makeMovingSource(root, { duration = 6, withAudio = true } = {}) {
  const path = join(root, "source.mp4");
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `testsrc=size=320x180:rate=10:duration=${duration}`,
  ];
  if (withAudio) {
    args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`);
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(path);
  run("ffmpeg", args);
  return path;
}

function frameBytes(path, atSeconds) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", path, "-ss", String(atSeconds), "-frames:v", "1", "-vf", "format=rgb24", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" },
  );
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  return result.stdout;
}

function probeVideoFrameCount(path) {
  const stdout = ffprobe(["-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=nb_read_frames,duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  const [duration, frames] = stdout.trim().split("\n");
  return { duration: Number(duration), frames: Number(frames) };
}

test("cuts[].freeze detection: only a positive duration_sec with a non-negative at_sec counts", () => {
  assert.equal(hasCutFreeze([{ in: 0, out: 1 }]), false);
  assert.equal(hasCutFreeze([{ in: 0, out: 1, freeze: null }]), false);
  assert.equal(hasCutFreeze([{ in: 0, out: 1, freeze: { at_sec: 0, duration_sec: 0 } }]), false, "duration_sec 0 freezes nothing");
  assert.equal(hasCutFreeze([{ in: 0, out: 1, freeze: { at_sec: 0.5, duration_sec: 1 } }]), true);
  assert.equal(freezeDurationSeconds({ duration_sec: 2 }), 2);
  assert.equal(freezeDurationSeconds(null), 0);
});

test("cut audio padding is appended for no-freeze, freeze start/end/middle, and speed chains", () => {
  const cases = [
    { id: "plain", freeze: null, speed: 1, atempoSuffix: "", padToSeconds: 2 },
    { id: "start", freeze: { at_sec: 0, duration_sec: 1 }, speed: 1, atempoSuffix: "", padToSeconds: 3 },
    { id: "end", freeze: { at_sec: 2, duration_sec: 1 }, speed: 1, atempoSuffix: "", padToSeconds: 3 },
    { id: "middle", freeze: { at_sec: 1, duration_sec: 1 }, speed: 1, atempoSuffix: "", padToSeconds: 3 },
    { id: "speed", freeze: null, speed: 2, atempoSuffix: ",atempo=2", padToSeconds: 1 },
  ];
  for (const entry of cases) {
    const filters = [];
    appendFreezeAwareAudioTrim({
      filters,
      inputLabel: "[0:a]",
      outputLabel: `[${entry.id}]`,
      sourceIn: 0,
      sourceOut: 2,
      normalize: true,
      ...entry,
    });
    assert.match(
      filters.at(-1),
      new RegExp(`apad=whole_dur=${entry.padToSeconds}\\[${entry.id}\\]$`),
      `${entry.id}: ${filters.join(";")}`,
    );
    if (entry.id === "speed") assert.match(filters.at(-1), /atempo=2/);
  }
});

test("cut audio end warnings use one duration probe per source and cut intermediates omit -shortest", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-audio-pad-plan-"));
  try {
    const sourcePath = join(root, "source.mp4");
    const probePath = join(root, "ffprobe-fixture.mjs");
    const callsPath = join(root, "calls.jsonl");
    await rawWriteFile(sourcePath, "fixture");
    await rawWriteFile(probePath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const audio = process.argv.includes("a:0");
process.stdout.write(JSON.stringify(audio
  ? { streams: [{ duration: "4.7" }] }
  : { streams: [{ codec_name: "h264", pix_fmt: "yuv420p", tags: {} }] }));
`);
    await chmod(probePath, 0o755);
    const command = buildMultiSourceCutCommand({
      sourceInputs: [{ id: "clip", path: sourcePath, hasAudio: true }],
      cutPath: join(root, "cut.mp4"),
      cuts: [
        { id: "cut-1", src: "clip", in: 0, out: 4.933 },
        { id: "cut-2", src: "clip", in: 0, out: 4.933 },
      ],
      width: 320,
      height: 180,
      fps: 30,
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: probePath,
      projectRoot: root,
    });
    assert.equal(command.args.includes("-shortest"), false);
    assert.equal(command.warnings.length, 2);
    assert.match(command.warnings[0], /^cut cut-1: audio stream ends at 4\.7s before out=4\.933s; padded 0\.233s of silence$/);
    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(calls.filter(args => args.includes("a:0")).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].freeze (middle of the cut): output duration = original + duration_sec, 2 frames inside the hold are pixel-identical, and it resumes real content afterward (lossless encode to rule out compression noise)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-freeze-middle-"));
  try {
    const sourcePath = await makeMovingSource(root, { duration: 6 });
    const cutPath = join(root, "cut.mp4");
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{ in: 0, out: 6, freeze: { at_sec: 2, duration_sec: 1 } }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: true,
      duration: 7,
      projectRoot: root,
      // Lossless so "pixel-identical" is a real equality check, not a tolerance band around
      // ordinary h264 compression noise (verified: default CRF encoding of two genuinely
      // identical source frames still differs by a few units per channel from B/P-frame
      // reconstruction, which would make an exact-equality assertion flaky).
      videoEncodeArgs: ["-c:v", "libx264", "-qp", "0", "-preset", "ultrafast"],
    });
    run(command.command, command.args);

    const { duration } = probeVideoFrameCount(cutPath);
    t.diagnostic(`measured duration=${duration}`);
    assert.ok(Math.abs(duration - 7) <= 0.05, `expected output duration ~7s (6 + 1 hold), got ${duration}`);

    const holdEarly = frameBytes(cutPath, 2.1);
    const holdLate = frameBytes(cutPath, 2.9);
    const beforeHold = frameBytes(cutPath, 1.5);
    const afterHold = frameBytes(cutPath, 3.5);
    assert.deepEqual(holdEarly, holdLate, "expected two frames inside the frozen span to be pixel-identical");
    assert.notDeepEqual(beforeHold, holdEarly, "expected the frame before the freeze to differ from the held frame (moving content)");
    assert.notDeepEqual(holdLate, afterHold, "expected playback to resume real (moving) content after the hold, not stay frozen");

    // Audio: contract decision is silence inserted for the held span, not a looped/held sample.
    const silence = ffmpeg_silencedetect(cutPath);
    t.diagnostic(`silence windows: ${JSON.stringify(silence)}`);
    assert.ok(
      silence.some((window) => Math.abs(window.start - 2) < 0.2 && Math.abs(window.duration - 1) < 0.2),
      "expected a ~1s silence window starting at ~2s (the freeze span)",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].freeze at the very start of the cut (at_sec=0) still yields the exact original+hold duration (regression: tpad start_mode=clone + a downstream fps filter silently drops the last frame on this ffmpeg build; the fix routes through stop_mode=clone via a frame-index seed instead)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-freeze-start-"));
  try {
    const sourcePath = await makeMovingSource(root, { duration: 3, withAudio: false });
    const cutPath = join(root, "cut.mp4");
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{ in: 0, out: 3, freeze: { at_sec: 0, duration_sec: 1 } }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 4,
      projectRoot: root,
    });
    run(command.command, command.args);

    const { duration, frames } = probeVideoFrameCount(cutPath);
    t.diagnostic(`duration=${duration} frames=${frames}`);
    assert.equal(frames, 40, `expected exactly 40 frames (30 original + 10 held) at 10fps, got ${frames}`);
    assert.ok(Math.abs(duration - 4) <= 0.05, `expected ~4s, got ${duration}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].freeze at the very end of the cut (at_sec=out-in) still yields the exact original+hold duration", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-freeze-end-"));
  try {
    const sourcePath = await makeMovingSource(root, { duration: 3, withAudio: false });
    const cutPath = join(root, "cut.mp4");
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{ in: 0, out: 3, freeze: { at_sec: 3, duration_sec: 1 } }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 4,
      projectRoot: root,
    });
    run(command.command, command.args);

    const { duration, frames } = probeVideoFrameCount(cutPath);
    t.diagnostic(`duration=${duration} frames=${frames}`);
    assert.equal(frames, 40, `expected exactly 40 frames, got ${frames}`);
    assert.ok(Math.abs(duration - 4) <= 0.05, `expected ~4s, got ${duration}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].freeze on a v1 (multi-source) cut behaves the same as v0", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-freeze-v1-"));
  try {
    const sourcePath = await makeMovingSource(root, { duration: 3, withAudio: false });
    const cutPath = join(root, "cut.mp4");
    const command = buildMultiSourceCutCommand({
      sourceInputs: [{ id: "s1", path: sourcePath, hasAudio: false, inputIndex: 0 }],
      cutPath,
      cuts: [{ src: "s1", in: 0, out: 3, freeze: { at_sec: 1, duration_sec: 0.5 } }],
      width: 320,
      height: 180,
      fps: 10,
      projectRoot: root,
    });
    run(command.command, command.args);

    const { duration } = probeVideoFrameCount(cutPath);
    t.diagnostic(`duration=${duration}`);
    assert.ok(Math.abs(duration - 3.5) <= 0.05, `expected 3 + 0.5 = 3.5s, got ${duration}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].freeze is rejected (not silently dropped) when combined with a gap-aware timeline (explicit at/track)", () => {
  assert.throws(
    () => buildCutCommand({
      sourcePath: "/dev/null",
      cutPath: "/dev/null",
      cuts: [
        { in: 0, out: 2, track: 0 },
        { at: 5, in: 0, out: 2, track: 0, freeze: { at_sec: 1, duration_sec: 1 } },
      ],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 8,
      projectRoot: "/tmp",
    }),
    /freeze is not supported together with a gap-aware cut timeline/,
  );
});

// docs/contract-2026-08-18-v1-render-parity.md: v1's counterpart of the above -- same restriction,
// enforced by buildGapAwareMultiSourceCutCommand (the function buildPlan's v1 dispatch now routes
// to whenever needsGapAwareCutTimeline(edit.cuts) is true).
test("cuts[].freeze on a v1 (multi-source) cut is rejected the same way when combined with a gap-aware timeline", () => {
  assert.throws(
    () => buildGapAwareMultiSourceCutCommand({
      sourceInputs: [{ id: "s1", path: "/dev/null", hasAudio: false }],
      cutPath: "/dev/null",
      cuts: [
        { src: "s1", in: 0, out: 2, track: 0 },
        { src: "s1", at: 5, in: 0, out: 2, track: 0, freeze: { at_sec: 1, duration_sec: 1 } },
      ],
      width: 320,
      height: 180,
      fps: 10,
      duration: 8,
      projectRoot: "/tmp",
    }),
    /freeze is not supported together with a gap-aware cut timeline/,
  );
});

// End-to-end: the same feature exercised through the CLI (edit.json -> render-cut.mjs).
async function makeFreezeProject(root) {
  await makeMovingSource(root, { duration: 3, withAudio: false });
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: 3, freeze: { at_sec: 1.5, duration_sec: 1 } }],
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
}

test("end-to-end: cuts[].freeze declared in edit.json renders through the render-cut CLI with the predicted (hold-extended) duration", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = mkdtempSync(join(tmpdir(), "render-cut-freeze-e2e-"));
  try {
    await makeFreezeProject(root);
    const executed = runCli(root);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.plan.predicted_duration_seconds, 4, "3s original + 1s freeze hold");

    const outputPath = join(root, state.artifacts[0].path);
    const { duration } = probeVideoFrameCount(outputPath);
    t.diagnostic(`measured duration=${duration}`);
    assert.ok(Math.abs(duration - 4) <= state.plan.duration_tolerance_seconds, `expected ~4s, got ${duration}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function ffmpeg_silencedetect(path) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-af", "silencedetect=noise=-30dB:d=0.3", "-f", "null", "-"], { encoding: "utf8" });
  const windows = [];
  let currentStart = null;
  for (const line of result.stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) currentStart = Number(startMatch[1]);
    const durationMatch = line.match(/silence_duration:\s*([\d.]+)/);
    if (durationMatch && currentStart !== null) {
      windows.push({ start: currentStart, duration: Number(durationMatch[1]) });
      currentStart = null;
    }
  }
  return windows;
}
