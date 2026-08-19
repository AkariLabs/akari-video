import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

// docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing: static crop / scale keyframes).
// L1 requires a real render + pixel/frame measurement, not just a command-plan string match.

import { hasCutFraming, hasUsableFraming } from "../src/cut-framing.mjs";
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

// A 320x180 canvas with a single 40x40 white square centered at (160, 90) against black. A
// framing zoom centered on the default (cx, cy) = (0.5, 0.5) keeps the square centered while its
// measured on-screen size scales exactly with the declared `scale` -- this makes the zoom factor
// directly recoverable from a frame's bright-pixel bounding box, without needing a reference LUT
// or per-pixel golden image.
async function makeSquareSource(root, { duration = 4 } = {}) {
  const path = join(root, "square.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=320x180:r=10:d=${duration}`,
    "-vf", "drawbox=x=140:y=70:w=40:h=40:color=white:t=fill",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ]);
  return path;
}

function grayFrame(path, atSeconds) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", path, "-ss", String(atSeconds), "-frames:v", "1", "-vf", "format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer" },
  );
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  return result.stdout;
}

// The bounding box of pixels brighter than `threshold` in a 320x180 grayscale frame.
function brightBoundingBox(path, atSeconds, { width = 320, height = 180, threshold = 128 } = {}) {
  const data = grayFrame(path, atSeconds);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

test("cuts[].framing detection: crop / keyframes are usable, absent/degenerate values are not", () => {
  assert.equal(hasUsableFraming(undefined), false);
  assert.equal(hasUsableFraming(null), false);
  assert.equal(hasUsableFraming({}), false);
  assert.equal(hasUsableFraming({ crop: { x: 0, y: 0, w: 1, h: 1 } }), true);
  assert.equal(hasUsableFraming({ keyframes: [{ t: 0, scale: 1 }] }), false, "a single keyframe point has no zoom to express");
  assert.equal(hasUsableFraming({ keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 2 }] }), true);
  assert.equal(hasCutFraming([{ in: 0, out: 1 }, { in: 1, out: 2, framing: { crop: { x: 0, y: 0, w: 0.5, h: 0.5 } } }]), true);
  assert.equal(hasCutFraming([{ in: 0, out: 1 }]), false);
});

test("cuts[].framing.crop: the output frame shows exactly the declared output-relative window, rescaled to fill the canvas", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-framing-crop-"));
  try {
    const sourcePath = await makeSquareSource(root);
    const cutPath = join(root, "cut.mp4");
    // Crop the center half of the canvas (x/y/w/h all 0.25..0.75) and rescale it up: the 40x40
    // square, originally 1/8 of the frame's width, should now appear twice as large (80x80) and
    // still centered, since the crop window is itself centered on the square.
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{ in: 0, out: 3, framing: { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 3,
      projectRoot: root,
    });
    run(command.command, command.args);

    const bbox = brightBoundingBox(cutPath, 1.0);
    t.diagnostic(`bbox=${JSON.stringify(bbox)}`);
    assert.ok(bbox, "expected the square to still be visible after cropping");
    assert.ok(Math.abs(bbox.w - 80) <= 2, `expected an ~80px-wide square (2x magnification), got ${bbox.w}`);
    assert.ok(Math.abs(bbox.h - 80) <= 2, `expected an ~80px-tall square (2x magnification), got ${bbox.h}`);
    assert.ok(Math.abs((bbox.minX + bbox.maxX) / 2 - 160) <= 3, `expected the square to stay horizontally centered, got center x=${(bbox.minX + bbox.maxX) / 2}`);
    assert.ok(Math.abs((bbox.minY + bbox.maxY) / 2 - 90) <= 3, `expected the square to stay vertically centered, got center y=${(bbox.minY + bbox.maxY) / 2}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].framing.keyframes (2 points): the zoom factor at start/mid/end matches the linear interpolation theoretical value within 5%", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-framing-zoom-"));
  try {
    const sourcePath = await makeSquareSource(root, { duration: 4 });
    const cutPath = join(root, "cut.mp4");
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{ in: 0, out: 4, framing: { keyframes: [{ t: 0, scale: 1 }, { t: 4, scale: 2 }] } }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 4,
      projectRoot: root,
    });
    run(command.command, command.args);

    const start = brightBoundingBox(cutPath, 0.0);
    const mid = brightBoundingBox(cutPath, 2.0);
    const end = brightBoundingBox(cutPath, 3.9);
    t.diagnostic(`start.w=${start.w} mid.w=${mid.w} end.w=${end.w}`);

    const startScale = start.w / 40;
    const midScale = mid.w / 40;
    const endScale = end.w / 40;
    // Theoretical: scale(t) = 1 + (2-1)*t/4 -> scale(0)=1, scale(2)=1.5, scale(3.9)~1.975
    assert.ok(Math.abs(startScale - 1) <= 0.05, `expected start scale ~1.0, got ${startScale}`);
    assert.ok(Math.abs(midScale - 1.5) <= 1.5 * 0.05, `expected mid scale ~1.5 (+/-5%), got ${midScale}`);
    assert.ok(Math.abs(endScale - 1.975) <= 1.975 * 0.05, `expected end scale ~1.975 (+/-5%), got ${endScale}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].framing.keyframes (3 points): a staged shrink shows two distinct linear stages", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-framing-stagedshrink-"));
  try {
    const sourcePath = await makeSquareSource(root, { duration: 4 });
    const cutPath = join(root, "cut.mp4");
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{
        in: 0,
        out: 4,
        framing: { keyframes: [{ t: 0, scale: 3 }, { t: 2, scale: 2 }, { t: 4, scale: 1 }] },
      }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 4,
      projectRoot: root,
    });
    run(command.command, command.args);

    const scaleAt = (t) => brightBoundingBox(cutPath, t).w / 40;
    const s0 = scaleAt(0.0);
    const s1 = scaleAt(1.0);
    const s2 = scaleAt(2.0);
    const s3 = scaleAt(3.0);
    t.diagnostic(`scales: t0=${s0} t1=${s1} t2=${s2} t3=${s3}`);

    // Stage 1 (t in [0,2]): 3 -> 2, linear -> midpoint (t=1) is 2.5.
    assert.ok(Math.abs(s0 - 3) <= 0.15, `expected scale(0)~3, got ${s0}`);
    assert.ok(Math.abs(s1 - 2.5) <= 0.15, `expected scale(1)~2.5 (stage 1 midpoint), got ${s1}`);
    assert.ok(Math.abs(s2 - 2) <= 0.15, `expected scale(2)~2 (keyframe boundary), got ${s2}`);
    // Stage 2 (t in [2,4]): 2 -> 1, linear -> midpoint (t=3) is 1.5.
    assert.ok(Math.abs(s3 - 1.5) <= 0.15, `expected scale(3)~1.5 (stage 2 midpoint), got ${s3}`);
    // The two stages have different slopes (-0.5/s then -0.5/s over different keyframe spacing
    // is coincidentally the same rate here, so instead assert the shape directly: shrinking
    // monotonically across both stages, never reversing.
    assert.ok(s0 > s1 && s1 > s2 && s2 > s3, "expected a monotonic shrink across both stages");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].framing combined with output.look (mono LUT) does not break -- grayscale and shrink both apply", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-framing-lut-combo-"));
  try {
    const sourcePath = await makeSquareSource(root, { duration: 4 });
    const cutPath = join(root, "cut.mp4");
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{ in: 0, out: 4, framing: { keyframes: [{ t: 0, scale: 2 }, { t: 4, scale: 1 }] } }],
      width: 320,
      height: 180,
      fps: 10,
      hasAudio: false,
      duration: 4,
      projectRoot: root,
      look: { lut: "mono", intensity: 1 },
    });
    run(command.command, command.args);

    const rgbFrame = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", cutPath, "-ss", "1.0", "-frames:v", "1", "-vf", "format=rgb24", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { encoding: "buffer" },
    );
    assert.equal(rgbFrame.status, 0, rgbFrame.stderr.toString("utf8"));
    const buf = rgbFrame.stdout;
    let grayscaleMismatches = 0;
    for (let i = 0; i < buf.length / 3; i += 997) {
      const r = buf[i * 3];
      const g = buf[i * 3 + 1];
      const b = buf[i * 3 + 2];
      if (Math.abs(r - g) > 3 || Math.abs(g - b) > 3) grayscaleMismatches += 1;
    }
    assert.equal(grayscaleMismatches, 0, "expected the mono LUT to keep every sampled pixel grayscale");

    const start = brightBoundingBox(cutPath, 0.0);
    const end = brightBoundingBox(cutPath, 3.9);
    t.diagnostic(`start.w=${start.w} end.w=${end.w}`);
    assert.ok(start.w > end.w, "expected the framing shrink to still take effect alongside the LUT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// End-to-end: the same feature exercised through the CLI (edit.json -> render-cut.mjs), so the
// schema field flows through render-cut's plan/execute path exactly as an authored project would.
async function makeFramingProject(root) {
  const sourcePath = await makeSquareSource(root, { duration: 3 });
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "square.mp4", proxy: null },
        cuts: [{ in: 0, out: 3, framing: { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } }],
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return sourcePath;
}

test("end-to-end: cuts[].framing.crop declared in edit.json renders through the render-cut CLI", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = mkdtempSync(join(tmpdir(), "render-cut-framing-e2e-"));
  try {
    await makeFramingProject(root);
    const executed = runCli(root);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.plan.predicted_duration_seconds, 3);

    const outputPath = join(root, state.artifacts[0].path);
    const bbox = brightBoundingBox(outputPath, 1.0);
    assert.ok(bbox, "expected the cropped-and-rescaled square to be visible");
    assert.ok(Math.abs(bbox.w - 80) <= 3, `expected the crop to double the square's apparent size, got w=${bbox.w}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
