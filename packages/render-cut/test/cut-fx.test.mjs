import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FX_IDS, hasCutFx, normalizeCutFxList } from "../src/fx.mjs";
import { buildCutCommand } from "../src/plan.mjs";

// docs/contract-2026-08-05-fx-v0.md / 2026-08-06 glow split-leak regression (task
// 2026-08-06-fx-glow-split-fix): ffmpeg's filtergraph forbids reusing the same labeled pad as
// the input to more than one filter without an explicit split/asplit first (raw -i stream
// references like [0:v]/[0:a] are the one exception -- ffmpeg fans those out internally). The
// glow builder (particles/flare) used to consume its inputLabel twice without splitting, which
// happened to render correctly for a single isolated cut but produced an undefined-length output
// once the same filtergraph carried a second cut. This helper statically counts label reuse so a
// future regression is caught before it needs a real render to notice.
function filterComplexInputCounts(filterComplex) {
  const counts = new Map();
  for (const statement of filterComplex.split(";")) {
    const leading = statement.match(/^(\[[^\]]+\])+/);
    if (!leading) continue;
    const labels = leading[0].match(/\[[^\]]+\]/g) ?? [];
    for (const label of labels) {
      if (/^\[\d+:[a-z]+\]$/.test(label)) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}

function assertNoDoubleConsumedLabels(filterComplex, context) {
  for (const [label, count] of filterComplexInputCounts(filterComplex)) {
    assert.ok(count <= 1, `${context}: label ${label} is consumed as a filter input ${count} times without an explicit split first`);
  }
}

// docs/contract-2026-08-05-fx-v0.md: L1 承認は「フィクスチャ動画の実レンダで FX ごとの特徴を
// 実測」— このファイルは実際に ffmpeg を都度実行し、デコードした生ピクセルを測る（コマンド
// プランに文字列が含まれるかだけを見るテストは書かない）。

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

const FX_INDEX_JSONL_FIELDS = ["id", "kind", "name", "description", "when_to_use", "tags", "params", "ai_usage", "source"];

test("presets/fx/index.jsonl is self-describing and matches the fx.mjs dispatch table exactly", async () => {
  const raw = await readFile(join(repoRoot, "presets", "fx", "index.jsonl"), "utf8");
  const lines = raw.trim().split("\n").filter((line) => line.trim() !== "");
  const entries = lines.map((line, index) => {
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(line); }, `index.jsonl line ${index + 1} is not valid JSON`);
    return parsed;
  });

  const seenIds = new Set();
  for (const [index, entry] of entries.entries()) {
    for (const field of FX_INDEX_JSONL_FIELDS) {
      assert.ok(Object.hasOwn(entry, field), `index.jsonl entry ${index} is missing required field "${field}"`);
    }
    assert.equal(entry.kind, "fx", `index.jsonl entry ${index} (${entry.id}) must have kind:"fx"`);
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, `index.jsonl entry ${index} (${entry.id}) must have a non-empty tags array`);
    assert.ok(Array.isArray(entry.params) && entry.params.some((p) => p.key === "intensity"), `index.jsonl entry ${index} (${entry.id}) must declare an intensity param`);
    assert.ok(!seenIds.has(entry.id), `index.jsonl has a duplicate id: ${entry.id}`);
    seenIds.add(entry.id);
  }

  const indexIds = entries.map((entry) => entry.id).sort();
  const dispatchIds = [...FX_IDS].sort();
  assert.deepEqual(indexIds, dispatchIds, "presets/fx/index.jsonl ids must exactly match fx.mjs's FX_IDS dispatch table");

  const schema = JSON.parse(await readFile(join(repoRoot, "packages", "schemas", "edit.schema.json"), "utf8"));
  const schemaIds = [...schema.$defs.cutFx.properties.id.enum].sort();
  assert.deepEqual(indexIds, schemaIds, "presets/fx/index.jsonl ids must exactly match edit.schema.json's $defs/cutFx id enum");
});

const WIDTH = 64;
const HEIGHT = 64;
const FPS = 10;
const DURATION = 2;
const FRAME_COUNT = WIDTH * HEIGHT * 3;

function ffmpegAvailable() {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "buffer" });
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result;
}

async function makeSourceFile(root) {
  const sourcePath = join(root, "source.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${DURATION}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath,
  ]);
  return sourcePath;
}

function buildCutFxCommand({ sourcePath, cutPath, fx, look, projectRoot }) {
  return buildCutCommand({
    sourcePath,
    cutPath,
    cuts: [{ in: 0, out: DURATION, ...(fx ? { fx } : {}) }],
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    hasAudio: false,
    duration: DURATION,
    projectRoot,
    look,
  });
}

async function renderFx(root, fx, { name = "cut", look } = {}) {
  const sourcePath = await makeSourceFile(root);
  const cutPath = join(root, `${name}.mp4`);
  const command = buildCutFxCommand({ sourcePath, cutPath, fx, look, projectRoot: root });
  run(command.command, command.args);
  return cutPath;
}

// Every decoded frame back-to-back as one rgb24 buffer (frameCount * WIDTH*HEIGHT*3 bytes).
function dumpFrames(path, frameCount) {
  const result = run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-i", path, "-frames:v", String(frameCount),
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return result.stdout;
}

function frameSlice(buf, index) {
  return buf.subarray(index * FRAME_COUNT, (index + 1) * FRAME_COUNT);
}

function avgRegion(frame, x0, y0, x1, y1) {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      sum += (frame[offset] + frame[offset + 1] + frame[offset + 2]) / 3;
      n += 1;
    }
  }
  return sum / n;
}

function avgCornerLuma(frame) {
  const size = 8;
  const corners = [
    avgRegion(frame, 0, 0, size, size),
    avgRegion(frame, WIDTH - size, 0, WIDTH, size),
    avgRegion(frame, 0, HEIGHT - size, size, HEIGHT),
    avgRegion(frame, WIDTH - size, HEIGHT - size, WIDTH, HEIGHT),
  ];
  return corners.reduce((a, b) => a + b, 0) / corners.length;
}

function avgCenterLuma(frame) {
  const half = 4;
  return avgRegion(frame, WIDTH / 2 - half, HEIGHT / 2 - half, WIDTH / 2 + half, HEIGHT / 2 + half);
}

function avgColor(frame) {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = frame.length / 3;
  for (let i = 0; i < pixels; i += 1) {
    r += frame[i * 3];
    g += frame[i * 3 + 1];
    b += frame[i * 3 + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function pixelDiffCount(frameA, frameB, threshold = 2) {
  let count = 0;
  for (let i = 0; i < frameA.length; i += 1) {
    if (Math.abs(frameA[i] - frameB[i]) > threshold) count += 1;
  }
  return count;
}

// フレーム毎の輝度サンプル値の分散（フレーム間分散 — noise の「フレーム間分散が増加」判定に使う）。
function sampleVarianceAcrossFrames(buf, frameCount, x, y) {
  const offset = (y * WIDTH + x) * 3;
  const values = [];
  for (let f = 0; f < frameCount; f += 1) {
    values.push(frameSlice(buf, f)[offset]);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
}

test("normalizeCutFxList: filters unknown ids, clamps intensity, defaults intensity to 1", () => {
  assert.deepEqual(normalizeCutFxList(undefined), []);
  assert.deepEqual(normalizeCutFxList(null), []);
  assert.deepEqual(normalizeCutFxList([]), []);
  const list = normalizeCutFxList([
    { id: "noise" },
    { id: "not-a-real-fx", intensity: 0.5 },
    { id: "vignette", intensity: 1.5, params: { color: "white" } },
    { id: "color-overlay", intensity: -1, params: { color: "red" } },
  ]);
  assert.deepEqual(list, [
    { id: "noise", intensity: 1, params: {} },
    { id: "vignette", intensity: 1, params: { color: "white" } },
    { id: "color-overlay", intensity: 0, params: { color: "red" } },
  ]);
});

test("hasCutFx: true only when at least one cut declares a non-empty fx array", () => {
  assert.equal(hasCutFx([]), false);
  assert.equal(hasCutFx([{ in: 0, out: 1 }]), false);
  assert.equal(hasCutFx([{ in: 0, out: 1, fx: [] }]), false);
  assert.equal(hasCutFx([{ in: 0, out: 1, fx: [{ id: "noise" }] }]), true);
  assert.equal(hasCutFx([{ in: 0, out: 1 }, { in: 1, out: 2, fx: [{ id: "flare" }] }]), true);
});

test("no fx declared keeps today's exact concat-only filter chain (non-regression)", async () => {
  const root = await mkdtemp(join(tmpdir(), "cut-fx-noregress-"));
  try {
    const command = buildCutFxCommand({ sourcePath: "source.mp4", cutPath: "cut.mp4", fx: undefined, projectRoot: root });
    const argsText = command.args.join(" ");
    assert.match(argsText, /setsar=1\[outv\]/);
    assert.doesNotMatch(argsText, /noise=|vignette|geq=|blend=/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const fxId of ["noise", "particles", "vignette", "flare", "color-overlay"]) {
  test(`${fxId}: intensity=0 is pixel-identical to no fx (identity contract)`, async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
    const root = await mkdtemp(join(tmpdir(), `cut-fx-zero-${fxId}-`));
    try {
      const fx = [{ id: fxId, intensity: 0, ...(fxId === "color-overlay" ? { params: { color: "red" } } : {}) }];
      const plainPath = await renderFx(root, undefined, { name: "plain" });
      const zeroPath = await renderFx(root, fx, { name: "zero" });
      const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
      const zeroFrame = frameSlice(dumpFrames(zeroPath, 1), 0);
      const diff = pixelDiffCount(plainFrame, zeroFrame, 0);
      t.diagnostic(`${fxId} intensity=0 differing-pixel count=${diff}`);
      assert.equal(diff, 0, `expected intensity=0 to be pixel-identical to no fx, ${diff} pixels differed`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test(`${fxId}: same edit.json renders pixel-identical output twice (determinism)`, async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
    const root = await mkdtemp(join(tmpdir(), `cut-fx-determinism-${fxId}-`));
    try {
      const fx = [{ id: fxId, intensity: 0.6, ...(fxId === "vignette" ? { params: { color: "white" } } : {}), ...(fxId === "color-overlay" ? { params: { color: "blue" } } : {}) }];
      const pathA = await renderFx(root, fx, { name: "a" });
      const pathB = await renderFx(root, fx, { name: "b" });
      const framesA = dumpFrames(pathA, 10);
      const framesB = dumpFrames(pathB, 10);
      assert.equal(framesA.length, framesB.length);
      const diff = pixelDiffCount(framesA, framesB, 0);
      t.diagnostic(`${fxId} determinism differing-byte count across 10 frames=${diff}`);
      assert.equal(diff, 0, `expected two renders of the same edit.json to be pixel-identical, ${diff} bytes differed`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("noise: fx-on vs fx-off differs on the same frame, and frame-to-frame variance increases", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-noise-"));
  try {
    const plainPath = await renderFx(root, undefined, { name: "plain" });
    const noisyPath = await renderFx(root, [{ id: "noise", intensity: 0.5 }], { name: "noisy" });
    const plainFrame0 = frameSlice(dumpFrames(plainPath, 1), 0);
    const noisyFrame0 = frameSlice(dumpFrames(noisyPath, 1), 0);
    const diff = pixelDiffCount(plainFrame0, noisyFrame0, 3);
    t.diagnostic(`noise vs plain differing-pixel count=${diff}`);
    assert.ok(diff > 0, `expected noise to change the frame, got ${diff} differing pixels`);

    const plainFrames = dumpFrames(plainPath, FPS * DURATION);
    const noisyFrames = dumpFrames(noisyPath, FPS * DURATION);
    // A handful of fixed sample points across the frame; noise must raise frame-to-frame
    // variance at (most of) them versus the untouched source.
    const points = [[16, 16], [48, 16], [16, 48], [48, 48], [32, 32]];
    let raisedCount = 0;
    for (const [x, y] of points) {
      const plainVar = sampleVarianceAcrossFrames(plainFrames, FPS * DURATION, x, y);
      const noisyVar = sampleVarianceAcrossFrames(noisyFrames, FPS * DURATION, x, y);
      t.diagnostic(`point(${x},${y}) plain variance=${plainVar.toFixed(2)} noisy variance=${noisyVar.toFixed(2)}`);
      if (noisyVar > plainVar) raisedCount += 1;
    }
    assert.ok(raisedCount === points.length, `expected frame-to-frame variance to increase at every sample point, ${raisedCount}/${points.length} did`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("vignette: corners darken relative to center (black, default) / brighten (white)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-vignette-"));
  try {
    const plainPath = await renderFx(root, undefined, { name: "plain" });
    const blackPath = await renderFx(root, [{ id: "vignette", intensity: 1 }], { name: "black" });
    const whitePath = await renderFx(root, [{ id: "vignette", intensity: 1, params: { color: "white" } }], { name: "white" });

    const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
    const blackFrame = frameSlice(dumpFrames(blackPath, 1), 0);
    const whiteFrame = frameSlice(dumpFrames(whitePath, 1), 0);

    const plainRatio = avgCornerLuma(plainFrame) / avgCenterLuma(plainFrame);
    const blackRatio = avgCornerLuma(blackFrame) / avgCenterLuma(blackFrame);
    const whiteRatio = avgCornerLuma(whiteFrame) / avgCenterLuma(whiteFrame);
    t.diagnostic(`corner/center ratio: plain=${plainRatio.toFixed(3)} black-vignette=${blackRatio.toFixed(3)} white-vignette=${whiteRatio.toFixed(3)}`);

    assert.ok(blackRatio < plainRatio, `expected black vignette to lower the corner/center ratio (${blackRatio} vs baseline ${plainRatio})`);
    assert.ok(whiteRatio > plainRatio, `expected white vignette to raise the corner/center ratio (${whiteRatio} vs baseline ${plainRatio})`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("color-overlay: average frame color shifts toward the target color, monotonically with intensity", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-color-overlay-"));
  try {
    const target = { r: 255, g: 0, b: 0 };
    const distances = [];
    for (const intensity of [0, 0.3, 0.6, 1]) {
      const path = await renderFx(root, [{ id: "color-overlay", intensity, params: { color: "red" } }], { name: `i${intensity}` });
      const frame = frameSlice(dumpFrames(path, 1), 0);
      const distance = colorDistance(avgColor(frame), target);
      distances.push(distance);
    }
    t.diagnostic(`distance-to-red at intensity 0/0.3/0.6/1 = ${distances.map((d) => d.toFixed(2)).join(", ")}`);
    for (let i = 1; i < distances.length; i += 1) {
      assert.ok(distances[i] < distances[i - 1], `expected distance to red to decrease monotonically with intensity, got ${distances}`);
    }
    // H.264 8-bit rounding keeps this just above 0 even at a mathematically exact blend=1.0.
    assert.ok(distances[distances.length - 1] <= 1.5, `expected intensity=1 to be (near-)exactly red, distance=${distances[distances.length - 1]}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const fxId of ["particles", "flare"]) {
  test(`${fxId}: 2+ glow cuts produce a filtergraph with no double-consumed label (static check, 2026-08-06 split-leak regression)`, () => {
    const command = buildCutCommand({
      sourcePath: "source.mp4",
      cutPath: "cut.mp4",
      cuts: [
        { in: 0, out: 1.2, fx: [{ id: fxId, intensity: 1 }] },
        { in: 1.2, out: 2.4, fx: [{ id: fxId, intensity: 1 }] },
      ],
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      hasAudio: true,
      duration: 2.4,
      projectRoot: "/tmp",
    });
    const filterComplexIndex = command.args.indexOf("-filter_complex");
    assert.ok(filterComplexIndex >= 0, "expected -filter_complex in the built command");
    assertNoDoubleConsumedLabels(command.args[filterComplexIndex + 1], `${fxId} x2 cuts`);
  });
}

async function makeAudioSourceFile(root, duration) {
  const sourcePath = join(root, "source-audio.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    sourcePath,
  ]);
  return sourcePath;
}

function probeDurationSeconds(path) {
  const result = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return parseFloat(result.stdout.toString("utf8").trim());
}

for (const fxId of ["particles", "flare"]) {
  // 2026-08-06 再現条件そのもの: 音声ありソース + glow fx を掛けた 2 カット以上 + buildCutCommand
  // が常に付ける -shortest 経路。修正前は inputLabel の二重消費で出力尺が理論値から大きく外れた
  // (実測: 正規化済み実映像で 2 カット合計 5.0s 期待のところ 29.83s)。
  test(`${fxId}: 2 glow cuts with an audio-bearing source render the full expected duration (2026-08-06 split-leak regression)`, async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
    const root = await mkdtemp(join(tmpdir(), `cut-fx-glow-multicut-${fxId}-`));
    try {
      const cutDuration = 1.2;
      const totalDuration = cutDuration * 2;
      const sourcePath = await makeAudioSourceFile(root, totalDuration);
      const cutPath = join(root, "cut.mp4");
      const command = buildCutCommand({
        sourcePath,
        cutPath,
        cuts: [
          { in: 0, out: cutDuration, fx: [{ id: fxId, intensity: 1 }] },
          { in: cutDuration, out: totalDuration, fx: [{ id: fxId, intensity: 1 }] },
        ],
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        hasAudio: true,
        duration: totalDuration,
        projectRoot: root,
      });
      run(command.command, command.args);
      const measured = probeDurationSeconds(cutPath);
      t.diagnostic(`${fxId} x2 cuts (audio source): expected=${totalDuration}s measured=${measured}s`);
      assert.ok(
        Math.abs(measured - totalDuration) <= 0.1,
        `expected output duration ~${totalDuration}s (±0.1s), measured ${measured}s`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const fxId of ["particles", "flare"]) {
  test(`${fxId}: fx-on differs from fx-off, and changes over time (not a still image)`, async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
    const root = await mkdtemp(join(tmpdir(), `cut-fx-${fxId}-`));
    try {
      const plainPath = await renderFx(root, undefined, { name: "plain" });
      const fxPath = await renderFx(root, [{ id: fxId, intensity: 1 }], { name: "fx" });
      const plainFrame0 = frameSlice(dumpFrames(plainPath, 1), 0);
      const fxFrames = dumpFrames(fxPath, FPS * DURATION);
      const fxFrame0 = frameSlice(fxFrames, 0);
      const fxFrameLast = frameSlice(fxFrames, FPS * DURATION - 1);

      const diffVsPlain = pixelDiffCount(plainFrame0, fxFrame0, 2);
      const diffOverTime = pixelDiffCount(fxFrame0, fxFrameLast, 2);
      t.diagnostic(`${fxId}: diff-vs-plain=${diffVsPlain} diff-over-time=${diffOverTime}`);
      assert.ok(diffVsPlain > 0, `expected ${fxId} to change pixels versus no fx`);
      assert.ok(diffOverTime > 0, `expected ${fxId} to change over time (not a static overlay)`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("fx stacking: array order composes (noise then vignette differs from vignette alone)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-stack-"));
  try {
    const vignetteOnlyPath = await renderFx(root, [{ id: "vignette", intensity: 1 }], { name: "vignette-only" });
    const stackedPath = await renderFx(
      root,
      [{ id: "noise", intensity: 0.5 }, { id: "vignette", intensity: 1 }],
      { name: "stacked" },
    );
    const vignetteFrame = frameSlice(dumpFrames(vignetteOnlyPath, 1), 0);
    const stackedFrame = frameSlice(dumpFrames(stackedPath, 1), 0);
    const diff = pixelDiffCount(vignetteFrame, stackedFrame, 2);
    t.diagnostic(`stacked vs vignette-only differing-pixel count=${diff}`);
    assert.ok(diff > 0, "expected stacking noise on top of vignette to change the output");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// LUT との併用が破綻しないこと（受け入れ条件: 白黒 + noise = ネガ 16「ノイズ」相当）。
// フィルタグラフの単体呼び出しではなく render-cut.mjs の CLI を通した実パイプラインで確認する。
test("cuts[].fx composes with output.look (mono LUT + noise) through the full render-cut pipeline", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-lut-combo-"));
  try {
    await makeSourceFile(root);
    await writeFile(
      join(root, "edit.json"),
      `${JSON.stringify(
        {
          version: 0,
          output: { width: WIDTH, height: HEIGHT, fps: FPS, look: { lut: "mono", intensity: 1 } },
          source: { path: "source.mp4", proxy: null },
          cuts: [{ in: 0, out: DURATION, fx: [{ id: "noise", intensity: 0.5 }] }],
          overlays: [],
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(join(root, ".akari"));
    await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');

    const executed = spawnSync(process.execPath, [cliPath, root], { encoding: "utf8" });
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");

    const outputPath = join(root, state.artifacts[0].path);
    const frame = frameSlice(dumpFrames(outputPath, 1), 0);
    let colored = 0;
    for (let i = 0; i < frame.length; i += 3) {
      if (Math.abs(frame[i] - frame[i + 1]) > 8 || Math.abs(frame[i] - frame[i + 2]) > 8) colored += 1;
    }
    t.diagnostic(`mono+noise combo: colored pixel count (of ${frame.length / 3})=${colored}`);
    assert.ok(colored < frame.length / 3 / 10, "expected the mono LUT to keep the combined output essentially colorless");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
