import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

// task 2026-08-07-v1-transition-out: cuts[].transition_out (dissolve / fade-black / fade-white)
// was a silent no-op on the v1 (multi-source, "sources": [...]) render path --
// buildMultiSourceCutCommand never read cut.transition_out at all, so a v1 project that declared
// a dissolve just got a hard cut with no overlap subtracted from predicted_duration_seconds.
// (Found while investigating task 2026-08-07-render-frame-accounting's verify.fps 1-frame drift;
// confirmed unrelated to that bug and reported separately.) This suite pins the fix: v1 now takes
// the same xfade/acrossfade path as v0's buildCutCommand, with the same timeline-overlap math,
// and a v1 project with zero transition_out stays byte-for-byte on today's plain concat call.

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

// Two DISTINCT source files (unlike buildCutCommand's single red-then-blue-concatenated source):
// this is the case buildMultiSourceCutCommand actually adds over v0 -- a transition whose two
// sides come from different sources[] entries, joined only by cuts[].src.
async function makeSources(root, { duration = 3 } = {}) {
  const redPath = join(root, "red.mp4");
  const bluePath = join(root, "blue.mp4");
  ffmpeg(["-f", "lavfi", "-i", `color=c=red:s=64x64:r=10:d=${duration}`, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", redPath]);
  ffmpeg(["-f", "lavfi", "-i", `color=c=blue:s=64x64:r=10:d=${duration}`, "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", bluePath]);
  return { redPath, bluePath };
}

async function makeProject({ cuts, duration = 3 }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-v1-transition-test-"));
  await makeSources(root, { duration });
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 1,
        output: { width: 64, height: 64, fps: 10 },
        sources: [
          { id: "s1", path: "red.mp4", proxy: null },
          { id: "s2", path: "blue.mp4", proxy: null },
        ],
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
  assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings, null, 2));
  return { outputPath: join(project, state.artifacts[0].path), state };
}

test("v1 cuts[].transition_out (dissolve) across two DIFFERENT sources produces a real mid-transition blend and shortens the timeline by the overlap", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // s1 (red, [0,3)) -> s2 (blue, [0,3)), 1s dissolve at the boundary -> predicted 3+3-1=5s,
  // same math as buildCutCommand's sibling test (cut-transition.test.mjs).
  const project = await makeProject({
    cuts: [
      { src: "s1", in: 0, out: 3, transition_out: { type: "dissolve", duration: 1 } },
      { src: "s2", in: 0, out: 3 },
    ],
  });
  try {
    const { outputPath, state } = await renderAndGetOutputPath(project);
    assert.equal(state.plan.predicted_duration_seconds, 5);
    assert.match(state.plan.commands.cut.args.join(" "), /xfade=transition=dissolve:duration=1:offset=2/);
    assert.match(state.plan.commands.cut.args.join(" "), /acrossfade=d=1/);

    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`predicted 5s, ffprobe measured ${actualDuration}s`);
    assert.ok(Math.abs(actualDuration - 5) <= state.plan.duration_tolerance_seconds, `expected ~5s, got ${actualDuration}s`);

    const beforeRgb = averageFrameRgb(outputPath, 1.0);
    const midRgb = averageFrameRgb(outputPath, 2.5);
    const afterRgb = averageFrameRgb(outputPath, 4.5);
    t.diagnostic(`t=1.0s RGB=${JSON.stringify(beforeRgb)}; t=2.5s (mid-transition) RGB=${JSON.stringify(midRgb)}; t=4.5s RGB=${JSON.stringify(afterRgb)}`);

    assert.ok(beforeRgb.r > 200 && beforeRgb.b < 50, `expected pure red before the transition, got ${JSON.stringify(beforeRgb)}`);
    assert.ok(afterRgb.b > 200 && afterRgb.r < 50, `expected pure blue after the transition, got ${JSON.stringify(afterRgb)}`);
    assert.ok(midRgb.r > 60 && midRgb.b > 60, `expected a red/blue blend mid-transition (cross-source dissolve), got ${JSON.stringify(midRgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("v1 cuts[].transition_out (fade-black) passes through black at the transition midpoint", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { src: "s1", in: 0, out: 3, transition_out: { type: "fade-black", duration: 1 } },
      { src: "s2", in: 0, out: 3 },
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

test("v1 cuts[].transition_out (fade-white) passes through white at the transition midpoint", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { src: "s1", in: 0, out: 3, transition_out: { type: "fade-white", duration: 1 } },
      { src: "s2", in: 0, out: 3 },
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

test("v1: a cut boundary with no transition_out stays a hard cut, even when only one of several boundaries has a transition (mixed boundaries)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { src: "s1", in: 0, out: 1.5 },
      { src: "s1", in: 1.5, out: 3, transition_out: { type: "dissolve", duration: 0.5 } },
      { src: "s2", in: 0, out: 3 },
    ],
  });
  try {
    const { outputPath, state } = await renderAndGetOutputPath(project);
    const cutArgs = state.plan.commands.cut.args.join(" ");
    assert.equal((cutArgs.match(/xfade=/g) ?? []).length, 1, cutArgs);
    assert.match(cutArgs, /concat=n=2:v=1:a=1/, "expected the unspecified boundary to still use a plain 2-input concat");

    // s1[0,1.5) + s1[1.5,3) (dissolve 0.5s overlap into s2) + s2[0,3) - 0.5s overlap = 5.5s
    assert.equal(state.plan.predicted_duration_seconds, 5.5);
    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`predicted 5.5s, ffprobe measured ${actualDuration}s`);
    assert.ok(Math.abs(actualDuration - 5.5) <= state.plan.duration_tolerance_seconds, `expected ~5.5s, got ${actualDuration}s`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("v1: cuts without any transition_out keep today's exact single N-input concat call (non-regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    cuts: [
      { src: "s1", in: 0, out: 3 },
      { src: "s2", in: 0, out: 3 },
    ],
  });
  try {
    const { outputPath, state } = await renderAndGetOutputPath(project);
    const cutArgs = state.plan.commands.cut.args.join(" ");
    assert.doesNotMatch(cutArgs, /xfade=/);
    assert.doesNotMatch(cutArgs, /acrossfade=/);
    assert.doesNotMatch(cutArgs, /settb=AVTB/);
    assert.match(cutArgs, /concat=n=2:v=1:a=1\[joinedv\]\[joineda\]/);
    assert.equal(state.plan.predicted_duration_seconds, 6);

    const justBefore = averageFrameRgb(outputPath, 2.9);
    const justAfter = averageFrameRgb(outputPath, 3.1);
    t.diagnostic(`hard cut: t=2.9s RGB=${JSON.stringify(justBefore)}; t=3.1s RGB=${JSON.stringify(justAfter)}`);
    assert.ok(justBefore.r > 200 && justBefore.b < 50, `expected pure red just before the cut, got ${JSON.stringify(justBefore)}`);
    assert.ok(justAfter.b > 200 && justAfter.r < 50, `expected pure blue just after the cut, got ${JSON.stringify(justAfter)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("v0 and v1 agree on predicted_duration_seconds and real frame count for the same transition_out declaration", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // v0: one source, red[0,3) then blue[3,6), 1s dissolve at the boundary.
  const v0Root = await mkdtemp(join(tmpdir(), "render-cut-v0-parity-"));
  const v1Root = await mkdtemp(join(tmpdir(), "render-cut-v1-parity-"));
  try {
    const redPath = join(v0Root, "red.mp4");
    const bluePath = join(v0Root, "blue.mp4");
    ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64:r=10:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", redPath]);
    ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", bluePath]);
    const listPath = join(v0Root, "concat-list.txt");
    const v0SourcePath = join(v0Root, "source.mp4");
    await writeFile(listPath, `file '${redPath}'\nfile '${bluePath}'\n`, "utf8");
    ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", v0SourcePath]);
    await writeFile(
      join(v0Root, "edit.json"),
      `${JSON.stringify(
        {
          version: 0,
          output: { width: 64, height: 64, fps: 10 },
          source: { path: "source.mp4", proxy: null },
          cuts: [
            { in: 0, out: 3, transition_out: { type: "dissolve", duration: 1 } },
            { in: 3, out: 6 },
          ],
          overlays: [],
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(join(v0Root, ".akari"));
    await writeFile(join(v0Root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');

    // v1: the SAME declaration, but split across two sources[] entries instead of one concatenated source.
    await makeSources(v1Root, { duration: 3 });
    await writeFile(
      join(v1Root, "edit.json"),
      `${JSON.stringify(
        {
          version: 1,
          output: { width: 64, height: 64, fps: 10 },
          sources: [
            { id: "s1", path: "red.mp4", proxy: null },
            { id: "s2", path: "blue.mp4", proxy: null },
          ],
          cuts: [
            { src: "s1", in: 0, out: 3, transition_out: { type: "dissolve", duration: 1 } },
            { src: "s2", in: 0, out: 3 },
          ],
          overlays: [],
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(join(v1Root, ".akari"));
    await writeFile(join(v1Root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');

    const { outputPath: v0Output, state: v0State } = await renderAndGetOutputPath(v0Root);
    const { outputPath: v1Output, state: v1State } = await renderAndGetOutputPath(v1Root);

    assert.equal(v0State.plan.predicted_duration_seconds, v1State.plan.predicted_duration_seconds, "v0 and v1 must predict the same overlap-adjusted duration for the same transition_out declaration");

    const v0Duration = ffprobeDuration(v0Output);
    const v1Duration = ffprobeDuration(v1Output);
    t.diagnostic(`v0 measured ${v0Duration}s, v1 measured ${v1Duration}s (predicted ${v0State.plan.predicted_duration_seconds}s)`);
    assert.ok(Math.abs(v0Duration - v1Duration) <= 0.05, `v0 (${v0Duration}s) and v1 (${v1Duration}s) durations diverged for the identical transition_out declaration`);

    assert.equal(v0State.verify.measured.frame_count, v1State.verify.measured.frame_count, "v0 and v1 must decode to the same real frame count for the same transition_out declaration");
  } finally {
    await rm(v0Root, { recursive: true, force: true });
    await rm(v1Root, { recursive: true, force: true });
  }
});
