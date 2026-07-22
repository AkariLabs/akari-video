import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// docs/contract-2026-07-22-render-basics.md #1 (cuts[].speed). L2 measures the theoretical vs
// actual output duration via ffprobe and confirms audio pitch is preserved (atempo, not simple
// resampling) by measuring the dominant tone frequency before/after with ffmpeg's own analysis.

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

function ffprobeDuration(filePath) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}

// Detects the dominant frequency of a mono tone via ffmpeg's astats + a narrow bandpass sweep is
// overkill; instead we use `showfreqs`-free approach: apply a bandpass centered on the *original*
// frequency and compare RMS energy retained. If atempo preserved pitch, most of the tone's energy
// stays inside a narrow band around the original frequency even after the tempo change; if pitch
// had shifted (e.g. naive resampling), energy would shift out of that band.
function bandpassEnergyDb(filePath, centerHz) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", filePath, "-af", `highpass=f=${centerHz - 40},lowpass=f=${centerHz + 40},volumedetect`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  assert.ok(match, `volumedetect did not report mean_volume for ${filePath}: ${result.stderr}`);
  return Number(match[1]);
}

async function makeProject({ sourceDuration = 6, cuts, frequency = 440 }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-speed-test-"));
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x180:rate=10:duration=${sourceDuration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=48000:duration=${sourceDuration}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    join(root, "source.mp4"),
  ]);
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts,
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("cuts[].speed=2 halves the theoretical and actual output duration", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ sourceDuration: 6, cuts: [{ in: 0, out: 6, speed: 2 }] });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.plan.predicted_duration_seconds, 3);

    const outputPath = join(project, state.artifacts[0].path);
    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`speed=2, source 6s -> predicted 3s, ffprobe measured ${actualDuration}s`);
    assert.ok(
      Math.abs(actualDuration - 3) <= state.plan.duration_tolerance_seconds,
      `expected ~3s, measured ${actualDuration}s`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("cuts[].speed=0.5 doubles the theoretical and actual output duration", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ sourceDuration: 3, cuts: [{ in: 0, out: 3, speed: 0.5 }] });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.plan.predicted_duration_seconds, 6);

    const outputPath = join(project, state.artifacts[0].path);
    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`speed=0.5, source 3s -> predicted 6s, ffprobe measured ${actualDuration}s`);
    assert.ok(
      Math.abs(actualDuration - 6) <= state.plan.duration_tolerance_seconds,
      `expected ~6s, measured ${actualDuration}s`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("cuts[].speed=4 (beyond atempo's 2x single-filter cap) chains atempo and still hits the right duration", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ sourceDuration: 8, cuts: [{ in: 0, out: 8, speed: 4 }] });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.plan.predicted_duration_seconds, 2);
    assert.match(state.plan.commands.cut.args.join(" "), /atempo=2,atempo=2/);

    const outputPath = join(project, state.artifacts[0].path);
    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`speed=4, source 8s -> predicted 2s, ffprobe measured ${actualDuration}s`);
    assert.ok(
      Math.abs(actualDuration - 2) <= state.plan.duration_tolerance_seconds,
      `expected ~2s, measured ${actualDuration}s`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("speed changes preserve audio pitch (atempo, not naive resampling): tone energy stays in its original frequency band", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const frequency = 880;
  const project = await makeProject({ sourceDuration: 6, cuts: [{ in: 0, out: 6, speed: 3 }], frequency });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");

    const outputPath = join(project, state.artifacts[0].path);
    const inBandDb = bandpassEnergyDb(outputPath, frequency);
    const outOfBandDb = bandpassEnergyDb(outputPath, frequency * 3); // where naive resampling at 3x would have shifted the tone to
    t.diagnostic(`speed=3, original ${frequency}Hz band mean=${inBandDb}dB; naive-resample-shifted ${frequency * 3}Hz band mean=${outOfBandDb}dB`);
    assert.ok(
      inBandDb > outOfBandDb + 10,
      `expected the tone's energy to remain concentrated at its original ${frequency}Hz (pitch preserved) rather than shifting to ${frequency * 3}Hz; in-band=${inBandDb}dB out-of-band=${outOfBandDb}dB`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("cuts without speed keep today's exact concat pipeline (non-regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ sourceDuration: 4, cuts: [{ in: 0, out: 4 }] });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.doesNotMatch(state.plan.commands.cut.args.join(" "), /atempo/);
    assert.match(state.plan.commands.cut.args.join(" "), /setpts=PTS-STARTPTS\[v0\]/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
