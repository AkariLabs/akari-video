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
import { computeCutTimelineOffsets } from "../src/cut-timeline.mjs";

// task 2026-08-07-captions-linear-timeline: generateCaptionOverlays's v1 (multi-source) path used
// to compute cut-boundary offsets via its own naive additive cuts.reduce() (the "linearTimeline"
// branch inside computeCaptionRanges), instead of the shared computeCutTimelineOffsets used
// everywhere else transition_out overlap matters (buildCutCommand / buildMultiSourceCutCommand /
// predictedDuration). transition_out on the v1 path was itself a no-op before task
// 2026-08-07-v1-transition-out, so this was invisible until that fix landed -- at which point a
// v1 project with any transition_out gets a video timeline that correctly shrinks by the overlap,
// but captions.json-derived overlays that stayed on the OLD, unshrunk timeline. Concretely: this
// pushed captionsEnd past cutsEnd, so computeContentDurationSeconds picked captionsEnd and
// buildTailPadCommand appended black tail padding after the real content, while every caption
// after the first transition boundary rendered up to one transition_out.duration late relative to
// the (now correctly shrunk) video.

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

// s1 (red, [0,2)) -> s2 (blue, [0,2)), a real caption entirely on s2 (source [0,2)), rendered
// with an opaque white block-mode background plate large enough to dominate a coarse average --
// same red/blue-distinguishing assay cut-transition.test.mjs and v1-transition-out.test.mjs use
// for dissolve detection, applied here to detect caption *presence* instead.
async function makeProject(root, { withTransition }) {
  const redPath = join(root, "red.mp4");
  const bluePath = join(root, "blue.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64:r=10:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", redPath]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", bluePath]);

  const firstCut = withTransition
    ? { src: "s1", in: 0, out: 2, transition_out: { type: "dissolve", duration: 0.5 } }
    : { src: "s1", in: 0, out: 2 };

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
        cuts: [firstCut, { src: "s2", in: 0, out: 2 }],
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, "captions.json"),
    `${JSON.stringify(
      [
        {
          id: "c-blue",
          src: "s2",
          start: 0,
          end: 2,
          text: "TEST",
          text_style: {
            background: { color: "#ffffff", opacity: 1, mode: "block", width_pct: 400, height_pct: 400 },
          },
        },
      ],
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
}

test("generateCaptionOverlays: v1 caption position shrinks by transition_out overlap, matching computeCutTimelineOffsets", () => {
  const cuts = [
    { src: "s1", in: 0, out: 2, transition_out: { type: "dissolve", duration: 0.5 } },
    { src: "s2", in: 0, out: 2 },
  ];
  const captions = [{ id: "c-blue", src: "s2", start: 0, end: 2, text: "TEST" }];
  const overlays = generateCaptionOverlays(captions, cuts, { sourceCount: 2 });
  assert.equal(overlays.length, 1);
  const expectedOffsets = computeCutTimelineOffsets(cuts);
  assert.equal(overlays[0].start, expectedOffsets[1].start, "caption start must match the shrunk cut1 offset, not the naive additive sum");
  assert.equal(overlays[0].start, 1.5, "cut0 (2s) + cut1 start, minus the 0.5s dissolve overlap = 1.5s");
  assert.equal(overlays[0].duration, 2);
});

test("generateCaptionOverlays: v1 caption position is unchanged when no transition_out is present (non-regression)", () => {
  const cuts = [
    { src: "s1", in: 0, out: 2 },
    { src: "s2", in: 0, out: 2 },
  ];
  const captions = [{ id: "c-blue", src: "s2", start: 0, end: 2, text: "TEST" }];
  const overlays = generateCaptionOverlays(captions, cuts, { sourceCount: 2 });
  assert.equal(overlays[0].start, 2, "no transition_out: cut1 starts exactly where cut0 (2s) ends");
});

test("full render: v1 + transition_out no longer appends black tail padding, and the caption appears at the corrected (earlier) time", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await mkdtemp(join(tmpdir(), "captions-linear-timeline-"));
  try {
    await makeProject(project, { withTransition: true });
    const executed = run(project);
    if (executed.status !== 0 && /all overlay rasterizers failed/u.test(executed.stderr)) {
      return t.skip("sandbox environment cannot launch an overlay rasterizer");
    }
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));

    // predicted_duration_seconds must match cutsEnd (3.5s = 2 + 2 - 0.5 overlap), not the
    // buggy captionsEnd (would have been 4.0s: naive cut1 start 2.0 + caption duration 2.0).
    assert.equal(state.plan.predicted_duration_seconds, 3.5, "captionsEnd must no longer exceed the transition-shrunk cutsEnd");

    const outputPath = join(project, state.artifacts[0].path);
    const actualDuration = ffprobeDuration(outputPath);
    t.diagnostic(`predicted 3.5s, ffprobe measured ${actualDuration}s`);
    assert.ok(Math.abs(actualDuration - 3.5) <= state.plan.duration_tolerance_seconds, `expected ~3.5s (no black tail pad), got ${actualDuration}s`);

    // Last frame must be real blue content (cut1's tail), not the black tail-pad this bug used to add.
    const lastFrameRgb = averageFrameRgb(outputPath, 3.4);
    t.diagnostic(`t=3.4s (near the end) RGB=${JSON.stringify(lastFrameRgb)}`);
    const isBlack = lastFrameRgb.r < 40 && lastFrameRgb.g < 40 && lastFrameRgb.b < 40;
    assert.ok(!isBlack, `expected non-black content near the end, got ${JSON.stringify(lastFrameRgb)}`);

    // The caption ("TEST" with an opaque white block background) must be visible at t=1.7s --
    // inside the CORRECT range [1.5, 3.5) but *before* the OLD buggy range [2.0, 4.0) would have
    // started. A frame with meaningfully whiter-than-pure-blue average confirms the plate is
    // already showing this early.
    const captionEarlyRgb = averageFrameRgb(outputPath, 1.7);
    t.diagnostic(`t=1.7s (correct-only window) RGB=${JSON.stringify(captionEarlyRgb)}`);
    assert.ok(
      captionEarlyRgb.r > 80 && captionEarlyRgb.g > 80,
      `expected the caption's white plate to already be visible at t=1.7s (corrected timing), got ${JSON.stringify(captionEarlyRgb)}`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("full render: v1 without transition_out keeps the caption at its original position (non-regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await mkdtemp(join(tmpdir(), "captions-linear-timeline-noxfade-"));
  try {
    await makeProject(project, { withTransition: false });
    const executed = run(project);
    if (executed.status !== 0 && /all overlay rasterizers failed/u.test(executed.stderr)) {
      return t.skip("sandbox environment cannot launch an overlay rasterizer");
    }
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));

    assert.equal(state.plan.predicted_duration_seconds, 4, "no transition_out: cutsEnd = captionsEnd = 2 + 2");
    const outputPath = join(project, state.artifacts[0].path);
    const actualDuration = ffprobeDuration(outputPath);
    assert.ok(Math.abs(actualDuration - 4) <= state.plan.duration_tolerance_seconds, `expected ~4s, got ${actualDuration}s`);

    // Before the (would-be) cut1 boundary at t=2.0, the caption must NOT be showing yet.
    const beforeRgb = averageFrameRgb(outputPath, 1.7);
    t.diagnostic(`t=1.7s (still cut0, no transition) RGB=${JSON.stringify(beforeRgb)}`);
    assert.ok(beforeRgb.r > 200 && beforeRgb.b < 50, `expected plain red (no caption yet), got ${JSON.stringify(beforeRgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
