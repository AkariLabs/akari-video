import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { renderFrameAt } from "../src/frame-at.mjs";
import { projectRendererCompatibilityEdit, readRenderEdit } from "../src/internal-render.mjs";
import { findChromePath, loadCaptions, loadOverlays, renderProject } from "../src/render-cut.mjs";
import { generateCaptureFixture } from "./fixtures/capture-parity/generate.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "capture-parity");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const ffprobe = process.env.FFPROBE ?? "ffprobe";

// This is an L1 real-render test. It runs only when ffmpeg/ffprobe and render-cut's production
// Chrome launch route are all usable. The skip reason names the missing prerequisite explicitly;
// CI with those tools installed executes the complete pixel comparison.
test("renderFrameAt matches a CRF-0 render-cut frame with captions, overlay, layer, FX, and three cuts", { timeout: 300_000 }, async (t) => {
  const unavailable = await productionToolUnavailable();
  if (unavailable) return t.skip(unavailable);
  const project = await mkdtemp(join(tmpdir(), "capture-parity-"));
  try {
    await copyFile(join(fixtureRoot, "edit.json"), join(project, "edit.json"));
    await copyFile(join(fixtureRoot, "captions.json"), join(project, "captions.json"));
    await copyFile(join(fixtureRoot, "overlay.html"), join(project, "overlay.html"));
    await generateCaptureFixture(project, { ffmpeg });
    const editText = await readFile(join(project, "edit.json"), "utf8");
    const parsedEdit = JSON.parse(editText);
    const compatibility = readRenderEdit(editText, join(project, ".akari", "render-tmp"));
    const edit = projectRendererCompatibilityEdit(parsedEdit, compatibility.internal, join(project, ".akari", "render-tmp"));
    const captions = await loadCaptions(project, edit);
    const overlays = await loadOverlays(project, edit);
    assert.equal(edit.cuts.length, 3, "capture parity fixture must exercise three cuts");
    assert.equal(edit.layers.length, 1, "capture parity fixture must exercise one layer");
    assert.ok(captions.overlays.length >= 1, "capture parity fixture captions must render");
    assert.ok(overlays.length >= 1, "capture parity fixture HTML overlay must render");
    const chromePath = await findChromePath();
    const losslessPolicy = {
      requested: {
        quality: { value: "capture-test-lossless", origin: "test" },
        encoder: { value: "x264", origin: "test" },
      },
      effective: {
        quality: { value: "capture-test-lossless", origin: "test" },
        encoder: { value: "x264", origin: "test" },
      },
      // CRF 0 is chosen over ProRes here because every intermediate command already accepts the
      // same x264 argument vector. It removes irreversible codec loss without changing filters.
      video_encode_args: ["-c:v", "libx264", "-preset", "medium", "-crf", "0", "-color_range", "tv"],
      non_encoding_stages: [],
    };
    const planned = await renderProject(project, {
      planOnly: true,
      force: true,
      engine: "legacy",
      writeState: false,
      temporaryDirectory: join(project, ".capture-plan"),
      out: "exports/reference.mp4",
      encodingPolicy: losslessPolicy,
    });
    assert.equal(planned.plan.predicted_duration_seconds, 12);
    const comparisonTimes = [2, 6, 10];
    assert.deepEqual(edit.cuts.map((cut) => [cut.in, cut.out]), [[0, 4], [4, 8], [8, 12]]);
    for (const seconds of comparisonTimes) {
      assert.ok(captions.overlays.some((overlay) => overlay.start <= seconds && seconds < overlay.start + overlay.duration));
      assert.ok(overlays.some((overlay) => overlay.start <= seconds && seconds < overlay.start + overlay.duration));
      assert.ok(edit.layers.some((layer) => layer.t <= seconds && seconds < layer.t + layer.duration));
    }
    const capturedPaths = comparisonTimes.map((seconds) => join(project, `capture-at-${seconds}.png`));
    try {
      for (let index = 0; index < comparisonTimes.length; index += 1) {
        await renderFrameAt({
          plan: planned.plan,
          timeS: comparisonTimes[index],
          outputPath: capturedPaths[index],
          edit,
          projectRoot: project,
          overlays,
          captions: captions.overlays,
          chromePath,
          ffmpegCommand: ffmpeg,
          temporaryDirectory: join(project, `.capture-work-${index}`),
        });
      }
    } catch (error) {
      if (error?.name === "BrowserLaunchError") {
        t.skip(`production Chrome launch unavailable: ${error.message.split("\n")[0]}`);
        return;
      }
      throw error;
    }
    const rendered = await renderProject(project, {
      force: true,
      engine: "legacy",
      out: "exports/reference.mp4",
      encodingPolicy: losslessPolicy,
    });
    assert.ok(["pass", "fail"].includes(rendered.verify.verdict));
    for (let index = 0; index < comparisonTimes.length; index += 1) {
      const seconds = comparisonTimes[index];
      const referencePath = join(project, `reference-at-${seconds}.png`);
      run(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", String(seconds), "-i", join(project, "exports", "reference.mp4"),
        "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24", referencePath,
      ]);
      const captureRgb = decodeRgb(capturedPaths[index]);
      const referenceRgb = decodeRgb(referencePath);
      assert.equal(captureRgb.length, referenceRgb.length);
      const measured = measureDifference(captureRgb, referenceRgb);
      t.diagnostic(`capture parity t=${seconds}: mean_abs=${measured.meanAbsolute.toFixed(6)}/255, max_diff_pixels=${(measured.largePixelFraction * 100).toFixed(6)}%, max_channel=${measured.maxChannel}`);
      assert.ok(measured.meanAbsolute <= 2, `mean absolute difference ${measured.meanAbsolute}/255 exceeds 2/255 at t=${seconds}`);
      assert.ok(measured.largePixelFraction < 0.001, `large-difference pixel fraction ${measured.largePixelFraction} exceeds 0.1% at t=${seconds}`);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("renderFrameAt ffmpeg path matches a CRF-0 render without browser-only tracks", { timeout: 120_000 }, async (t) => {
  if (spawnSync(ffmpeg, ["-version"]).status !== 0 || spawnSync(ffprobe, ["-version"]).status !== 0) {
    return t.skip("ffmpeg or ffprobe unavailable");
  }
  const project = await mkdtemp(join(tmpdir(), "capture-parity-ffmpeg-"));
  try {
    const fixtureEdit = JSON.parse(await readFile(join(fixtureRoot, "edit.json"), "utf8"));
    fixtureEdit.tracks = fixtureEdit.tracks.filter((track) => track.id !== "title-overlay");
    await writeFile(join(project, "edit.json"), `${JSON.stringify(fixtureEdit, null, 2)}\n`, "utf8");
    await generateCaptureFixture(project, { ffmpeg });
    const editText = await readFile(join(project, "edit.json"), "utf8");
    const compatibility = readRenderEdit(editText, join(project, ".akari", "render-tmp"));
    const edit = projectRendererCompatibilityEdit(fixtureEdit, compatibility.internal, join(project, ".akari", "render-tmp"));
    const policy = {
      requested: { quality: { value: "capture-test-lossless", origin: "test" }, encoder: { value: "x264", origin: "test" } },
      effective: { quality: { value: "capture-test-lossless", origin: "test" }, encoder: { value: "x264", origin: "test" } },
      video_encode_args: ["-c:v", "libx264", "-preset", "medium", "-crf", "0", "-color_range", "tv"],
      non_encoding_stages: [],
    };
    const planned = await renderProject(project, {
      planOnly: true, force: true, engine: "legacy", writeState: false,
      temporaryDirectory: join(project, ".capture-plan"), out: "exports/reference.mp4", encodingPolicy: policy,
    });
    const capturedPath = join(project, "capture.png");
    await renderFrameAt({
      plan: planned.plan, timeS: 1.5, outputPath: capturedPath, edit, projectRoot: project,
      overlays: [], captions: [], ffmpegCommand: ffmpeg, temporaryDirectory: join(project, ".capture-work"),
    });
    const rendered = await renderProject(project, {
      force: true, engine: "legacy", out: "exports/reference.mp4", encodingPolicy: policy,
    });
    // CRF 0 makes x264 select its lossless profile, so delivery-profile verification may reject
    // this test artifact even though its encoder input frames are exactly what we compare here.
    assert.ok(["pass", "fail"].includes(rendered.verify.verdict));
    const referencePath = join(project, "reference.png");
    run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", "1.5",
      "-i", join(project, "exports", "reference.mp4"), "-frames:v", "1",
      "-c:v", "png", "-pix_fmt", "rgb24", referencePath,
    ]);
    const measured = measureDifference(decodeRgb(capturedPath), decodeRgb(referencePath));
    t.diagnostic(`capture ffmpeg parity: mean_abs=${measured.meanAbsolute.toFixed(6)}/255, max_diff_pixels=${(measured.largePixelFraction * 100).toFixed(6)}%, max_channel=${measured.maxChannel}`);
    assert.ok(measured.meanAbsolute <= 2);
    assert.ok(measured.largePixelFraction < 0.001);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function productionToolUnavailable() {
  if (spawnSync(ffmpeg, ["-version"]).status !== 0) return `ffmpeg unavailable: ${ffmpeg}`;
  if (spawnSync(ffprobe, ["-version"]).status !== 0) return `ffprobe unavailable: ${ffprobe}`;
  if (!await findChromePath()) return "Chrome 実行ファイルが見つからない";
  return null;
}

function decodeRgb(path) {
  return run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-i", path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ], { encoding: "buffer" }).stdout;
}

function measureDifference(left, right) {
  let absolute = 0;
  let maxChannel = 0;
  let largePixels = 0;
  for (let offset = 0; offset < left.length; offset += 3) {
    let pixelMaximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(left[offset + channel] - right[offset + channel]);
      absolute += difference;
      pixelMaximum = Math.max(pixelMaximum, difference);
      maxChannel = Math.max(maxChannel, difference);
    }
    if (pixelMaximum > 2) largePixels += 1;
  }
  return {
    meanAbsolute: absolute / left.length,
    largePixelFraction: largePixels / (left.length / 3),
    maxChannel,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, ...options });
  assert.equal(result.status, 0, result.stderr?.toString?.("utf8") || result.error?.message);
  return result;
}
