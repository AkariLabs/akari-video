import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// docs/contract-2026-07-22-render-basics.md #3 (cuts[].transition_out). L2 requires proving the
// mid-transition frame is a real blend (frame extraction), and that a boundary with no
// transition_out stays a hard cut (residual decision 3: v0 only takes the xfade path at
// explicitly-specified boundaries).

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

function averageFrameRgb(filePath, atSeconds) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(atSeconds), "-i", filePath, "-frames:v", "1", "-vf", "scale=4:4", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" },
  );
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  const buf = result.stdout;
  const pixelCount = buf.length / 3;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    r += buf[i * 3];
    g += buf[i * 3 + 1];
    b += buf[i * 3 + 2];
  }
  return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount };
}

// Builds a source video whose color changes abruptly partway through (red for the first half,
// blue for the second), so a transition (or hard cut) at that boundary is directly visible as a
// color blend (or its absence) at the seam.
async function makeRedBlueSource(root, { redDuration = 3, blueDuration = 3 } = {}) {
  const path = join(root, "source.mp4");
  const redPath = join(root, "red.mp4");
  const bluePath = join(root, "blue.mp4");
  // Includes a (silent-adjacent) tone track so hasAudio=true exercises the acrossfade path too,
  // not just xfade's video path.
  ffmpeg(["-f", "lavfi", "-i", `color=c=red:s=64x64:r=10:d=${redDuration}`, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${redDuration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", redPath]);
  ffmpeg(["-f", "lavfi", "-i", `color=c=blue:s=64x64:r=10:d=${blueDuration}`, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${blueDuration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", bluePath]);
  const listPath = join(root, "concat-list.txt");
  await writeFile(listPath, `file '${redPath}'\nfile '${bluePath}'\n`, "utf8");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", path]);
  return path;
}

async function makeProject({ cuts, redDuration = 3, blueDuration = 3 }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-transition-test-"));
  await makeRedBlueSource(root, { redDuration, blueDuration });
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 64, height: 64, fps: 10 },
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

async function renderAndGetOutputPath(project) {
  const executed = run(project);
  assert.equal(executed.status, 0, executed.stderr);
  const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
  assert.equal(state.verify.verdict, "pass");
  return { outputPath: join(project, state.artifacts[0].path), state };
}

test("cuts[].transition_out (dissolve) produces a real mid-transition blend and shortens the timeline by the overlap", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // Red [0,3), blue [3,6) source; cut boundary at 3s with a 1s dissolve -> predicted duration
  // 3 + 3 - 1 = 5s. The transition spans [2,3) in the output timeline (ends 1s before the
  // boundary's accumulated position).
  const project = await makeProject({
    cuts: [
      { in: 0, out: 3, transition_out: { type: "dissolve", duration: 1 } },
      { in: 3, out: 6 },
    ],
    redDuration: 3,
    blueDuration: 3,
  });
  try {
    const { outputPath, state } = await renderAndGetOutputPath(project);
    assert.equal(state.plan.predicted_duration_seconds, 5);
    assert.match(state.plan.commands.cut.args.join(" "), /xfade=transition=dissolve:duration=1:offset=2/);

    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`predicted 5s, ffprobe measured ${actualDuration}s`);
    assert.ok(Math.abs(actualDuration - 5) <= state.plan.duration_tolerance_seconds, `expected ~5s, got ${actualDuration}s`);

    const beforeRgb = averageFrameRgb(outputPath, 1.0);
    const midRgb = averageFrameRgb(outputPath, 2.5);
    const afterRgb = averageFrameRgb(outputPath, 4.5);
    t.diagnostic(`t=1.0s RGB=${JSON.stringify(beforeRgb)}; t=2.5s (mid-transition) RGB=${JSON.stringify(midRgb)}; t=4.5s RGB=${JSON.stringify(afterRgb)}`);

    assert.ok(beforeRgb.r > 200 && beforeRgb.b < 50, `expected pure red before the transition, got ${JSON.stringify(beforeRgb)}`);
    assert.ok(afterRgb.b > 200 && afterRgb.r < 50, `expected pure blue after the transition, got ${JSON.stringify(afterRgb)}`);
    // A real dissolve blend at the midpoint has both red and blue present, unlike a hard cut
    // (which would show only one or the other depending on exactly which side of the cut t=2.5s lands on).
    assert.ok(midRgb.r > 60 && midRgb.b > 60, `expected a red/blue blend mid-transition, got ${JSON.stringify(midRgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("cuts[].transition_out (fade-black) passes through black at the transition midpoint", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { in: 0, out: 3, transition_out: { type: "fade-black", duration: 1 } },
      { in: 3, out: 6 },
    ],
  });
  try {
    const { outputPath } = await renderAndGetOutputPath(project);
    const midRgb = averageFrameRgb(outputPath, 2.5);
    t.diagnostic(`fade-black mid-transition (t=2.5s) RGB=${JSON.stringify(midRgb)}`);
    assert.ok(midRgb.r < 140 && midRgb.g < 140 && midRgb.b < 140, `expected a darkened frame near the fade-black midpoint, got ${JSON.stringify(midRgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("cuts[].transition_out (fade-white) passes through white at the transition midpoint", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { in: 0, out: 3, transition_out: { type: "fade-white", duration: 1 } },
      { in: 3, out: 6 },
    ],
  });
  try {
    const { outputPath } = await renderAndGetOutputPath(project);
    const midRgb = averageFrameRgb(outputPath, 2.5);
    t.diagnostic(`fade-white mid-transition (t=2.5s) RGB=${JSON.stringify(midRgb)}`);
    assert.ok(midRgb.r > 150 && midRgb.g > 150 && midRgb.b > 150, `expected a brightened frame near the fade-white midpoint, got ${JSON.stringify(midRgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a cut boundary with no transition_out stays a hard cut, even in a 3-cut project where only one boundary has a transition (mixed boundaries)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // Red [0,3) -> blue [3,6) source, reused twice: cuts[0..1] boundary gets a dissolve, but this
  // fixture only has 2 distinct colors, so we instead build 3 cuts against a red/blue/red-again
  // pattern is unnecessary -- the key property under test is that the *unspecified* boundary
  // (here, cuts[1]->cuts[2] since we only add 2 cuts) behaves identically to the pre-existing
  // concat path. We validate this by comparing the command plan: only the specified boundary's
  // filter uses xfade; nothing else in the graph does.
  const project = await makeProject({
    cuts: [
      { in: 0, out: 1.5 },
      { in: 1.5, out: 3, transition_out: { type: "dissolve", duration: 0.5 } },
      { in: 0, out: 3 },
    ],
  });
  try {
    const { outputPath, state } = await renderAndGetOutputPath(project);
    const cutArgs = state.plan.commands.cut.args.join(" ");
    // Exactly one xfade call (for the specified boundary); the other boundary (cuts[0]->cuts[1])
    // must still be a concat=n=2 call, not a second xfade.
    assert.equal((cutArgs.match(/xfade=/g) ?? []).length, 1, cutArgs);
    assert.match(cutArgs, /concat=n=2:v=1:a=1/, "expected the unspecified boundary to still use a plain 2-input concat");

    // cuts[0] (1.5s) + cuts[1] (1.5s, dissolve 0.5s overlap into cuts[2]) + cuts[2] (3s) - 0.5s overlap = 5.5s
    assert.equal(state.plan.predicted_duration_seconds, 5.5);
    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`predicted 5.5s, ffprobe measured ${actualDuration}s`);
    assert.ok(Math.abs(actualDuration - 5.5) <= state.plan.duration_tolerance_seconds, `expected ~5.5s, got ${actualDuration}s`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("cuts without any transition_out keep today's exact single N-input concat call (non-regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { in: 0, out: 3 },
      { in: 3, out: 6 },
    ],
  });
  try {
    const { outputPath, state } = await renderAndGetOutputPath(project);
    const cutArgs = state.plan.commands.cut.args.join(" ");
    assert.doesNotMatch(cutArgs, /xfade=/);
    assert.doesNotMatch(cutArgs, /acrossfade=/);
    assert.match(cutArgs, /concat=n=2:v=1:a=1\[joinedv\]\[joineda\]/);
    assert.equal(state.plan.predicted_duration_seconds, 6);

    // A hard cut at t=3s: the frame just before must be pure red, just after pure blue, with no blend.
    const justBefore = averageFrameRgb(outputPath, 2.9);
    const justAfter = averageFrameRgb(outputPath, 3.1);
    t.diagnostic(`hard cut: t=2.9s RGB=${JSON.stringify(justBefore)}; t=3.1s RGB=${JSON.stringify(justAfter)}`);
    assert.ok(justBefore.r > 200 && justBefore.b < 50, `expected pure red just before the cut, got ${JSON.stringify(justBefore)}`);
    assert.ok(justAfter.b > 200 && justAfter.r < 50, `expected pure blue just after the cut, got ${JSON.stringify(justAfter)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
