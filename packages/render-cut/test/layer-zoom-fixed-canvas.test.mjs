import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLayersCompositeCommand } from "../src/layers.mjs";

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const DURATION = 2;
const SCALE_END = 1.06;

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed (status=${result.status}, signal=${result.signal}): ${result.stderr?.toString("utf8")}`,
  );
  return result;
}

function makeBase(path) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `color=c=navy:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION}`,
    "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${DURATION}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", path,
  ]);
}

function makeStripeLayer(path, width, height, cell) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=${FPS}:d=${DURATION}`,
    "-vf", `geq=lum='if(eq(mod(floor(X/${cell})\\,2)\\,0)\\,0\\,255)':cb=128:cr=128`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-pix_fmt", "yuv420p", path,
  ]);
}

function renderFixed({ root, layerPath, outputPath }) {
  const built = buildLayersCompositeCommand({
    layers: [{
      id: "zoom",
      t: 0,
      duration: DURATION,
      kind: "video",
      src: layerPath,
      keyframes: [
        { t: 0, transform: { scale: 1 } },
        { t: DURATION, transform: { scale: SCALE_END } },
      ],
    }],
    projectRoot: root,
    inputPath: join(root, "base.mp4"),
    outputPath,
    duration: DURATION,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    videoEncodeArgs: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-color_range", "tv"],
  });
  assert.deepEqual(built.warnings, []);
  run(built.command, built.args);
  return built.args[built.args.indexOf("-filter_complex") + 1];
}

// Exact reproduction of the former layers.mjs route: variable integer bitmap dimensions followed
// by `(main-overlay)/2`. It is retained only inside this A/B regression test as the before sample.
function renderLegacy({ root, layerPath, outputPath }) {
  const scaleExpr = `(1+(${SCALE_END}-1)*(t/${DURATION}))`;
  const filter = [
    `[1:v]trim=duration=${DURATION},setpts=PTS-STARTPTS,format=yuva420p,`
      + `scale=w='trunc(iw*${scaleExpr})':h='trunc(ih*${scaleExpr})':eval=frame[legacy]`,
    `[0:v][legacy]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:format=auto[outv]`,
  ].join(";");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", join(root, "base.mp4"), "-i", layerPath,
    "-filter_complex", filter, "-map", "[outv]", "-map", "0:a:0",
    "-r", String(FPS), "-t", String(DURATION),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-pix_fmt", "yuv420p",
    "-c:a", "copy", outputPath,
  ]);
}

function extractGray(path) {
  return run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-i", path,
    "-vf", "format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ]).stdout;
}

function nearestCrossing(row, hint, window) {
  const start = Math.max(0, Math.round(hint) - window);
  const end = Math.min(row.length - 2, Math.round(hint) + window);
  let best = null;
  for (let x = start; x <= end; x += 1) {
    const a = row[x];
    const b = row[x + 1];
    if ((a < 128 && b >= 128) || (a >= 128 && b < 128)) {
      const position = x + (128 - a) / (b - a);
      if (best === null || Math.abs(position - hint) < Math.abs(best - hint)) best = position;
    }
  }
  return best;
}

function cubicFit(ts, ys) {
  const matrix = Array.from({ length: 4 }, () => Array(5).fill(0));
  for (let index = 0; index < ts.length; index += 1) {
    const row = [1, ts[index], ts[index] ** 2, ts[index] ** 3];
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) matrix[r][c] += row[r] * row[c];
      matrix[r][4] += row[r] * ys[index];
    }
  }
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column] / matrix[column][column];
      for (let c = column; c <= 4; c += 1) matrix[row][c] -= factor * matrix[column][c];
    }
  }
  const coefficients = matrix.map((row, index) => row[4] / row[index]);
  return (t) => coefficients[0] + coefficients[1] * t + coefficients[2] * t ** 2 + coefficients[3] * t ** 3;
}

function jitterStats(raw, { rowY, initialHint }) {
  const frameSize = WIDTH * HEIGHT;
  const frameCount = Math.floor(raw.length / frameSize);
  const positions = [];
  let hint = initialHint;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const rowStart = frame * frameSize + rowY * WIDTH;
    const position = nearestCrossing(raw.subarray(rowStart, rowStart + WIDTH), hint, 4);
    assert.notEqual(position, null, `lost tracked edge at frame ${frame}`);
    positions.push(position);
    hint = position;
  }
  const ts = positions.map((_, index) => index / FPS);
  const fit = cubicFit(ts, positions);
  const residuals = positions.map((position, index) => position - fit(ts[index]));
  const mean = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const stdev = Math.sqrt(residuals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / residuals.length);
  const deltas = residuals.slice(1).map((value, index) => value - residuals[index]);
  let reversals = 0;
  for (let index = 1; index < deltas.length; index += 1) {
    if (Math.sign(deltas[index]) !== 0 && Math.sign(deltas[index - 1]) !== 0
      && Math.sign(deltas[index]) !== Math.sign(deltas[index - 1])) reversals += 1;
  }
  return { frameCount, stdev, reversals };
}

test("fixed-canvas filter is supersampled, invariant-sized, and keyframe-less filters remain byte-for-byte unchanged", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "akari-layer-fixed-structure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  makeBase(join(root, "base.mp4"));
  makeStripeLayer(join(root, "layer.mp4"), 160, 90, 10);
  const filter = renderFixed({ root, layerPath: "layer.mp4", outputPath: join(root, "fixed.mp4") });
  assert.match(filter, /scale=w=320:h=180:flags=lanczos/);
  assert.match(filter, /pad=w=340:h=192:.*eval=frame/);
  assert.match(filter, /scale=170:96:flags=lanczos/);
  assert.match(filter, /overlay=x=\(main_w-overlay_w\)\/2/);

  const keyframeLess = buildLayersCompositeCommand({
    layers: [{ id: "static", t: 0, duration: 2, kind: "baked", src: "static.mov", transform: { x: 5, y: 6, scale: 1.2, rotate: 0 } }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    ffprobeCommand: "ffprobe",
    inputPath: "/project/cut.mp4",
    outputPath: "/project/out.mp4",
    duration: 2,
    width: 640,
    height: 360,
    fps: 30,
  });
  assert.equal(
    keyframeLess.args[keyframeLess.args.indexOf("-filter_complex") + 1],
    "[1:v]split=1[vsrc0_0];[vsrc0_0]trim=duration=2,setpts=PTS-STARTPTS+0/TB,format=yuva420p,scale=trunc(iw*1.2):trunc(ih*1.2)[l0_p];[0:v][l0_p]overlay=x=(main_w-overlay_w)/2+5:y=(main_h-overlay_h)/2+6:format=auto:enable='gte(t,0)*lt(t,1.9833333333333334)'[l0_out];[l0_out]scale=out_range=tv[outv]",
  );
});

for (const fixture of [
  { name: "full-frame", layerWidth: 320, layerHeight: 180, cell: 20, edgeOffset: 40 },
  { name: "PiP", layerWidth: 160, layerHeight: 90, cell: 10, edgeOffset: 40 },
]) {
  test(`${fixture.name} slow scale 1.00→1.06 removes parity reversals and is deterministic`, async (t) => {
    if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
    const root = await mkdtemp(join(tmpdir(), `akari-layer-fixed-${fixture.name.toLowerCase()}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    makeBase(join(root, "base.mp4"));
    makeStripeLayer(join(root, "layer.mp4"), fixture.layerWidth, fixture.layerHeight, fixture.cell);
    const legacyPath = join(root, "legacy.mp4");
    const fixedAPath = join(root, "fixed-a.mp4");
    const fixedBPath = join(root, "fixed-b.mp4");
    renderLegacy({ root, layerPath: join(root, "layer.mp4"), outputPath: legacyPath });
    renderFixed({ root, layerPath: "layer.mp4", outputPath: fixedAPath });
    renderFixed({ root, layerPath: "layer.mp4", outputPath: fixedBPath });

    const rowY = HEIGHT / 2;
    const initialHint = WIDTH / 2 + fixture.edgeOffset;
    const before = jitterStats(extractGray(legacyPath), { rowY, initialHint });
    const afterRaw = extractGray(fixedAPath);
    const after = jitterStats(afterRaw, { rowY, initialHint });
    t.diagnostic(`${fixture.name}: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    assert.ok(after.stdev <= 0.26, `expected residual stdev <=0.26px, got ${after.stdev}`);
    assert.ok(after.stdev < before.stdev, `expected lower residual stdev: before=${before.stdev}, after=${after.stdev}`);
    assert.ok(after.reversals < before.reversals, `expected fewer reversals: before=${before.reversals}, after=${after.reversals}`);
    assert.deepEqual(extractGray(fixedBPath), afterRaw, "two identical renders must be pixel-equivalent");

    // Also compare encoded streams so a deterministic raw decode cannot hide a differing frame
    // count or timing layout. Both files are produced by the exact same command and local inputs.
    assert.deepEqual(await readFile(fixedBPath), await readFile(fixedAPath));
  });
}
