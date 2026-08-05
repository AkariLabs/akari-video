import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLayersCompositeCommand, hasLayers } from "../src/layers.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// Samples a single pixel's RGB at an exact frame number (frame-accurate `select`, unlike -ss
// seeking which can land on an adjacent frame near GOP/keyframe boundaries).
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
  const buf = result.stdout;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

function assertColor(pixel, [r, g, b], label, tolerance = 20) {
  const close = (a, e) => Math.abs(a - e) <= tolerance;
  assert.ok(
    close(pixel.r, r) && close(pixel.g, g) && close(pixel.b, b),
    `${label}: expected ~(${r},${g},${b}), got (${pixel.r},${pixel.g},${pixel.b})`,
  );
}

// A solid-color ProRes4444 alpha mov whose left half (local x < width/2) is fully opaque and whose
// right half is fully transparent, authored in 8-bit yuva420p before the prores_ks upconvert (see
// task investigation notes: writing alpha=255 directly in a 10/12-bit geq plane silently produces
// only a ~25% opaque value, since geq's literal values are interpreted in the plane's own bit
// depth — authoring in 8-bit first and letting ffmpeg's format conversion rescale avoids that).
function makeBakedAlphaLayer(path, { color = "0x00FF00", width, height, duration, fps }) {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf",
    `format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,${Math.floor(width / 2)}),255,0)'`,
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4444",
    "-pix_fmt",
    "yuva444p10le",
    path,
  ]);
}

// A green-screen "real footage" PinP layer with a white subject box, plain h264 (no alpha) —
// stands in for a captured video source that needs chroma_key to become compositable.
function makeVideoPinpLayer(path, { width, height, duration, fps }) {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=0x00FF00:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf",
    `drawbox=x=${Math.floor(width * 0.2)}:y=${Math.floor(height * 0.2)}:w=${Math.floor(width * 0.6)}:h=${Math.floor(height * 0.6)}:color=white:t=fill`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
}

// A 2x2 quadrant grid PinP source (no alpha, plain h264) used for crop pixel measurements:
// TL=red, TR=lime, BL=yellow, BR=magenta. Quadrant boundaries land on exact pixel counts
// (width/height chosen divisible by 4) so crop=/scale= trunc(.../2)*2 rounding never nudges a
// boundary across a sample point. Uses "lime" rather than ffmpeg's named "green" — the latter is
// the X11 dark-green (0,128,0), not pure (0,255,0), which would silently fail assertColor's
// tolerance-20 comparisons against [0,255,0].
function makeQuadrantLayer(path, { width, height, duration, fps }) {
  const halfW = width / 2;
  const halfH = height / 2;
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf",
    [
      `drawbox=x=0:y=0:w=${halfW}:h=${halfH}:color=red:t=fill`,
      `drawbox=x=${halfW}:y=0:w=${halfW}:h=${halfH}:color=lime:t=fill`,
      `drawbox=x=0:y=${halfH}:w=${halfW}:h=${halfH}:color=yellow:t=fill`,
      `drawbox=x=${halfW}:y=${halfH}:w=${halfW}:h=${halfH}:color=magenta:t=fill`,
    ].join(","),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
}

function makeSolidSource(path, { color = "blue", width, height, duration, fps }) {
  ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

async function makeProject({
  width = 640,
  height = 360,
  fps = 25,
  duration = 5,
  layers = [],
  cuts,
  look,
  sourceDuration = duration,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-layers-test-"));
  makeSolidSource(join(root, "source.mp4"), { color: "blue", width, height, duration: sourceDuration, fps });
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width, height, fps, ...(look ? { look } : {}) },
        source: { path: "source.mp4", proxy: null },
        cuts: cuts ?? [{ in: 0, out: duration }],
        overlays: [],
        layers,
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("hasLayers is false for missing/empty layers and true once populated", () => {
  assert.equal(hasLayers({}), false);
  assert.equal(hasLayers({ layers: [] }), false);
  assert.equal(hasLayers({ layers: [{ id: "a" }] }), true);
});

test("buildLayersCompositeCommand: a normal-blend layer uses itsoffset + trim + overlay with a time-window enable clause", () => {
  const { args } = buildLayersCompositeCommand({
    layers: [{ id: "fx", t: 2, duration: 3, kind: "baked", src: "fx.mov" }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 10,
  });
  assert.ok(args.includes("-itsoffset"));
  assert.ok(args.includes("2"));
  assert.ok(args.includes("/project/fx.mov"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /trim=duration=3/);
  assert.match(filterComplex, /overlay=x=\(main_w-overlay_w\)\/2\+0:y=\(main_h-overlay_h\)\/2\+0/);
  assert.match(filterComplex, /enable='between\(t,2,5\)'/);
  assert.doesNotMatch(filterComplex, /blend=all_mode/);
});

test("buildLayersCompositeCommand: a non-normal blend layer goes through the trim/pad/blend/maskedmerge/concat segment path in gbrp", () => {
  const { args } = buildLayersCompositeCommand({
    layers: [{ id: "fx", t: 2, duration: 3, kind: "baked", src: "fx.mov", blend: "screen" }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 10,
    width: 640,
    height: 360,
  });
  assert.ok(!args.includes("-itsoffset"), "blend-mode layers should not use itsoffset (they trim `previous` instead)");
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /pad=640:360:x=\(ow-iw\)\/2\+0:y=\(oh-ih\)\/2\+0:color=black@0/);
  assert.match(filterComplex, /blend=all_mode=screen/);
  assert.match(filterComplex, /maskedmerge/);
  assert.match(filterComplex, /format=gbrp/);
  assert.match(filterComplex, /alphaextract/);
  assert.match(filterComplex, /concat=n=3:v=1:a=0/); // before + during + after segments
});

test("buildLayersCompositeCommand: layer.crop inserts a crop= step before scale, x+w/y+h expressed via iw/ih", () => {
  const { args } = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 0,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.6 },
        transform: { scale: 2 },
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /crop=trunc\(iw\*0\.5\/2\)\*2:trunc\(ih\*0\.6\/2\)\*2:trunc\(iw\*0\.25\/2\)\*2:trunc\(ih\*0\.1\/2\)\*2/);
  const cropIndex = filterComplex.indexOf("crop=");
  const scaleIndex = filterComplex.indexOf("scale=");
  assert.ok(cropIndex >= 0 && scaleIndex >= 0 && cropIndex < scaleIndex, "crop= must appear before scale= in the filter chain");
});

test("buildLayersCompositeCommand: layer without crop emits no crop= step (byte-identical filter chain)", () => {
  const { args } = buildLayersCompositeCommand({
    layers: [{ id: "fx", t: 0, duration: 2, kind: "baked", src: "fx.mov" }],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(filterComplex, /crop=/);
});

test("buildLayersCompositeCommand: a chroma_key video layer inserts the chromakey filter", () => {
  const { args } = buildLayersCompositeCommand({
    layers: [
      {
        id: "pinp",
        t: 0,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        chroma_key: { color: "0x00FF00", similarity: 0.2, blend: 0.1 },
      },
    ],
    projectRoot: "/project",
    ffmpegCommand: "ffmpeg",
    inputPath: "/project/.akari/render-tmp/cut.mp4",
    outputPath: "/project/.akari/render-tmp/layered.mp4",
    duration: 5,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /chromakey=color=0x00FF00:similarity=0\.2:blend=0\.1/);
});

// Acceptance 1: a lavfi-authored alpha ProRes4444 mov composited onto the base — transparency,
// transform placement, and the t/duration time window all measured on real render-cut output.
test("baked alpha layer: transparency, transform placement, and time window are all correct in the real render", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  const duration = 5;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "fx-baked",
        t: 1,
        duration: 2,
        kind: "baked",
        src: "layer.mov",
        transform: { x: 50, y: -30, scale: 1, rotate: 0 },
      },
    ],
  });
  try {
    makeBakedAlphaLayer(join(project, "layer.mov"), { color: "0x00FF00", width: 300, height: 200, duration: 2, fps });
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    // layer centered at (640-300)/2+50=220, (360-200)/2-30=50 => spans (220,50)-(520,250).
    // Opaque half (local x<150): global x in [220,370). Transparent half: global x in [370,520).
    const opaque = { x: 295, y: 150 };
    const transparent = { x: 445, y: 150 };
    const beforeOpaque = samplePixel(outputPath, 12, opaque.x, opaque.y);
    const duringOpaque = samplePixel(outputPath, Math.round(2 * fps), opaque.x, opaque.y);
    const afterOpaque = samplePixel(outputPath, Math.round(4 * fps), opaque.x, opaque.y);
    const duringTransparent = samplePixel(outputPath, Math.round(2 * fps), transparent.x, transparent.y);
    t.diagnostic(`before-window opaque-half (${opaque.x},${opaque.y}) rgb=(${beforeOpaque.r},${beforeOpaque.g},${beforeOpaque.b})`);
    t.diagnostic(`during-window opaque-half (${opaque.x},${opaque.y}) rgb=(${duringOpaque.r},${duringOpaque.g},${duringOpaque.b})`);
    t.diagnostic(`after-window opaque-half (${opaque.x},${opaque.y}) rgb=(${afterOpaque.r},${afterOpaque.g},${afterOpaque.b})`);
    t.diagnostic(`during-window transparent-half (${transparent.x},${transparent.y}) rgb=(${duringTransparent.r},${duringTransparent.g},${duringTransparent.b})`);
    assertColor(beforeOpaque, [0, 0, 255], "before window, opaque-half position shows base blue");
    assertColor(duringOpaque, [0, 255, 0], "during window, opaque-half position shows the layer color");
    assertColor(afterOpaque, [0, 0, 255], "after window, opaque-half position shows base blue again");
    assertColor(duringTransparent, [0, 0, 255], "during window, transparent-half position still shows base blue through alpha=0");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// Acceptance 2: a real "video" kind PinP layer with chroma_key — the green background is keyed
// out (base shows through) while the subject remains, sampled at exact pixel positions.
test("video PinP layer with chroma_key: green background is keyed transparent, subject remains opaque", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  const duration = 5;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        chroma_key: { color: "0x00FF00", similarity: 0.15, blend: 0 },
      },
    ],
  });
  try {
    makeVideoPinpLayer(join(project, "guest.mp4"), { width: 300, height: 200, duration: 2, fps });
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    // layer centered at (170,80)-(470,280). subject box is the inner 60% (local 60..240,40..160)
    // => global (230,120)-(410,240); sample its center. Green (keyed) area sampled near a corner.
    const subject = samplePixel(outputPath, Math.round(2 * fps), 320, 180);
    const keyedGreen = samplePixel(outputPath, Math.round(2 * fps), 190, 100);
    t.diagnostic(`subject box (320,180) rgb=(${subject.r},${subject.g},${subject.b})`);
    t.diagnostic(`keyed-out green area (190,100) rgb=(${keyedGreen.r},${keyedGreen.g},${keyedGreen.b})`);
    assertColor(subject, [255, 255, 255], "subject box remains opaque white");
    assertColor(keyedGreen, [0, 0, 255], "keyed-out green area shows base blue through");
    assertColor(samplePixel(outputPath, 12, 190, 100), [0, 0, 255], "before window, same position shows base blue");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// Acceptance 3: blend="screen" — screen(blue, lime) == cyan by the standard formula
// (1-(1-a)(1-b) per channel), measured on the real render-cut output, both inside and outside
// the layer's spatial+temporal bounds.
test("blend=screen composites correctly: screen(blue, lime) reads as cyan inside the window, base blue outside it", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  const duration = 5;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "fx-screen",
        t: 1,
        duration: 2,
        kind: "baked",
        src: "layer.mov",
        blend: "screen",
      },
    ],
  });
  try {
    // Fully opaque (alpha=255 everywhere) so the whole layer footprint participates in the blend.
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `color=c=0x00FF00:s=300x200:d=2:r=${fps}`,
      "-vf",
      "format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255'",
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4444",
      "-pix_fmt",
      "yuva444p10le",
      join(project, "layer.mov"),
    ]);
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    const before = samplePixel(outputPath, 12, 320, 180);
    const during = samplePixel(outputPath, Math.round(2 * fps), 320, 180);
    const after = samplePixel(outputPath, Math.round(4 * fps), 320, 180);
    const duringOutside = samplePixel(outputPath, Math.round(2 * fps), 10, 10);
    t.diagnostic(`before window (320,180) rgb=(${before.r},${before.g},${before.b})`);
    t.diagnostic(`during window inside layer (320,180) rgb=(${during.r},${during.g},${during.b}) [expected screen(blue,lime)=cyan]`);
    t.diagnostic(`after window (320,180) rgb=(${after.r},${after.g},${after.b})`);
    t.diagnostic(`during window outside layer footprint (10,10) rgb=(${duringOutside.r},${duringOutside.g},${duringOutside.b})`);
    assertColor(before, [0, 0, 255], "before window: base blue");
    assertColor(during, [0, 255, 255], "during window inside layer: screen(blue,lime) = cyan");
    assertColor(after, [0, 0, 255], "after window: base blue again");
    assertColor(duringOutside, [0, 0, 255], "during window outside the layer's footprint: base blue (mask gates spatially too)");

    const probed = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath], { encoding: "utf8" });
    assert.ok(Math.abs(Number(probed.stdout.trim()) - duration) <= state.plan.duration_tolerance_seconds, `expected output duration ~${duration}s, got ${probed.stdout}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// Acceptance 4: layers-less edit.json (key entirely absent vs. an explicit empty array) must
// produce byte-identical output, and the plan must show no `layers` command was even built —
// proving the new compositing stage is skipped outright rather than merely a no-op pass.
test("layers absent vs. layers: [] both skip the compositing stage and render byte-identical output", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 320;
  const height = 180;
  const fps = 10;
  const duration = 2;
  const withEmptyArray = await makeProject({ width, height, fps, duration, layers: [] });
  const withoutKeyAtAll = await makeProject({ width, height, fps, duration });
  // makeProject always writes a `layers` key (defaulting to []); rewrite edit.json to omit it
  // entirely so this test covers the "key never present" shape too, not just "empty array".
  const editPath = join(withoutKeyAtAll, "edit.json");
  const edit = JSON.parse(await readFile(editPath, "utf8"));
  delete edit.layers;
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  try {
    const executedA = run(withEmptyArray);
    const executedB = run(withoutKeyAtAll);
    assert.equal(executedA.status, 0, executedA.stderr);
    assert.equal(executedB.status, 0, executedB.stderr);
    const stateA = JSON.parse(await readFile(join(withEmptyArray, ".akari", "render.json"), "utf8"));
    const stateB = JSON.parse(await readFile(join(withoutKeyAtAll, ".akari", "render.json"), "utf8"));
    assert.equal(stateA.plan.commands.layers, null);
    assert.equal(stateB.plan.commands.layers, null);
    assert.equal(stateA.artifacts[0].sha256, stateB.artifacts[0].sha256);
  } finally {
    await rm(withEmptyArray, { recursive: true, force: true });
    await rm(withoutKeyAtAll, { recursive: true, force: true });
  }
});

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// Rebase re-verification (2026-07-22, post R1 render-basics merge a776917): layers[] must
// composite correctly on top of a cutPath that R1's cuts[].speed (setpts speed scaling) and
// output.look (LUT via ffmpeg lut3d/blend) have already transformed — layers is a stage added
// strictly after buildCutCommand's output, so (a) the overall timeline duration must reflect
// speed (not the raw cut length), and (b) the layer's own color must NOT be graded by the LUT
// (the LUT only applies to the base, inside buildCutCommand, before layers.mjs ever runs),
// while the base pixels elsewhere on the frame ARE graded, exactly as without layers.
test("layers composite correctly on top of R1's cuts[].speed + output.look LUT pipeline", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  // source is 6s; cuts trims [0,4) at speed=2 -> predicted timeline duration = (4-0)/2 = 2s.
  const cuts = [{ in: 0, out: 4, speed: 2 }];
  const look = { lut: "cinematic", intensity: 1 };
  const layerWindow = { t: 0.5, duration: 1 }; // window [0.5, 1.5) within the 2s post-speed timeline
  const withLayers = await makeProject({
    width,
    height,
    fps,
    duration: 2,
    sourceDuration: 6,
    cuts,
    look,
    layers: [
      {
        id: "fx-on-speed-lut",
        ...layerWindow,
        kind: "baked",
        src: "layer.mov",
      },
    ],
  });
  const withoutLayers = await makeProject({ width, height, fps, duration: 2, sourceDuration: 6, cuts, look, layers: [] });
  try {
    makeBakedAlphaLayer(join(withLayers, "layer.mov"), { color: "0x00FF00", width: 300, height: 200, duration: layerWindow.duration, fps });
    const executedWith = run(withLayers);
    const executedWithout = run(withoutLayers);
    assert.equal(executedWith.status, 0, executedWith.stderr);
    assert.equal(executedWithout.status, 0, executedWithout.stderr);
    const stateWith = JSON.parse(await readFile(join(withLayers, ".akari", "render.json"), "utf8"));
    const stateWithout = JSON.parse(await readFile(join(withoutLayers, ".akari", "render.json"), "utf8"));
    assert.equal(stateWith.verify.verdict, "pass");
    assert.equal(stateWithout.verify.verdict, "pass");

    // (a) speed math flows through unchanged: predicted + measured duration is ~2s, not 4s.
    assert.ok(Math.abs(stateWith.plan.predicted_duration_seconds - 2) < 1e-6, `expected predicted duration 2s, got ${stateWith.plan.predicted_duration_seconds}`);
    t.diagnostic(`with-layers measured duration=${stateWith.artifacts[0].ffprobe.duration_seconds}s; without-layers=${stateWithout.artifacts[0].ffprobe.duration_seconds}s (both expected ~2s)`);
    assert.ok(Math.abs(stateWith.artifacts[0].ffprobe.duration_seconds - 2) <= stateWith.plan.duration_tolerance_seconds);
    assert.ok(Math.abs(stateWithout.artifacts[0].ffprobe.duration_seconds - 2) <= stateWithout.plan.duration_tolerance_seconds);

    const outputWith = join(withLayers, stateWith.artifacts[0].path);
    const outputWithout = join(withoutLayers, stateWithout.artifacts[0].path);
    // layer centered at (640-300)/2=170,(360-200)/2=80 -> opaque half (local x<150) sampled at (245,150).
    const opaqueX = 245;
    const sampleY = 150;
    const beforeFrame = Math.round(0.1 * fps); // t=0.1, well before the [0.5,1.5) window
    const duringFrame = Math.round(1.0 * fps); // t=1.0, inside the window

    const beforeWith = samplePixel(outputWith, beforeFrame, opaqueX, sampleY);
    const beforeWithout = samplePixel(outputWithout, beforeFrame, opaqueX, sampleY);
    const duringWith = samplePixel(outputWith, duringFrame, opaqueX, sampleY);
    const duringWithout = samplePixel(outputWithout, duringFrame, opaqueX, sampleY);
    t.diagnostic(`before window (LUT-graded base only): with-layers=(${beforeWith.r},${beforeWith.g},${beforeWith.b}) without-layers=(${beforeWithout.r},${beforeWithout.g},${beforeWithout.b})`);
    t.diagnostic(`during window: with-layers=(${duringWith.r},${duringWith.g},${duringWith.b}) [expect ~pure lime, un-graded] without-layers=(${duringWithout.r},${duringWithout.g},${duringWithout.b}) [LUT-graded base]`);

    // Outside the layer's window, my stage must not touch anything R1's cut pipeline produced:
    // with-layers and without-layers must show the same (LUT-graded) base color.
    assert.ok(colorDistance(beforeWith, beforeWithout) < 10, `expected before-window pixels to match (both just R1's LUT-graded base): with=${JSON.stringify(beforeWith)} without=${JSON.stringify(beforeWithout)}`);
    // Inside the window, the layer is visibly composited (with-layers must differ substantially
    // from without-layers, which just keeps showing the graded base at that instant).
    assert.ok(colorDistance(duringWith, duringWithout) > 60, `expected the layer to visibly change the during-window pixel versus the no-layers baseline: with=${JSON.stringify(duringWith)} without=${JSON.stringify(duringWithout)}`);
    // The layer's own color must be essentially un-graded (added after buildCutCommand's LUT
    // stage), i.e. close to pure lime (0,255,0), not blended toward cinematic's shadow/highlight push.
    assertColor(duringWith, [0, 255, 0], "layer color during the window should be ~pure lime, unaffected by output.look's LUT", 30);
  } finally {
    await rm(withLayers, { recursive: true, force: true });
    await rm(withoutLayers, { recursive: true, force: true });
  }
});

// Closes the rotate gap flagged as a deviation in the first PASS report (schema + ffmpeg args
// were smoke-tested only, no pixel measurement). rotate=180 is direction-agnostic (clockwise vs
// counterclockwise conventions agree at 180deg), so it deterministically swaps the previously
// opaque (local x<150) and transparent (local x>=150) halves without needing to know ffmpeg
// rotate's exact positive-angle direction.
test("transform.rotate=180 flips the layer's content within its footprint (pixel measurement)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  const duration = 3;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "fx-rotated",
        t: 0.5,
        duration: 2,
        kind: "baked",
        src: "layer.mov",
        transform: { x: 0, y: 0, scale: 1, rotate: 180 },
      },
    ],
  });
  try {
    makeBakedAlphaLayer(join(project, "layer.mov"), { color: "0x00FF00", width: 300, height: 200, duration: 2, fps });
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    // Unrotated footprint: (170,80)-(470,280). Originally-opaque local x<150 -> global x in
    // [170,320); originally-transparent local x>=150 -> global x in [320,470). rotate=180 swaps
    // them: the point that used to be opaque (295,150) should now show base blue, and the point
    // that used to be transparent (445,150) should now show the layer's lime.
    const frame = Math.round(1.5 * fps); // well inside the [0.5, 2.5) window
    const wasOpaque = samplePixel(outputPath, frame, 295, 150);
    const wasTransparent = samplePixel(outputPath, frame, 445, 150);
    t.diagnostic(`rotate=180: previously-opaque position (295,150) rgb=(${wasOpaque.r},${wasOpaque.g},${wasOpaque.b}) [expect base blue now]`);
    t.diagnostic(`rotate=180: previously-transparent position (445,150) rgb=(${wasTransparent.r},${wasTransparent.g},${wasTransparent.b}) [expect lime now]`);
    assertColor(wasOpaque, [0, 0, 255], "180-degree rotation moves the opaque half away from its unrotated position");
    assertColor(wasTransparent, [0, 255, 0], "180-degree rotation moves the opaque half into what was the transparent half's position");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// L1 acceptance — crop position case 1: layers[].crop selects only the source's top-left
// quadrant (red). The composited footprint must show only that quadrant's color; the area that
// the *uncropped* layer would have covered (but the now-smaller cropped footprint no longer
// does) must show the base color through, proving crop actually shrinks the footprint rather
// than just masking pixels in place.
test("layers[].crop position case 1 (top-left quadrant): footprint shows only the cropped region, base shows through elsewhere", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  const duration = 3;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "pinp-cropped",
        t: 0.5,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        crop: { x: 0, y: 0, w: 0.5, h: 0.5 },
      },
    ],
  });
  try {
    // source quadrants are 200x150 (400x300 source, halved) — TL=red, TR=lime, BL=yellow, BR=magenta.
    makeQuadrantLayer(join(project, "guest.mp4"), { width: 400, height: 300, duration: 2, fps });
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    // Cropped footprint (200x150, unscaled) centers at (640-200)/2=220,(360-150)/2=105 => spans
    // (220,105)-(420,255). Sample its center (red, the only quadrant left after crop).
    const frame = Math.round(1.5 * fps);
    const insideCrop = samplePixel(outputPath, frame, 320, 180);
    // Just outside the cropped footprint's right edge, but still within where the *uncropped*
    // 400x300 layer would have shown its lime (top-right) quadrant — must now show base blue.
    const outsideCrop = samplePixel(outputPath, frame, 460, 180);
    t.diagnostic(`crop TL: inside cropped footprint (320,180) rgb=(${insideCrop.r},${insideCrop.g},${insideCrop.b}) [expect red]`);
    t.diagnostic(`crop TL: outside cropped footprint but inside uncropped bounds (460,180) rgb=(${outsideCrop.r},${outsideCrop.g},${outsideCrop.b}) [expect base blue]`);
    assertColor(insideCrop, [255, 0, 0], "crop={x:0,y:0,w:0.5,h:0.5} keeps only the top-left (red) quadrant");
    assertColor(outsideCrop, [0, 0, 255], "the shrunk footprint no longer covers what the uncropped layer would have (base blue shows through)");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// L1 acceptance — crop position case 2: a different quadrant (bottom-right, magenta), proving
// crop.x/crop.y actually offset into the source rather than only crop.w/crop.h changing extent.
test("layers[].crop position case 2 (bottom-right quadrant): x/y offset selects the correct sub-rectangle", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 360;
  const fps = 25;
  const duration = 3;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "pinp-cropped-br",
        t: 0.5,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      },
    ],
  });
  try {
    makeQuadrantLayer(join(project, "guest.mp4"), { width: 400, height: 300, duration: 2, fps });
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    const frame = Math.round(1.5 * fps);
    const insideCrop = samplePixel(outputPath, frame, 320, 180);
    t.diagnostic(`crop BR: inside cropped footprint (320,180) rgb=(${insideCrop.r},${insideCrop.g},${insideCrop.b}) [expect magenta]`);
    assertColor(insideCrop, [255, 0, 255], "crop={x:0.5,y:0.5,w:0.5,h:0.5} keeps only the bottom-right (magenta) quadrant");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// L1 acceptance — crop + scale + rotate combined: proves the applied order is crop → scale →
// rotate (per contract-2026-08-02-preview-parity.md), not e.g. rotate-then-crop. crop selects the
// source's right half (lime top / magenta bottom, 200x300 of the 400x300 source), scale=1.5
// grows it to 300x450, and rotate=180 flips top/bottom — exactly mirroring the existing
// (crop-less) "transform.rotate=180" acceptance test's swap logic, but on a crop-selected region.
test("layers[].crop combined with transform.scale + transform.rotate applies crop before scale/rotate", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 640;
  const height = 480;
  const fps = 25;
  const duration = 3;
  const project = await makeProject({
    width,
    height,
    fps,
    duration,
    layers: [
      {
        id: "pinp-cropped-scaled-rotated",
        t: 0.5,
        duration: 2,
        kind: "video",
        src: "guest.mp4",
        transform: { x: 0, y: 0, scale: 1.5, rotate: 180 },
        crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
      },
    ],
  });
  try {
    makeQuadrantLayer(join(project, "guest.mp4"), { width: 400, height: 300, duration: 2, fps });
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const outputPath = join(project, state.artifacts[0].path);

    // crop keeps the right half (200x300) => scale=1.5 -> 300x450 => rotate=180 keeps the 300x450
    // bounding box but flips content. Footprint centers at (640-300)/2=170,(480-450)/2=15 =>
    // spans (170,15)-(470,465), vertical midpoint at y=240. Unrotated, local y<225 (screen y<240)
    // would be lime (originally top-right); rotate=180 flips it to magenta, and vice versa.
    const frame = Math.round(1.5 * fps);
    const upperHalf = samplePixel(outputPath, frame, 320, 100); // screen y=100 < 240 midpoint
    const lowerHalf = samplePixel(outputPath, frame, 320, 380); // screen y=380 > 240 midpoint
    const outsideFootprint = samplePixel(outputPath, frame, 10, 10);
    t.diagnostic(`crop+scale+rotate: upper-half sample (320,100) rgb=(${upperHalf.r},${upperHalf.g},${upperHalf.b}) [expect magenta post-rotate]`);
    t.diagnostic(`crop+scale+rotate: lower-half sample (320,380) rgb=(${lowerHalf.r},${lowerHalf.g},${lowerHalf.b}) [expect lime post-rotate]`);
    assertColor(upperHalf, [255, 0, 255], "rotate=180 moves the originally-bottom (magenta) half of the cropped+scaled region to the top");
    assertColor(lowerHalf, [0, 255, 0], "rotate=180 moves the originally-top (lime) half of the cropped+scaled region to the bottom");
    assertColor(outsideFootprint, [0, 0, 255], "outside the crop+scale+rotate footprint, base blue still shows through");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// L1 non-regression: a project with a layer that has no crop field renders byte-identical output
// to the same project before this feature existed (verified here by re-running twice and diffing
// sha256 — the layer's own filter chain must contain no crop= step at all, see the unit test
// above; this closes the loop with a real render + hash comparison).
test("layers[] without a crop field renders byte-identical output across repeated runs (no crop regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const width = 320;
  const height = 180;
  const fps = 10;
  const duration = 2;
  const layers = [
    {
      id: "pinp-no-crop",
      t: 0.2,
      duration: 1,
      kind: "video",
      src: "guest.mp4",
      transform: { x: 10, y: -5, scale: 0.8, rotate: 15 },
    },
  ];
  const projectA = await makeProject({ width, height, fps, duration, layers });
  const projectB = await makeProject({ width, height, fps, duration, layers });
  try {
    makeQuadrantLayer(join(projectA, "guest.mp4"), { width: 200, height: 100, duration: 1, fps });
    makeQuadrantLayer(join(projectB, "guest.mp4"), { width: 200, height: 100, duration: 1, fps });
    const executedA = run(projectA);
    const executedB = run(projectB);
    assert.equal(executedA.status, 0, executedA.stderr);
    assert.equal(executedB.status, 0, executedB.stderr);
    const stateA = JSON.parse(await readFile(join(projectA, ".akari", "render.json"), "utf8"));
    const stateB = JSON.parse(await readFile(join(projectB, ".akari", "render.json"), "utf8"));
    assert.equal(stateA.artifacts[0].sha256, stateB.artifacts[0].sha256, "no-crop layers must render byte-identical output (determinism, no crop= step involved)");
  } finally {
    await rm(projectA, { recursive: true, force: true });
    await rm(projectB, { recursive: true, force: true });
  }
});
