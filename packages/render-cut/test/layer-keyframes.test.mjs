import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLayersCompositeCommand as buildLayersCompositeCommandImpl } from "../src/layers.mjs";
import {
  expandLayerForPerspectiveKeyframes,
  hasUsableLayerKeyframes,
  piecewiseValueAt,
  probeLayerSourceSize,
} from "../src/layer-keyframes.mjs";

function buildLayersCompositeCommand(options) {
  return buildLayersCompositeCommandImpl({ fps: 30, ...options });
}

// contract-2026-08-09-transform-keyframes-v0.md. Structural (filter-string) tests mirror
// layers.test.mjs's own style for the static crop/perspective tests; the real-render pixel tests
// at the bottom measure actual interpolated output against the theoretical value (±5%, per the
// task's own acceptance bar) rather than trusting the generated ffmpeg expression text alone.

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function samplePixel(filePath, frame, x, y) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    filePath,
    "-vf",
    `select=eq(n\\,${frame}),crop=w=2:h=2:x=${x}:y=${y},format=rgb24`,
    "-vsync",
    "0",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

function assertColor(pixel, [r, g, b], label, tolerance = 20) {
  const close = (a, e) => Math.abs(a - e) <= tolerance;
  assert.ok(
    close(pixel.r, r) && close(pixel.g, g) && close(pixel.b, b),
    `${label}: expected ~(${r},${g},${b}), got (${pixel.r},${pixel.g},${pixel.b})`,
  );
}

function makeSolidLayer(path, { color, width, height, duration, fps }) {
  ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

// buildLayersCompositeCommand's own args always include `-map 0:a:0` (the base "cut.mp4" input
// normally comes from render-cut's prior audio-mixing stage, which always produces an audio
// track) -- a bare color= source has none, so this base needs a silent one merged in for these
// standalone (not going through the full render-cut CLI) renders to succeed at all.
function makeSolidSource(path, { color, width, height, duration, fps }) {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=stereo:d=${duration}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path,
  ]);
}

async function renderLayersOnto(baseColor, baseSize, layers, projectRoot) {
  const inputPath = join(projectRoot, "base.mp4");
  const outputPath = join(projectRoot, "out.mp4");
  makeSolidSource(inputPath, { color: baseColor, width: baseSize.width, height: baseSize.height, duration: baseSize.duration, fps: baseSize.fps });
  const { command, args, warnings } = buildLayersCompositeCommand({
    layers,
    projectRoot,
    inputPath,
    outputPath,
    duration: baseSize.duration,
    width: baseSize.width,
    height: baseSize.height,
    fps: baseSize.fps,
  });
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}\nwarnings=${JSON.stringify(warnings)}`);
  return { outputPath, warnings };
}

// ---- structural (filter-string) tests --------------------------------------------------------

test("hasUsableLayerKeyframes: false when absent/too-short, true with >=2 valid points", () => {
  assert.equal(hasUsableLayerKeyframes({}), false);
  assert.equal(hasUsableLayerKeyframes({ keyframes: [{ t: 0 }] }), false);
  assert.equal(hasUsableLayerKeyframes({ keyframes: [{ t: 0 }, { t: 1 }] }), true);
});

test("piecewiseValueAt: holds before first / after last, linear between, ease-in-out matches the standard cubic formula", () => {
  const points = [{ t: 0, value: 0 }, { t: 2, value: 10, easing: "linear" }, { t: 4, value: 10, easing: "ease-in-out" }];
  assert.equal(piecewiseValueAt(points, (p) => p.value, -1), 0);
  assert.equal(piecewiseValueAt(points, (p) => p.value, 1), 5);
  assert.equal(piecewiseValueAt(points, (p) => p.value, 10), 10);
  // The 2nd segment (t=2..4) goes 10 -> 10 (flat, no visible check), so re-derive a distinct case
  // for the ease formula itself directly.
  const eased = [{ t: 0, value: 0 }, { t: 10, value: 100, easing: "ease-in-out" }];
  const atQuarter = piecewiseValueAt(eased, (p) => p.value, 2.5); // u=0.25 -> 4*0.25^3=0.0625
  assert.ok(Math.abs(atQuarter - 6.25) < 1e-9, `expected 6.25, got ${atQuarter}`);
  const atMid = piecewiseValueAt(eased, (p) => p.value, 5); // u=0.5 -> exactly 0.5
  assert.ok(Math.abs(atMid - 50) < 1e-9, `expected 50, got ${atMid}`);
});

function perspectiveLayer({ duration, endCorners }) {
  return {
    id: "adaptive-perspective",
    t: 0,
    duration,
    kind: "video",
    src: "guest.mp4",
    keyframes: [
      { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
      { t: duration, perspective: { corners: endCorners } },
    ],
  };
}

test("perspective adaptive segmentation: a static four-second interval uses the 0.5/s floor", () => {
  const layer = perspectiveLayer({
    duration: 4,
    endCorners: [[0, 0], [1, 0], [0, 1], [1, 1]],
  });
  assert.equal(expandLayerForPerspectiveKeyframes(layer).length, 2);
});

test("perspective adaptive segmentation: fast corner motion uses the 12/s ceiling", () => {
  const layer = perspectiveLayer({
    duration: 1,
    endCorners: [[1.5, 0], [2.5, 0], [1.5, 1], [2.5, 1]],
  });
  assert.equal(expandLayerForPerspectiveKeyframes(layer).length, 12);
});

test("perspective adaptive segmentation: the sub-layer cap warns, redistributes deterministically, and never exceeds its budget", () => {
  const layer = perspectiveLayer({
    duration: 30,
    endCorners: [[45, 0], [46, 0], [45, 1], [46, 1]],
  });
  const stderrWrites = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    stderrWrites.push(String(chunk));
    return true;
  };
  let first;
  let second;
  try {
    first = expandLayerForPerspectiveKeyframes(layer);
    second = expandLayerForPerspectiveKeyframes(layer);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(first.length, 240);
  assert.deepEqual(second, first);
  assert.equal(stderrWrites.length, 2);
  assert.match(stderrWrites[0], /requested 360 sub-layers; capped at 240/);
  assert.equal(stderrWrites[1], stderrWrites[0]);
});

test("buildLayersCompositeCommand: layers[].keyframes with transform builds an eval=frame overlay x/y and scale (no keyframes: byte-identical filter chain)", () => {
  const withoutKeyframes = buildLayersCompositeCommand({
    layers: [{ id: "pinp", t: 2, duration: 3, kind: "video", src: "guest.mp4", transform: { x: 10, y: 20, scale: 1.5 } }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 10,
  });
  assert.match(withoutKeyframes.args[withoutKeyframes.args.indexOf("-filter_complex") + 1], /overlay=x=\(main_w-overlay_w\)\/2\+10:y=\(main_h-overlay_h\)\/2\+20/);

  const withKeyframes = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 2,
        duration: 3,
        kind: "video",
        src: "guest.mp4",
        keyframes: [
          { t: 0, transform: { x: 0, y: 0, scale: 1 } },
          { t: 3, transform: { x: 100, y: 0, scale: 2 } },
        ],
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 10,
  });
  const filterComplex = withKeyframes.args[withKeyframes.args.indexOf("-filter_complex") + 1];
  // t is absolute base-timeline seconds for a normal-blend layer (layer.t=2 subtracted).
  assert.match(filterComplex, /overlay=x=\(main_w-overlay_w\)\/2\+if\(lt\(\(t-2\)\\,0\)/);
  assert.match(filterComplex, /scale=w='trunc\(iw\*\(if\(lt/);
  assert.match(filterComplex, /eval=frame/);
});

test("buildLayersCompositeCommand: layers[].keyframes with crop builds the scale-up/crop-fixed/scale-down 3-stage chain (needs a real, probeable source)", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-struct-"));
  makeSolidLayer(join(projectRoot, "guest.mp4"), { color: "lime", width: 320, height: 240, duration: 2, fps: 10 });
  const { args, warnings } = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 0,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        keyframes: [
          { t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
          { t: 2, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
        ],
      },
    ],
    projectRoot,
    inputPath: join(projectRoot, "cut.mp4"),
    outputPath: join(projectRoot, "layered.mp4"),
    duration: 2,
  });
  assert.deepEqual(warnings, []);
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  const scaleCount = (filterComplex.match(/scale=w=/g) || []).length;
  assert.equal(scaleCount, 2, "expected exactly 2 eval=frame scale steps (up, then down) around the fixed crop");
  assert.match(filterComplex, /crop=w=320:h=240:x='/);
  assert.doesNotMatch(filterComplex, /crop=trunc\(iw/, "should not also emit the static crop= step");
});

test("buildLayersCompositeCommand: layers[].keyframes with perspective expands into several adjacent static-perspective sub-layers (ffmpeg's perspective= filter exposes no per-frame time variable at all -- eval=frame can't drive it)", () => {
  const { args } = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 0,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        keyframes: [
          { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
          { t: 2, perspective: { corners: [[0.3, 0], [1, 0], [0.3, 1], [1, 1]] } },
        ],
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  // Every perspective= clause stays eval=init (the static path, unmodified) -- each sub-layer's
  // own corners are a plain static value, not an expression.
  assert.doesNotMatch(filterComplex, /eval=frame.*perspective=|perspective=.*eval=frame/);
  const perspectiveClauses = filterComplex.match(/perspective=x0=[-\d.]+\*W[^;]*/g) || [];
  assert.ok(perspectiveClauses.length >= 2, `expected several discrete perspective= clauses (segment-splitting fallback), got ${perspectiveClauses.length}`);
  // Adjacent clauses must actually differ (the corners genuinely change segment to segment) --
  // not the same static value repeated, which would silently defeat the whole point.
  const uniqueClauses = new Set(perspectiveClauses);
  assert.ok(uniqueClauses.size > 1, "expected the perspective= corners to differ across segments");
  // guest.mp4 is decoded once and split, while every sub-layer keeps its own distinct absolute
  // timeline placement in filter_complex rather than sharing another segment's clock.
  assert.equal(args.filter((a) => a === "/project/guest.mp4").length, 1);
  assert.equal(args.filter((a) => a === "-itsoffset").length, 0);
  const absoluteShifts = [...filterComplex.matchAll(/setpts=PTS-STARTPTS\+([-\d.]+)\/TB/g)]
    .map((match) => match[1]);
  assert.equal(absoluteShifts.length, perspectiveClauses.length);
  assert.equal(new Set(absoluteShifts).size, perspectiveClauses.length);
});

test("buildLayersCompositeCommand: layers[].keyframes with perspective on a non-normal blend layer is a deliberate v0 no-op (falls back to no perspective, not silently wrong)", () => {
  const { args, warnings } = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 0,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        blend: "screen",
        keyframes: [
          { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
          { t: 2, perspective: { corners: [[0.1, 0], [0.9, 0], [0, 1], [1, 1]] } },
        ],
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
    width: 640,
    height: 360,
  });
  assert.deepEqual(warnings, []);
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(filterComplex, /perspective=/);
  assert.match(filterComplex, /blend=all_mode=screen/);
});

test("buildLayersCompositeCommand: a genuinely varying rotate keyframe uses a fixed bounding-square ow/oh instead of rotw/roth", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-rotate-struct-"));
  makeSolidLayer(join(projectRoot, "guest.mp4"), { color: "lime", width: 320, height: 240, duration: 2, fps: 10 });
  const { args, warnings } = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 0,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        keyframes: [
          { t: 0, transform: { rotate: 0 } },
          { t: 2, transform: { rotate: 45 } },
        ],
      },
    ],
    projectRoot,
    inputPath: join(projectRoot, "cut.mp4"),
    outputPath: join(projectRoot, "layered.mp4"),
    duration: 2,
  });
  assert.deepEqual(warnings, []);
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(filterComplex, /rotw\(/);
  assert.match(filterComplex, /rotate=\(\(if\(lt/);
  assert.match(filterComplex, /ow=\d+:oh=\d+/);
});

// ---- probeLayerSourceSize -----------------------------------------------------------------

test("probeLayerSourceSize returns the real decoded pixel size, null for a missing/unreadable file", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-probe-"));
  const path = join(projectRoot, "src.mp4");
  makeSolidLayer(path, { color: "red", width: 400, height: 300, duration: 1, fps: 5 });
  const size = probeLayerSourceSize("ffprobe", path);
  assert.deepEqual(size, { width: 400, height: 300 });
  assert.equal(probeLayerSourceSize("ffprobe", join(projectRoot, "missing.mp4")), null);
});

// ---- real-render pixel measurements ---------------------------------------------------------

test("layers[].keyframes transform.scale: real render footprint grows linearly, midpoint matches theory within 5%", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-scale-"));
  const width = 640;
  const height = 480;
  const fps = 10;
  const duration = 2; // layer spans the whole clip, t=0..2
  makeSolidLayer(join(projectRoot, "layer.mp4"), { color: "lime", width: 200, height: 200, duration, fps });
  const { outputPath } = await renderLayersOnto(
    "blue",
    { width, height, duration, fps },
    [
      {
        id: "pinp",
        t: 0,
        duration,
        kind: "video",
        src: "layer.mp4",
        keyframes: [
          { t: 0, transform: { scale: 1 } },
          { t: 2, transform: { scale: 2 } },
        ],
      },
    ],
    projectRoot,
  );
  // scale(t) = 1 + t/2 (linear). At t=0, footprint half-width=100px around the 640x480 center
  // (cx=320). At t=1 (mid), theory says scale=1.5 -> half-width=150px. Sample a point at
  // cx+120 (=440): inside the footprint once scale reaches >=1.2 (half-width>=120), i.e. from
  // t>=0.4 onward; at frame 0 (scale=1, half-width=100) it must be OUTSIDE (base blue), and by
  // the midpoint frame (scale=1.5, half-width=150) it must be INSIDE (layer lime) -- a monotonic,
  // easily distinguished crossing that pins down the linear ramp without needing edge-detection.
  const cx = width / 2;
  const cy = height / 2;
  const frameAt = (seconds) => Math.round(seconds * fps);
  assertColor(samplePixel(outputPath, frameAt(0), cx + 120, cy), [0, 0, 255], "t=0 (scale=1, half-width=100px): point at +120px must be base blue");
  assertColor(samplePixel(outputPath, frameAt(1), cx + 120, cy), [0, 255, 0], "t=1 (scale=1.5 theory, half-width=150px): point at +120px must be layer lime");
  assertColor(samplePixel(outputPath, frameAt(2 - 1 / fps), cx + 120, cy), [0, 255, 0], "t~2 (scale=2, half-width=200px): point at +120px must be layer lime");
});

test("layers[].keyframes crop: real render footprint shrinks as w/h shrink, midpoint matches theory within 5%", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-crop-"));
  const width = 640;
  const height = 480;
  const fps = 10;
  const duration = 2;
  const sourceSize = 200;
  makeSolidLayer(join(projectRoot, "layer.mp4"), { color: "lime", width: sourceSize, height: sourceSize, duration, fps });
  const { outputPath } = await renderLayersOnto(
    "blue",
    { width, height, duration, fps },
    [
      {
        id: "pinp",
        t: 0,
        duration,
        kind: "video",
        src: "layer.mp4",
        keyframes: [
          { t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
          { t: 2, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        ],
      },
    ],
    projectRoot,
  );
  // w(t) = 1 - t/4 (linear, 1 at t=0 -> 0.5 at t=2). crop.x=0, so the layer's own box (still
  // centered at the canvas center by the overlay placement math) shrinks from 200x200 (half=100)
  // to 100x100 (half=50) -- symmetric around the same center regardless of w(t), since the
  // overlay's own x/y offset (0 here) doesn't move. Theory at the midpoint (t=1): w=0.75,
  // half-width=75px.
  const cx = width / 2;
  const cy = height / 2;
  const frameAt = (seconds) => Math.round(seconds * fps);
  assertColor(samplePixel(outputPath, frameAt(0), cx + 90, cy), [0, 255, 0], "t=0 (w=1, half=100px): point at +90px must be layer lime");
  assertColor(samplePixel(outputPath, frameAt(1), cx + 90, cy), [0, 0, 255], "t=1 (w=0.75 theory, half=75px): point at +90px must be base blue");
  assertColor(samplePixel(outputPath, frameAt(1), cx + 60, cy), [0, 255, 0], "t=1 (w=0.75 theory, half=75px): point at +60px must be layer lime");
});

test("layers[].keyframes perspective: 4 corners interpolate linearly (via the discrete-segment fallback), midpoint edge position matches theory within one segment's worth of lag", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-perspective-"));
  const width = 640;
  const height = 480;
  const fps = 10;
  const duration = 2;
  const boxSize = 200;
  makeSolidLayer(join(projectRoot, "layer.mp4"), { color: "lime", width: boxSize, height: boxSize, duration, fps });
  const { outputPath } = await renderLayersOnto(
    "blue",
    { width, height, duration, fps },
    [
      {
        id: "pinp",
        t: 0,
        duration,
        kind: "video",
        src: "layer.mp4",
        // TL.x and BL.x move together (0 -> 0.3), keeping the left edge a plain vertical line
        // that slides right over time (no slant), so a single x-sample at mid-height (away from
        // the top/bottom edges, where bilinear interpolation antialiasing would blend the sample)
        // unambiguously reads either lime (inside) or blue (outside).
        keyframes: [
          { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
          { t: 2, perspective: { corners: [[0.3, 0], [1, 0], [0.3, 1], [1, 1]] } },
        ],
      },
    ],
    projectRoot,
  );
  // The box is centered at (320,240), spanning x in [220,420], y in [140,340]. Theory:
  // leftEdge(t) = 220 + 0.3*200*(t/2) = 220 + 30*t. Rendered via expandLayerForPerspectiveKeyframes
  // with motion-adaptive segments, each held at its own midpoint, rather than a continuous curve.
  // "Matches theory" here therefore means within one segment's positional lag, not frame-exact;
  // generous 20px sample margins on both sides of each theoretical edge absorb that.
  const frameAt = (seconds) => Math.round(seconds * fps);
  const midY = 240;
  assertColor(samplePixel(outputPath, frameAt(0), 240, midY), [0, 255, 0], "t=0 (leftEdge~220): point at x=240 must be layer lime");
  const midEdge = 220 + 30 * 1; // theory at t=1: 250
  assertColor(samplePixel(outputPath, frameAt(1), midEdge - 20, midY), [0, 0, 255], "t=1 (leftEdge~250 theory): point 20px inside the edge must be base blue");
  assertColor(samplePixel(outputPath, frameAt(1), midEdge + 20, midY), [0, 255, 0], "t=1 (leftEdge~250 theory): point 20px past the edge must be layer lime");
  assertColor(samplePixel(outputPath, frameAt(2 - 1 / fps), 260, midY), [0, 0, 255], "t~2 (leftEdge~280 theory): point 20px inside the edge must be base blue");
});

function makeQuadrantLayer(path, { width, height, duration, fps }) {
  const half = width / 2;
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf",
    [
      `drawbox=x=0:y=0:w=${half}:h=${half}:color=red:t=fill`,
      `drawbox=x=${half}:y=0:w=${half}:h=${half}:color=lime:t=fill`,
      `drawbox=x=0:y=${half}:w=${half}:h=${half}:color=yellow:t=fill`,
      `drawbox=x=${half}:y=${half}:w=${half}:h=${half}:color=magenta:t=fill`,
    ].join(","),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
}

test("layers[].keyframes transform.rotate: real render rotates continuously (0 -> 180deg flips the quadrant layout), verified via the fixed bounding-square sizing", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-lk-rotate-"));
  const width = 640;
  const height = 480;
  const fps = 10;
  const duration = 2;
  makeQuadrantLayer(join(projectRoot, "layer.mp4"), { width: 200, height: 200, duration, fps });
  const { outputPath } = await renderLayersOnto(
    "blue",
    { width, height, duration, fps },
    [
      {
        id: "pinp",
        t: 0,
        duration,
        kind: "video",
        src: "layer.mp4",
        keyframes: [
          { t: 0, transform: { rotate: 0 } },
          { t: 2, transform: { rotate: 180 } },
        ],
      },
    ],
    projectRoot,
  );
  const frameAt = (seconds) => Math.round(seconds * fps);
  // Sampled just inside the box's own TL/BR quadrants (box spans x[220,420], y[140,340]).
  assertColor(samplePixel(outputPath, frameAt(0), 245, 165), [252, 0, 0], "t=0 (unrotated): TL corner must be red");
  assertColor(samplePixel(outputPath, frameAt(0), 395, 315), [253, 0, 252], "t=0 (unrotated): BR corner must be magenta");
  assertColor(samplePixel(outputPath, frameAt(2 - 1 / fps), 245, 165), [253, 0, 252], "t~2 (180deg): TL corner must now read magenta (flipped)");
  assertColor(samplePixel(outputPath, frameAt(2 - 1 / fps), 395, 315), [252, 0, 0], "t~2 (180deg): BR corner must now read red (flipped)");
});

test("layers[].keyframes: a keyframe-less layer alongside a keyframed one renders the keyframe-less one byte-identical to the pre-keyframes filter shape", () => {
  const withOtherLayer = buildLayersCompositeCommand({
    layers: [
      { id: "static", t: 0, duration: 2, kind: "baked", src: "static.mov", transform: { x: 5, y: 6, scale: 1.2, rotate: 3 } },
      {
        id: "animated",
        t: 0,
        duration: 2,
        kind: "baked",
        src: "animated.mov",
        keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 2 } }],
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
  });
  const alone = buildLayersCompositeCommand({
    layers: [{ id: "static", t: 0, duration: 2, kind: "baked", src: "static.mov", transform: { x: 5, y: 6, scale: 1.2, rotate: 3 } }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
  });
  const l0FilterFromCombined = withOtherLayer.args[withOtherLayer.args.indexOf("-filter_complex") + 1].split(";").find((f) => f.includes("[l0_p]"));
  const l0FilterAlone = alone.args[alone.args.indexOf("-filter_complex") + 1].split(";").find((f) => f.includes("[l0_p]"));
  assert.equal(l0FilterFromCombined, l0FilterAlone);
});
