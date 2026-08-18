// docs/contract-2026-08-18-v1-render-parity.md: real-ffmpeg acceptance evidence for task
// 2026-08-18-v1-render-parity. v1 (sources[]) cuts[].at / cuts[].track now reach a gap-aware
// render path under the default track order (the common case a UI drag actually writes -- see
// plan.mjs's buildGapAwareMultiSourceCutCommand and buildPlan's v1 dispatch). This file exercises
// the full CLI pipeline (edit.json -> render-cut.mjs -> real ffmpeg), matching v1-multi-source.test.mjs's
// harness style, and checks the task's three required real-render measurements:
//   (a) an at-gap v1 project's output duration and each cut's on-screen appearance time match the
//       declaration within one frame
//   (b) a track:1 PiP cut actually composites on screen (its pixels differ from the base track's
//       own content at the same point)
//   (c) an existing at/track-less v1 project renders through the exact unchanged legacy path
//       (non-regression)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 10;

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
      "-hide_banner", "-loglevel", "error",
      "-ss", String(time), "-i", path,
      "-frames:v", "1",
      "-vf", "crop=1:1:(iw-1)/2:(ih-1)/2,format=rgb24",
      "-f", "rawvideo", "pipe:1",
    ],
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

function isColor({ r, g, b }, expected) {
  if (expected === "red") return r > 200 && g < 60 && b < 60;
  if (expected === "blue") return b > 200 && r < 60 && g < 60;
  // ffmpeg's named "green" is the CSS/X11 dark green (0,128,0), not (0,255,0) -- same threshold as
  // track-compose.test.mjs's assertColor (g > 100).
  if (expected === "green") return g > 100 && r < 60 && b < 60;
  if (expected === "magenta") return r > 200 && b > 200 && g < 60;
  if (expected === "black") return r < 30 && g < 30 && b < 30;
  throw new Error(`unknown color ${expected}`);
}

async function makeSource(path, { color, size = "320x180", frequency = 440, duration }) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=${color}:s=${size}:r=${FPS}:d=${duration}`,
      "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

async function makeProject({ sources, cuts }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-v1-track-parity-"));
  for (const source of sources) {
    await makeSource(join(root, source.file), source);
  }
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 1,
        output: { width: 320, height: 180, fps: FPS },
        sources: sources.map((source) => ({ id: source.id, path: source.file, proxy: null })),
        cuts,
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

test("(a) v1 at-gap: output duration and each cut's appearance time match the declaration within one frame", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    sources: [
      { id: "a", file: "a.mp4", color: "red", frequency: 440, duration: 2 },
      { id: "b", file: "b.mp4", color: "blue", frequency: 880, duration: 2 },
    ],
    cuts: [
      // track 0, sequential: a plays [0,1), then an explicit 2s gap, then b plays [3,4).
      { src: "a", in: 0, out: 1, at: 0, track: 0 },
      { src: "b", in: 0, out: 1, at: 3, track: 0 },
    ],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const outputPath = join(project, state.plan.output);

    const measuredDuration = Number(ffprobe(outputPath).format.duration);
    const frame = 1 / FPS;
    assert.ok(Math.abs(measuredDuration - 4) <= frame, `duration=${measuredDuration}, expected 4s ±${frame}s`);

    // cut a occupies its declared [0,1) window.
    assert.ok(isColor(sampleCenterRgb(outputPath, 0.5), "red"), "expected red during a's [0,1) window");
    // the declared gap [1,3) shows nothing (black filler), not a's or b's content leaking in.
    assert.ok(isColor(sampleCenterRgb(outputPath, 2.0), "black"), "expected black during the declared gap");
    // cut b must NOT have appeared yet just before its declared at=3 (within one frame).
    assert.ok(isColor(sampleCenterRgb(outputPath, 3 - 1.5 * frame), "black"), "b appeared before its declared at");
    // cut b must appear at its declared at=3 within one frame.
    assert.ok(isColor(sampleCenterRgb(outputPath, 3 + 1.5 * frame), "blue"), "b did not appear at its declared at");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("(b) v1 track:1 PiP under the default track order actually composites on screen", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    sources: [
      { id: "base", file: "base.mp4", color: "green", frequency: 440, duration: 3 },
      { id: "pip", file: "pip.mp4", color: "magenta", frequency: 1200, duration: 1 },
    ],
    cuts: [
      { src: "base", in: 0, out: 3, at: 0, track: 0 },
      // no timeline.tracks declared -- this is the default order (usesDefaultTrackOrder), the
      // realistic case for a UI-authored PiP drag. Centered (x=0,y=0 offsets default to centered).
      { src: "pip", in: 0, out: 1, at: 1, track: 1, transform: { scale: 0.3 } },
    ],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const outputPath = join(project, state.plan.output);

    // Before the PiP's window: base track alone, unaffected ("下段"'s own appearance).
    const lowerLayerAlone = sampleCenterRgb(outputPath, 0.5);
    assert.ok(isColor(lowerLayerAlone, "green"), `expected base green before PiP window: ${JSON.stringify(lowerLayerAlone)}`);

    // During the PiP's declared [1,2) window: the composited frame's center (where the centered,
    // scaled-down PiP clip lands) must show the PiP's own pixels, differing from what the lower
    // (base) track alone showed at the same sample point.
    const duringPip = sampleCenterRgb(outputPath, 1.5);
    assert.ok(isColor(duringPip, "magenta"), `expected PiP magenta during its window: ${JSON.stringify(duringPip)}`);
    assert.notDeepEqual(duringPip, lowerLayerAlone, "PiP region pixels must differ from the lower layer's own appearance");

    // After the PiP's window: back to the base track alone.
    const afterPip = sampleCenterRgb(outputPath, 2.5);
    assert.ok(isColor(afterPip, "green"), `expected base green after PiP window: ${JSON.stringify(afterPip)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("(c) v1 non-regression: an at/track-less project still takes the exact legacy concat path", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    sources: [
      { id: "a", file: "a.mp4", color: "red", frequency: 440, duration: 2 },
      { id: "b", file: "b.mp4", color: "blue", frequency: 880, duration: 2 },
    ],
    cuts: [
      { src: "a", in: 0, out: 1 },
      { src: "b", in: 0, out: 1 },
    ],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const outputPath = join(project, state.plan.output);

    const filterComplex = state.plan.commands.cut.args[state.plan.commands.cut.args.indexOf("-filter_complex") + 1];
    // Byte-for-byte the same dispatch as before this task: plain N-input concat, no gap-aware
    // markers (no black filler, no gap-aware "gv1_" labels).
    assert.match(filterComplex, /concat=n=2:v=1:a=1\[joinedv\]\[joineda\]/);
    assert.ok(!filterComplex.includes("color=c=black"), "at/track-less v1 must not take the gap-aware black-filler path");
    assert.ok(!filterComplex.includes("[gv1_"), "at/track-less v1 must not take the gap-aware run-labeled path");

    const measuredDuration = Number(ffprobe(outputPath).format.duration);
    assert.ok(Math.abs(measuredDuration - 2) <= 1 / FPS, `duration=${measuredDuration}, expected 2s`);
    assert.ok(isColor(sampleCenterRgb(outputPath, 0.5), "red"));
    assert.ok(isColor(sampleCenterRgb(outputPath, 1.5), "blue"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// docs/contract-2026-08-18-v1-render-parity.md: owner's real-project shape (受け入れ条件, task
// 2026-08-18-v1-render-parity) -- v1, all still-image sources, an explicit at-gap, and an audio
// clip. Export duration and each still's on-screen timing must match the timeline declaration.
test("v1 owner-project-equivalent fixture: all-still-image sources + at-gap + an audio clip export to the declared timeline", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-v1-still-image-parity-"));
  try {
    for (const [file, color] of [["img1.png", "red"], ["img2.png", "blue"]]) {
      const made = spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=${color}:s=320x180`,
        "-frames:v", "1", join(root, file),
      ], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
    }
    const clip = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.4",
      "-c:a", "aac", join(root, "clip.m4a"),
    ], { encoding: "utf8" });
    assert.equal(clip.status, 0, clip.stderr);

    await mkdir(join(root, ".akari"));
    await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    await writeFile(
      join(root, "edit.json"),
      `${JSON.stringify(
        {
          version: 1,
          output: { width: 320, height: 180, fps: FPS },
          sources: [
            { id: "img1", path: "img1.png", proxy: null },
            { id: "img2", path: "img2.png", proxy: null },
          ],
          cuts: [
            { src: "img1", in: 0, out: 1, at: 0, track: 0 },
            // 1s gap [1,2) between the two stills, exactly like an at-gap between two clips.
            { src: "img2", in: 0, out: 1, at: 2, track: 0 },
          ],
          audio: { sfx: [{ path: "clip.m4a", t: 0.5 }] },
          overlays: [],
        },
        null,
        2,
      )}\n`,
    );

    const executed = run(root);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const outputPath = join(root, state.plan.output);

    const measuredDuration = Number(ffprobe(outputPath).format.duration);
    const frame = 1 / FPS;
    assert.ok(Math.abs(measuredDuration - 3) <= frame, `duration=${measuredDuration}, expected 3s ±${frame}s`);
    assert.ok(isColor(sampleCenterRgb(outputPath, 0.5), "red"), "img1 should be showing in [0,1)");
    assert.ok(isColor(sampleCenterRgb(outputPath, 1.5), "black"), "the declared [1,2) gap should be black filler");
    assert.ok(isColor(sampleCenterRgb(outputPath, 2.5), "blue"), "img2 should be showing in [2,3)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
