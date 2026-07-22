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

function makeSolidSource(path, { color = "blue", width, height, duration, fps }) {
  ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

async function makeProject({ width = 640, height = 360, fps = 25, duration = 5, layers = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-layers-test-"));
  makeSolidSource(join(root, "source.mp4"), { color: "blue", width, height, duration, fps });
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width, height, fps },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: duration }],
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
    assertColor(samplePixel(outputPath, 12, opaque.x, opaque.y), [0, 0, 255], "before window, opaque-half position shows base blue");
    assertColor(samplePixel(outputPath, Math.round(2 * fps), opaque.x, opaque.y), [0, 255, 0], "during window, opaque-half position shows the layer color");
    assertColor(samplePixel(outputPath, Math.round(4 * fps), opaque.x, opaque.y), [0, 0, 255], "after window, opaque-half position shows base blue again");
    assertColor(samplePixel(outputPath, Math.round(2 * fps), transparent.x, transparent.y), [0, 0, 255], "during window, transparent-half position still shows base blue through alpha=0");
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
    assertColor(samplePixel(outputPath, Math.round(2 * fps), 320, 180), [255, 255, 255], "subject box remains opaque white");
    assertColor(samplePixel(outputPath, Math.round(2 * fps), 190, 100), [0, 0, 255], "keyed-out green area shows base blue through");
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

    assertColor(samplePixel(outputPath, 12, 320, 180), [0, 0, 255], "before window: base blue");
    assertColor(samplePixel(outputPath, Math.round(2 * fps), 320, 180), [0, 255, 255], "during window inside layer: screen(blue,lime) = cyan");
    assertColor(samplePixel(outputPath, Math.round(4 * fps), 320, 180), [0, 0, 255], "after window: base blue again");
    assertColor(samplePixel(outputPath, Math.round(2 * fps), 10, 10), [0, 0, 255], "during window outside the layer's footprint: base blue (mask gates spatially too)");

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
