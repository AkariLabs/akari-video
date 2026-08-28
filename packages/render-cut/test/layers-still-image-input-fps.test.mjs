import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLayersCompositeCommand } from "../src/layers.mjs";
import { renderProject } from "../src/render-cut.mjs";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);
const WIDTH = 160;
const HEIGHT = 90;
const CUT_DURATION = 1.3;
const CUT_COUNT = 5;
const DURATION = CUT_DURATION * CUT_COUNT;
const WINDOW_START = 0.2;
const WINDOW_END = 0.7;
const SCALE_END = 0.3;

function hasMediaTools() {
  return spawnSync("ffmpeg", ["-version"]).status === 0
    && spawnSync("ffprobe", ["-version"]).status === 0;
}

function ffmpeg(args, options = {}) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options },
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  return result;
}

function makeStill(path, { color, width, height }) {
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}`,
    "-frames:v", "1", path,
  ]);
}

function probeFrameCount(path) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}

function decodeRgbFrames(path) {
  const result = ffmpeg([
    "-i", path,
    "-map", "0:v:0",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-",
  ], { encoding: null });
  const frameBytes = WIDTH * HEIGHT * 3;
  assert.equal(result.stdout.length % frameBytes, 0);
  return Array.from(
    { length: result.stdout.length / frameBytes },
    (_, index) => result.stdout.subarray(index * frameBytes, (index + 1) * frameBytes),
  );
}

function pixel(frame, x, y) {
  const offset = (y * WIDTH + x) * 3;
  return { r: frame[offset], g: frame[offset + 1], b: frame[offset + 2] };
}

function isCyan(value) {
  return value.r < 80 && value.g > 150 && value.b > 150;
}

function isLime(value) {
  return value.r < 80 && value.g > 150 && value.b < 100;
}

function inputOptionsFor(args, path) {
  const at = args.indexOf(path);
  assert.notEqual(at, -1, `expected ${path} among ffmpeg args`);
  assert.equal(args[at - 1], "-i");
  const previousInput = args.lastIndexOf("-i", at - 2);
  return args.slice(previousInput === -1 ? 0 : previousInput + 2, at - 1);
}

async function makeProject(fps) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-layer-still-fps-"));
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  const sources = Array.from({ length: CUT_COUNT }, (_, index) => ({
    id: `source-${index}`,
    path: `source-${index}.png`,
    proxy: null,
  }));
  await writeFile(join(root, "edit.json"), `${JSON.stringify({
    version: 1,
    output: { width: WIDTH, height: HEIGHT, fps },
    sources,
    cuts: sources.map((source) => ({ src: source.id, in: 0, out: CUT_DURATION })),
    overlays: [],
    layers: [
      {
        id: "screen-window",
        t: WINDOW_START,
        duration: WINDOW_END - WINDOW_START,
        kind: "video",
        src: "screen.png",
        blend: "screen",
        transform: { x: -60, y: 0, scale: 1, rotate: 0 },
      },
      {
        id: "scale-clock",
        t: 0,
        duration: DURATION,
        kind: "video",
        src: "scale.png",
        transform: { x: 30, y: 0, scale: 1, rotate: 0 },
        keyframes: [
          { t: 0, transform: { x: 30, y: 0, scale: 1, rotate: 0 } },
          { t: SCALE_END, transform: { x: 30, y: 0, scale: 5, rotate: 0 } },
        ],
      },
    ],
  }, null, 2)}\n`);
  for (const source of sources) {
    makeStill(join(root, source.path), { color: "blue", width: WIDTH, height: HEIGHT });
  }
  makeStill(join(root, "screen.png"), { color: "lime", width: 40, height: 20 });
  makeStill(join(root, "scale.png"), { color: "lime", width: 20, height: 20 });
  return root;
}

test("still-image layer inputs use project fps in shared and defensive input paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-layer-still-args-"));
  try {
    await writeFile(join(root, "edit.json"), '{"output":{"fps":60}}\n');
    const common = {
      projectRoot: root,
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      inputPath: join(root, "base.mp4"),
      outputPath: join(root, "output.mp4"),
      duration: DURATION,
      width: WIDTH,
      height: HEIGHT,
    };
    const sharedPath = join(root, "shared.png");
    const shared = buildLayersCompositeCommand({
      ...common,
      fps: 30,
      layers: [{ id: "shared", t: 0, duration: DURATION, kind: "video", src: "shared.png" }],
    });
    assert.deepEqual(inputOptionsFor(shared.args, sharedPath), ["-framerate", "30", "-loop", "1"]);

    const defensivePath = join(root, "defensive.png");
    const defensive = buildLayersCompositeCommand({
      ...common,
      fps: null,
      layers: [{
        id: "defensive",
        t: 0,
        duration: DURATION,
        kind: "custom",
        src: "defensive.png",
        blend: "screen",
      }],
    });
    assert.deepEqual(
      inputOptionsFor(defensive.args, defensivePath),
      ["-framerate", "60", "-loop", "1"],
      "null fps falls back to edit.json output.fps before constructing an image input",
    );

    const unresolvedRoot = join(root, "no-edit-or-base");
    const unresolvedPath = join(unresolvedRoot, "unresolved.png");
    const unresolved = buildLayersCompositeCommand({
      ...common,
      projectRoot: unresolvedRoot,
      inputPath: join(unresolvedRoot, "missing-base.mp4"),
      fps: null,
      layers: [{
        id: "unresolved",
        t: 0,
        duration: DURATION,
        kind: "custom",
        src: "unresolved.png",
        blend: "screen",
      }],
    });
    assert.deepEqual(inputOptionsFor(unresolved.args, unresolvedPath), ["-loop", "1"]);
    assert.deepEqual(unresolved.warnings, [
      "still-image layer input fps could not be resolved; ffmpeg image2's 25fps default will be used",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("30/60fps product renders keep planned frames, maskedmerge window, and scale keyframe clock", async (t) => {
  if (!hasMediaTools()) return t.skip("ffmpeg/ffprobe unavailable");

  const measurements = [];
  for (const fps of [30, 60]) {
    const root = await makeProject(fps);
    try {
      // This suite measures legacy layers composition; engine resolution has separate unit coverage.
      const state = await renderProject(root, { out: "exports/render.mp4", engine: "legacy" });
      assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
      const outputPath = join(root, state.plan.output);
      const frames = decodeRgbFrames(outputPath);
      const frameCount = probeFrameCount(outputPath);
      const activeWindowFrames = frames
        .map((frame, index) => isCyan(pixel(frame, 20, HEIGHT / 2)) ? index : -1)
        .filter((index) => index >= 0);
      const scaleBoundaryFrame = Math.round(SCALE_END * fps);
      const scaleWidthAtBoundary = Array.from({ length: WIDTH }, (_, x) => x)
        .filter((x) => isLime(pixel(frames[scaleBoundaryFrame], x, HEIGHT / 2))).length;
      const expectedStartFrame = Math.ceil(WINDOW_START * fps - 1e-6);
      const expectedEndFrame = Math.ceil(WINDOW_END * fps - 1e-6) - 1;

      t.diagnostic(
        `${fps}fps measured: total=${frameCount}, screen-window=${activeWindowFrames[0]}..${activeWindowFrames.at(-1)}, scale-width@frame-${scaleBoundaryFrame}=${scaleWidthAtBoundary}px`,
      );
      measurements.push({
        fps,
        frameCount,
        decodedFrameCount: frames.length,
        activeWindowFrames,
        expectedStartFrame,
        expectedEndFrame,
        scaleBoundaryFrame,
        scaleWidthAtBoundary,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  for (const measured of measurements) {
    assert.equal(measured.frameCount, Math.round(DURATION * measured.fps));
    assert.equal(measured.decodedFrameCount, measured.frameCount);
    assert.deepEqual(
      [measured.activeWindowFrames[0], measured.activeWindowFrames.at(-1)],
      [measured.expectedStartFrame, measured.expectedEndFrame],
    );
    assert.equal(
      measured.activeWindowFrames.length,
      measured.expectedEndFrame - measured.expectedStartFrame + 1,
    );
    assert.ok(
      measured.scaleWidthAtBoundary >= 98 && measured.scaleWidthAtBoundary <= 102,
      `scale must reach 5x (100px) at t=${SCALE_END}s / frame ${measured.scaleBoundaryFrame}; got ${measured.scaleWidthAtBoundary}px`,
    );
  }
});

test("non-image layer command argv remains byte-for-byte unchanged", () => {
  const built = buildLayersCompositeCommand({
    layers: [{ id: "video", t: 0, duration: 1.3, kind: "video", src: "video.mp4" }],
    projectRoot: ".",
    ffmpegCommand: "ffmpeg",
    ffprobeCommand: null,
    inputPath: "base.mp4",
    outputPath: "output.mp4",
    duration: 1.3,
    width: WIDTH,
    height: HEIGHT,
    fps: 30,
  });
  assert.deepEqual(built.args, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "base.mp4",
    "-i", join(process.cwd(), "video.mp4"),
    "-filter_complex",
    "[1:v]split=1[vsrc0_0];[vsrc0_0]trim=duration=1.3,setpts=PTS-STARTPTS+0/TB,format=yuva420p[l0_p];[0:v][l0_p]overlay=x=(main_w-overlay_w)/2+0:y=(main_h-overlay_h)/2+0:format=auto:enable='gte(t,0)*lt(t,1.2833333333333334)'[l0_out];[l0_out]scale=out_range=tv[outv]",
    "-map", "[outv]", "-map", "0:a:0",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv",
    "-pix_fmt", "yuv420p", "-c:a", "copy", "output.mp4",
  ]);
});
