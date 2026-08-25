import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { appendCutLayerStyleVisual } from "../src/cut-transform.mjs";
import { buildV2Plan } from "./helpers/v2-fixture.mjs";

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const DURATION = 2;
const GAP = 1;
const SCALE_END = 1.06;
const FFMPEG = resolveFfmpeg();
const FFPROBE = resolveFfprobe();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed (status=${result.status}, signal=${result.signal}): ${result.stderr?.toString("utf8")}`,
  );
  return result;
}

function makeStripeStill(path) {
  run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=${WIDTH}x${HEIGHT}`,
    "-vf", "geq=lum='if(eq(mod(floor(X/20)\\,2)\\,0)\\,0\\,255)':cb=128:cr=128",
    "-frames:v", "1", path,
  ]);
}

function v2MainTrackEdit({ keyframes }) {
  return {
    version: 2,
    output: { width: WIDTH, height: HEIGHT, fps: FPS },
    sources: [{ id: "still", path: "still.png", proxy: null }],
    tracks: [{
      id: "main",
      lane: "visual",
      items: [{
        id: "zoom",
        at: GAP * FPS,
        duration: DURATION * FPS,
        source: { kind: "media", src: "still", in: 0, out: DURATION },
        ...(keyframes ? {
          keyframes: [
            { t: 0, transform: { scale: 1 } },
            { t: DURATION * FPS, transform: { scale: SCALE_END } },
          ],
        } : {
          transform: { scale: SCALE_END },
          crop: { x: 0, y: 0, w: 1, h: 1 },
        }),
      }],
    }],
  };
}

function buildMainTrackPlan({ edit, projectRoot, temporaryDirectory, outputPath, sourcePath }) {
  return buildV2Plan({
    edit,
    projectRoot,
    temporaryDirectory,
    outputPath,
    capabilities: {
      sourceInputs: [{
        id: "still",
        path: sourcePath,
        hasAudio: false,
        width: WIDTH,
        height: HEIGHT,
      }],
      ffmpegCommand: FFMPEG,
      ffprobeCommand: FFPROBE,
      chromePath: "chrome",
      hyperframesAvailable: true,
      puppeteerAvailable: true,
    },
    hasSourceAudio: false,
    encodingPolicy: {
      video_encode_args: [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-color_range", "tv",
      ],
    },
  });
}

function filterComplex(plan) {
  const args = plan.commands.cut.args;
  return args[args.indexOf("-filter_complex") + 1];
}

// Exact reproduction of appendCutLayerStyleVisual's former scale-keyframe geometry: the bitmap
// changes integer dimensions every frame and is then re-centered from its changing overlay size.
function renderLegacy({ stillPath, outputPath }) {
  const scaleExpr = `(1+(${SCALE_END}-1)*(t/${DURATION}))`;
  const filter = [
    `[0:v]trim=start=0:end=${DURATION},setpts=PTS-STARTPTS,format=yuva420p,`
      + `scale=w='trunc(iw*${scaleExpr})':h='trunc(ih*${scaleExpr})':eval=frame[legacy]`,
    `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION}[background]`,
    "[background][legacy]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:format=auto:shortest=1[outv]",
  ].join(";");
  run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-loop", "1", "-i", stillPath,
    "-filter_complex", filter, "-map", "[outv]", "-t", String(DURATION),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-pix_fmt", "yuv420p",
    outputPath,
  ]);
}

function extractZoomGray(path, start = 0) {
  return run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-i", path,
    "-vf", `trim=start=${start}:end=${start + DURATION},setpts=PTS-STARTPTS,fps=${FPS},format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "-",
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

function jitterStats(raw) {
  const frameSize = WIDTH * HEIGHT;
  const frameCount = Math.floor(raw.length / frameSize);
  const positions = [];
  let hint = WIDTH / 2 + 40;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const rowStart = frame * frameSize + (HEIGHT / 2) * WIDTH;
    const position = nearestCrossing(raw.subarray(rowStart, rowStart + WIDTH), hint, 4);
    assert.notEqual(position, null, `lost tracked edge at frame ${frame}`);
    positions.push(position);
    hint = position;
  }
  const ts = positions.map((_, index) => index / FPS);
  const fit = cubicFit(ts, positions);
  const residuals = positions.map((position, index) => position - fit(ts[index]));
  const mean = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const stdev = Math.sqrt(
    residuals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / residuals.length,
  );
  const deltas = residuals.slice(1).map((value, index) => value - residuals[index]);
  let reversals = 0;
  for (let index = 1; index < deltas.length; index += 1) {
    if (Math.sign(deltas[index]) !== 0 && Math.sign(deltas[index - 1]) !== 0
      && Math.sign(deltas[index]) !== Math.sign(deltas[index - 1])) reversals += 1;
  }
  return { frameCount, stdev, reversals };
}

test("v2 main-track still zoom uses ct_gap1 fixed canvas, improves jitter, and stays deterministic", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "akari-cut-fixed-canvas-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temporaryA = join(root, "render-a");
  const temporaryB = join(root, "render-b");
  await Promise.all([mkdir(temporaryA), mkdir(temporaryB)]);
  const stillPath = join(root, "still.png");
  makeStripeStill(stillPath);

  const fixedAPath = join(temporaryA, "cut.mp4");
  const fixedBPath = join(temporaryB, "cut.mp4");
  const legacyPath = join(root, "legacy.mp4");
  const planA = buildMainTrackPlan({
    edit: v2MainTrackEdit({ keyframes: true }),
    projectRoot: root,
    temporaryDirectory: temporaryA,
    outputPath: join(root, "fixed-a.mp4"),
    sourcePath: stillPath,
  });
  const planB = buildMainTrackPlan({
    edit: v2MainTrackEdit({ keyframes: true }),
    projectRoot: root,
    temporaryDirectory: temporaryB,
    outputPath: join(root, "fixed-b.mp4"),
    sourcePath: stillPath,
  });
  const fixedFilter = filterComplex(planA);
  assert.match(fixedFilter, /ct_gap1_1_lraw/);
  assert.match(fixedFilter, /scale=w=640:h=360:flags=lanczos/);
  assert.match(fixedFilter, /pad=w=680:h=384:.*eval=frame/);
  assert.match(fixedFilter, /scale=340:192:flags=lanczos/);
  assert.doesNotMatch(fixedFilter, /scale=w='trunc\(iw\*\(/);

  run(planA.commands.cut.command, planA.commands.cut.args, { cwd: root });
  run(planB.commands.cut.command, planB.commands.cut.args, { cwd: root });
  renderLegacy({ stillPath, outputPath: legacyPath });

  const before = jitterStats(extractZoomGray(legacyPath));
  const afterRaw = extractZoomGray(fixedAPath, GAP);
  const after = jitterStats(afterRaw);
  t.diagnostic(`before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  assert.ok(after.stdev <= 0.3, `expected residual stdev <=0.30px, got ${after.stdev}`);
  assert.ok(after.stdev < before.stdev, `expected lower residual stdev: before=${before.stdev}, after=${after.stdev}`);
  assert.ok(after.reversals < before.reversals, `expected fewer reversals: before=${before.reversals}, after=${after.reversals}`);
  assert.deepEqual(extractZoomGray(fixedBPath, GAP), afterRaw, "two identical renders must be pixel-equivalent");
  assert.deepEqual(await readFile(fixedBPath), await readFile(fixedAPath));
});

test("v2 main-track keyframe-less cut keeps its gap-aware filter byte-for-byte unchanged", () => {
  const plan = buildMainTrackPlan({
    edit: v2MainTrackEdit({ keyframes: false }),
    projectRoot: "/project",
    temporaryDirectory: "/project/render-tmp",
    outputPath: "/project/out.mp4",
    sourcePath: "/project/still.png",
  });
  assert.equal(
    filterComplex(plan),
    "color=c=black:s=320x180:r=30:d=1[gv1_0];[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[gv1raw1];[gv1raw1]format=yuva420p[ct_gap1_1_lraw];[ct_gap1_1_lraw]crop=trunc(iw*1/2)*2:trunc(ih*1/2)*2:trunc(iw*0/2)*2:trunc(ih*0/2)*2,scale=trunc(iw*1.06):trunc(ih*1.06)[ct_gap1_1_lprocessed];color=c=black:s=320x180:r=30:d=2[ct_gap1_1_lbackground];[ct_gap1_1_lbackground][ct_gap1_1_lprocessed]overlay=x=(main_w-overlay_w)/2+0:y=(main_h-overlay_h)/2+0:format=auto:shortest=1[gv1_1];[gv1_0][gv1_1]concat=n=2:v=1:a=0[joinedv];anullsrc=r=48000:cl=stereo,atrim=duration=2,asetpts=PTS-STARTPTS[araw1_0];[araw1_0]adelay=1000:all=1[adelay1_0];[adelay1_0]apad=whole_dur=3[joineda];[joinedv]scale=out_range=tv[outv_tv]",
  );
});

test("perspective, rotate, and non-normal blend keep the compatibility scale path", () => {
  const scaleKeyframes = [
    { t: 0, transform: { scale: 1 } },
    { t: DURATION, transform: { scale: SCALE_END } },
  ];
  const unsafeCuts = [
    { blend: "screen", keyframes: scaleKeyframes },
    {
      perspective: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      keyframes: scaleKeyframes,
    },
    { transform: { rotate: 5 }, keyframes: scaleKeyframes },
    {
      keyframes: [
        { t: 0, transform: { scale: 1, rotate: 0 } },
        { t: DURATION, transform: { scale: SCALE_END, rotate: 5 } },
      ],
    },
  ];
  for (const [index, cut] of unsafeCuts.entries()) {
    const filters = [];
    appendCutLayerStyleVisual({
      filters,
      inputLabel: "[in]",
      outputLabel: "[out]",
      cut,
      id: `unsafe_${index}`,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      duration: DURATION,
      sourceWidth: WIDTH,
      sourceHeight: HEIGHT,
    });
    const filter = filters.join(";");
    assert.match(filter, /scale=w='trunc\(iw\*\(/);
    assert.doesNotMatch(filter, /scale=w=640:h=360:flags=lanczos/);
  }
});
