import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { buildAudioMixCommand } from "../src/plan.mjs";

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (consumption side, R6b lane):
// audio.sfx[].in/out trims playback to the material's [in, out); audio.bgm.in seeks the material's
// internal start offset. Real-render + ffprobe/waveform verification, in the spirit of
// audio-bgm-fade.test.mjs / audio-narration.test.mjs: content is proven by band-pass RMS at known
// frequency markers, not by trusting the command plan alone.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// Input-side -ss (before -i) performs a real seek, so only samples in [start, start+duration) ever
// reach the filter -- an output-side "-i f -ss s" would accumulate from t=0 instead. Same rationale
// as audio-bgm-fade.test.mjs's measureMeanVolume, empirically re-confirmed for this file's own
// frequency-marker fixtures during authoring (bandpass-filtered volumedetect at successive windows
// cleanly separated marker tones with no bleed once windows are >=0.2s wide).
function measureBandVolume(filePath, start, duration, centerFrequency, halfWidth) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-ss",
      String(start),
      "-i",
      filePath,
      "-t",
      String(duration),
      "-af",
      `bandpass=f=${centerFrequency}:width_type=h:w=${halfWidth},volumedetect`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  assert.ok(match, `volumedetect did not report mean_volume for ${filePath} [${start},${start + duration}] band=${centerFrequency}Hz: ${result.stderr}`);
  return Number(match[1]);
}

function makeSilentSourceVideo(path, { width = 320, height = 180, fps = 10, duration }) {
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

// Builds an audio file made of consecutive fixed-frequency segments -- a "frequency marker tape" --
// so a downstream trim/seek's exact window can be identified unambiguously by which tone(s) it
// contains (band-pass RMS at each candidate frequency), rather than relying on silence timing alone.
function makeMarkerTone(path, segments, { sampleRate = 48000 } = {}) {
  const inputs = segments.flatMap((segment) => ["-f", "lavfi", "-i", `sine=frequency=${segment.frequency}:sample_rate=${sampleRate}:duration=${segment.duration}`]);
  const labels = segments.map((_, index) => `[${index}:a]`).join("");
  ffmpeg([...inputs, "-filter_complex", `${labels}concat=n=${segments.length}:v=0:a=1[out]`, "-map", "[out]", "-c:a", "pcm_s16le", path]);
}

async function makeProject({ duration, audio, sfxSegments, bgmSegments }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-sfx-in-out-test-"));
  makeSilentSourceVideo(join(root, "source.mp4"), { duration });
  await mkdir(join(root, "audio"));
  if (sfxSegments) makeMarkerTone(join(root, "audio", "sfx.wav"), sfxSegments);
  if (bgmSegments) makeMarkerTone(join(root, "audio", "bgm.wav"), bgmSegments);

  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: duration }],
        overlays: [],
        audio,
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("sfx in/out plays only the material's [in,out) window, at t, for (out-in) seconds (real render)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // 5s material: [0,1)=200Hz "before-in" marker (must not appear), [1,2.5)=600Hz "target" (the
  // audible [in,out) window), [2.5,5)=1000Hz "after-out" marker (must not appear).
  const timelineT = 2;
  const project = await makeProject({
    duration: 6,
    audio: { sfx: [{ path: "audio/sfx.wav", t: timelineT, in: 1.0, out: 2.5 }] },
    sfxSegments: [
      { frequency: 200, duration: 1 },
      { frequency: 600, duration: 1.5 },
      { frequency: 1000, duration: 2.5 },
    ],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /atrim=start=1:end=2\.5,asetpts=PTS-STARTPTS/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.3;
    const before = measureBandVolume(outputPath, timelineT - 0.5, window, 600, 400);
    const during = measureBandVolume(outputPath, timelineT + 0.6, window, 600, 400);
    const after = measureBandVolume(outputPath, timelineT + 1.5 + 0.3, window, 600, 400);
    const duringOffMarkerBefore = measureBandVolume(outputPath, timelineT + 0.6, window, 200, 100);
    const duringOffMarkerAfter = measureBandVolume(outputPath, timelineT + 0.6, window, 1000, 100);
    t.diagnostic(
      `600Hz band: before-start=${before}dB during=${during}dB after-end=${after}dB; off-marker bands during window: 200Hz=${duringOffMarkerBefore}dB 1000Hz=${duringOffMarkerAfter}dB`,
    );

    assert.ok(during > before + 15, `expected the target window (${during}dB) far louder than before start=t (${before}dB)`);
    assert.ok(during > after + 15, `expected the target window (${during}dB) far louder than after t+1.5 (${after}dB)`);
    // Wide-tolerance thresholds: ffmpeg's bandpass filter is a gentle 2nd-order biquad (no sharp
    // cutoff), so adjacent 400Hz-spaced markers bleed into each other's band by up to ~15dB. +8dB
    // still cleanly demonstrates dominance (observed gaps were 14.7dB and 20.6dB during authoring).
    assert.ok(during > duringOffMarkerBefore + 8, `expected 600Hz (${during}dB) louder than the 200Hz "before-in" marker band (${duringOffMarkerBefore}dB) during the window -- proves playback starts at material 1.0s, not 0s`);
    assert.ok(during > duringOffMarkerAfter + 8, `expected 600Hz (${during}dB) louder than the 1000Hz "after-out" marker band (${duringOffMarkerAfter}dB) during the window -- proves playback stops at material 2.5s, not later`);

    // Duration: sound should span exactly [t, t+1.5). Verify silence resumes well before t+1.5+gap
    // and content is present just short of t+1.5.
    const justBeforeEnd = measureBandVolume(outputPath, timelineT + 1.5 - 0.35, window, 600, 400);
    assert.ok(justBeforeEnd > after + 15, `expected content still audible just before the 1.5s window ends (${justBeforeEnd}dB) vs after it ends (${after}dB)`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("sfx.in/out omitted keeps the filtergraph free of atrim (regression invariant)", () => {
  const command = buildAudioMixCommand({
    edit: {
      version: 0,
      output: { width: 320, height: 180, fps: 10 },
      audio: { sfx: [{ path: "audio/pop.wav", t: 1, gain_db: -3 }] },
    },
    projectRoot: "/project",
    inputPath: "/project/.akari/render-tmp/composite.mp4",
    outputPath: "/project/.akari/render-tmp/final.mp4",
    duration: 10,
  });
  assert.ok(!command.args.join(" ").includes("atrim=start="), `expected no atrim=start= in args when sfx.in/out are omitted, got: ${command.args.join(" ")}`);
  assert.equal(command.warnings.length, 0);
});

test("sfx.out exceeding the material's real duration clamps to the material's end (real render, no overrun)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const timelineT = 1;
  const materialDuration = 3;
  const project = await makeProject({
    duration: 8,
    audio: { sfx: [{ path: "audio/sfx.wav", t: timelineT, out: materialDuration + 10 }] },
    sfxSegments: [{ frequency: 500, duration: materialDuration }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stderr, /render-cut warning:.*audio\.sfx\[0\]: out 13s exceeds the material duration \(3s\); clamped to 3s/);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.3;
    const during = measureBandVolume(outputPath, timelineT + 1, window, 500, 300);
    const afterClampedEnd = measureBandVolume(outputPath, timelineT + materialDuration + 0.4, window, 500, 300);
    t.diagnostic(`during=${during}dB just-after-clamped-end(t=${timelineT + materialDuration}s)=${afterClampedEnd}dB`);
    assert.ok(during > afterClampedEnd + 15, `expected audible content mid-clip (${during}dB) but silence once past the clamped 3s material end (${afterClampedEnd}dB)`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("sfx.in at/beyond the material's real duration is silently skipped with a warning", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const materialDuration = 3;
  const project = await makeProject({
    duration: 6,
    audio: { sfx: [{ path: "audio/sfx.wav", t: 1, in: materialDuration }] },
    sfxSegments: [{ frequency: 500, duration: materialDuration }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stderr, /render-cut warning:.*audio\.sfx\[0\]: in 3s is at or beyond the material duration \(3s\); skipped \(silent\)/);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.ok(!state.plan.commands.audio_mix.args.includes(join(project, "audio", "sfx.wav")), "expected the skipped sfx's file to never be passed to ffmpeg as an input");

    const outputPath = join(project, state.artifacts[0].path);
    const overall = measureBandVolume(outputPath, 0, 6, 500, 300);
    t.diagnostic(`skipped sfx: overall 500Hz band level=${overall}dB (expect near-silence)`);
    assert.ok(overall < -60, `expected near-silence with the sfx skipped, got ${overall}dB`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("bgm.in seeks the material's internal start offset -- output head content matches material at t=in (real render)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // 5s material in five 1s buckets: 200,400,600,800,1000Hz. bgm.in=3 should make the output's head
  // play the 800Hz bucket (material's 3rd second), not the 200Hz bucket at material t=0.
  const project = await makeProject({
    duration: 4,
    audio: { bgm: { path: "audio/bgm.wav", gain_db: 0, in: 3.0 } },
    bgmSegments: [
      { frequency: 200, duration: 1 },
      { frequency: 400, duration: 1 },
      { frequency: 600, duration: 1 },
      { frequency: 800, duration: 1 },
      { frequency: 1000, duration: 1 },
    ],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /-ss 3 -stream_loop -1/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.3;
    const at800 = measureBandVolume(outputPath, 0.2, window, 800, 300);
    const at200 = measureBandVolume(outputPath, 0.2, window, 200, 100);
    t.diagnostic(`output head: 800Hz(material t=3-4s) band=${at800}dB, 200Hz(material t=0-1s) band=${at200}dB`);
    assert.ok(at800 > at200 + 10, `expected the output head to match the material's 3s-4s content (800Hz=${at800}dB) rather than its start (200Hz=${at200}dB)`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("bgm.in omitted keeps the args free of -ss (regression invariant)", () => {
  const command = buildAudioMixCommand({
    edit: {
      version: 0,
      output: { width: 320, height: 180, fps: 10 },
      audio: { bgm: { path: "audio/bgm.wav", gain_db: -6 } },
    },
    projectRoot: "/project",
    inputPath: "/project/.akari/render-tmp/composite.mp4",
    outputPath: "/project/.akari/render-tmp/final.mp4",
    duration: 10,
  });
  assert.ok(!command.args.includes("-ss"), `expected no -ss in args when bgm.in is omitted, got: ${command.args.join(" ")}`);
  assert.equal(command.warnings.length, 0);
});
