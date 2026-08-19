import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { FX_IDS, hasCutFx, normalizeCutFxList } from "../src/fx.mjs";
import { buildCutCommand } from "./helpers/v2-fixture.mjs";

// 2026-08-11 撤去: v0 の画面 FX 小語彙 5 種（noise/particles/vignette/flare/color-overlay。
// docs/contract-2026-08-05-fx-v0.md）はオーナー裁定「めちゃくちゃダサいのでやめたい」により
// 製品面から全撤去した。presets/fx/ の参照表・ディスパッチの器（FX_BUILDERS）は残しており、
// 2026-08-11 現在は登録 0 件。このファイルは「未知 fx id はハードフェイルせず警告 + no-op で
// 通す」という撤去後の契約（データ契約三原則 — 受け口を広げる方向の互換）を実レンダーで検証する。
// 旧実装の 5 id をテストデータとして使う箇所（RETIRED_V0_FX_IDS 節のみ）は、撤去後もその id を
// 含む既存の edit.json が壊れないことを証明する後方互換の回帰テストであり、5 id を製品として
// 再導入するものではない。

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

const FX_INDEX_JSONL_FIELDS = ["id", "kind", "name", "description", "when_to_use", "tags", "params", "ai_usage", "source"];

test("presets/fx/index.jsonl is self-describing and matches the fx.mjs FX_BUILDERS dispatch table exactly (currently 0 entries)", async () => {
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
  assert.deepEqual(indexIds, dispatchIds, "presets/fx/index.jsonl ids must exactly match fx.mjs's FX_IDS dispatch table (both empty until a new fx is registered)");
});

const WIDTH = 64;
const HEIGHT = 64;
const FPS = 10;
const DURATION = 2;

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

// buildCutCommand は console.warn を同期的に呼ぶ（fx.mjs の appendCutFxChain 内、ffmpeg 起動より
// 前）。呼び出し全体を囲んで一時的に差し替え、出た警告文を集める。
async function renderFxCapturingWarnings(root, fx, options) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const cutPath = await renderFx(root, fx, options);
    return { cutPath, warnings };
  } finally {
    console.warn = original;
  }
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
  const frameBytes = WIDTH * HEIGHT * 3;
  return buf.subarray(index * frameBytes, (index + 1) * frameBytes);
}

function pixelDiffCount(frameA, frameB, threshold = 2) {
  let count = 0;
  for (let i = 0; i < frameA.length; i += 1) {
    if (Math.abs(frameA[i] - frameB[i]) > threshold) count += 1;
  }
  return count;
}

test("normalizeCutFxList: accepts any non-empty string id, clamps intensity, defaults intensity to 1", () => {
  assert.deepEqual(normalizeCutFxList(undefined), []);
  assert.deepEqual(normalizeCutFxList(null), []);
  assert.deepEqual(normalizeCutFxList([]), []);
  const list = normalizeCutFxList([
    { id: "sample-fx" },
    { id: "another-fx", intensity: 0.5 },
    { id: "high-intensity-fx", intensity: 1.5, params: { color: "white" } },
    { id: "negative-intensity-fx", intensity: -1, params: { color: "red" } },
    { id: "" }, // empty string id is not a valid shape, dropped
    { notAnId: true },
    null,
  ]);
  assert.deepEqual(list, [
    { id: "sample-fx", intensity: 1, params: {} },
    { id: "another-fx", intensity: 0.5, params: {} },
    { id: "high-intensity-fx", intensity: 1, params: { color: "white" } },
    { id: "negative-intensity-fx", intensity: 0, params: { color: "red" } },
  ]);
});

test("hasCutFx: true only when at least one cut declares a non-empty fx array", () => {
  assert.equal(hasCutFx([]), false);
  assert.equal(hasCutFx([{ in: 0, out: 1 }]), false);
  assert.equal(hasCutFx([{ in: 0, out: 1, fx: [] }]), false);
  assert.equal(hasCutFx([{ in: 0, out: 1, fx: [{ id: "sample-fx" }] }]), true);
  assert.equal(hasCutFx([{ in: 0, out: 1 }, { in: 1, out: 2, fx: [{ id: "another-fx" }] }]), true);
});

test("no fx declared keeps today's exact concat-only filter chain (non-regression)", async () => {
  const root = await mkdtemp(join(tmpdir(), "cut-fx-noregress-"));
  try {
    const command = buildCutFxCommand({ sourcePath: "source.mp4", cutPath: "cut.mp4", fx: undefined, projectRoot: root });
    const argsText = command.args.join(" ");
    assert.match(argsText, /setsar=1\[vrange0\]/);
    assert.match(argsText, /\[joinedv\]null\[outv_tv\]/);
    assert.doesNotMatch(argsText, /noise=|vignette|geq=|blend=/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown fx id: renders successfully with a console warning, output is pixel-identical to no fx (no-op)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-unknown-"));
  try {
    const plainPath = await renderFx(root, undefined, { name: "plain" });
    const { cutPath: unknownPath, warnings } = await renderFxCapturingWarnings(
      root,
      [{ id: "totally-unknown-fx", intensity: 1 }],
      { name: "unknown" },
    );
    assert.ok(
      warnings.some((message) => message.includes("totally-unknown-fx")),
      `expected a console.warn mentioning the unknown id, got: ${JSON.stringify(warnings)}`,
    );

    const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
    const unknownFrame = frameSlice(dumpFrames(unknownPath, 1), 0);
    const diff = pixelDiffCount(plainFrame, unknownFrame, 0);
    t.diagnostic(`unknown-fx vs plain differing-pixel count=${diff}`);
    assert.equal(diff, 0, `expected an unregistered fx id to no-op (pixel-identical to no fx), ${diff} pixels differed`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown fx id: intensity=0 still no-ops without even reaching the unknown-id warning path (identity contract takes priority)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-unknown-zero-"));
  try {
    const plainPath = await renderFx(root, undefined, { name: "plain" });
    const { cutPath: zeroPath, warnings } = await renderFxCapturingWarnings(
      root,
      [{ id: "totally-unknown-fx", intensity: 0 }],
      { name: "zero" },
    );
    assert.deepEqual(warnings, [], "expected intensity=0 to short-circuit before the unknown-id warning");
    const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
    const zeroFrame = frameSlice(dumpFrames(zeroPath, 1), 0);
    assert.equal(pixelDiffCount(plainFrame, zeroFrame, 0), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multiple unknown fx ids stacked on one cut all no-op and all warn", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-unknown-stack-"));
  try {
    const plainPath = await renderFx(root, undefined, { name: "plain" });
    const { cutPath: stackedPath, warnings } = await renderFxCapturingWarnings(
      root,
      [{ id: "unknown-fx-a", intensity: 1 }, { id: "unknown-fx-b", intensity: 1 }],
      { name: "stacked" },
    );
    assert.ok(warnings.some((m) => m.includes("unknown-fx-a")), `missing warning for unknown-fx-a: ${JSON.stringify(warnings)}`);
    assert.ok(warnings.some((m) => m.includes("unknown-fx-b")), `missing warning for unknown-fx-b: ${JSON.stringify(warnings)}`);
    const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
    const stackedFrame = frameSlice(dumpFrames(stackedPath, 1), 0);
    assert.equal(pixelDiffCount(plainFrame, stackedFrame, 0), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 撤去 (2026-08-11) の後方互換回帰テスト: v0 の 5 id は FX_BUILDERS に存在しないが、この 5 id を
// 含む既存の edit.json はハードフェイルしてはいけない（データ契約三原則 — 受け口を広げる方向の
// 互換）。ここでだけ意図的に旧 5 id を使い、no-op + 警告で完走することを実測する。
const RETIRED_V0_FX_IDS = ["noise", "particles", "vignette", "flare", "color-overlay"];

for (const fxId of RETIRED_V0_FX_IDS) {
  test(`legacy v0 fx id "${fxId}" (removed 2026-08-11): renders as a no-op with a warning (backward compatibility)`, async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
    const root = await mkdtemp(join(tmpdir(), `cut-fx-legacy-${fxId}-`));
    try {
      const fx = [{ id: fxId, intensity: 1, ...(fxId === "vignette" || fxId === "color-overlay" ? { params: { color: "red" } } : {}) }];
      const plainPath = await renderFx(root, undefined, { name: "plain" });
      const { cutPath: legacyPath, warnings } = await renderFxCapturingWarnings(root, fx, { name: "legacy" });
      assert.ok(warnings.some((m) => m.includes(fxId)), `expected a warning mentioning "${fxId}", got: ${JSON.stringify(warnings)}`);
      const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
      const legacyFrame = frameSlice(dumpFrames(legacyPath, 1), 0);
      const diff = pixelDiffCount(plainFrame, legacyFrame, 0);
      t.diagnostic(`legacy "${fxId}" vs plain differing-pixel count=${diff}`);
      assert.equal(diff, 0, `expected the removed "${fxId}" fx to no-op (pixel-identical to no fx), ${diff} pixels differed`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("fx stacking order no longer changes output: two unknown/no-op ids in either order render pixel-identical to no fx", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-stack-order-"));
  try {
    const plainPath = await renderFx(root, undefined, { name: "plain" });
    const orderAPath = await renderFx(root, [{ id: "noise", intensity: 0.5 }, { id: "vignette", intensity: 1, params: { color: "black" } }], { name: "order-a" });
    const orderBPath = await renderFx(root, [{ id: "vignette", intensity: 1, params: { color: "black" } }, { id: "noise", intensity: 0.5 }], { name: "order-b" });
    const plainFrame = frameSlice(dumpFrames(plainPath, 1), 0);
    const orderAFrame = frameSlice(dumpFrames(orderAPath, 1), 0);
    const orderBFrame = frameSlice(dumpFrames(orderBPath, 1), 0);
    assert.equal(pixelDiffCount(plainFrame, orderAFrame, 0), 0);
    assert.equal(pixelDiffCount(plainFrame, orderBFrame, 0), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 実レンダーの受け入れ条件（2026-08-11 撤去タスクの dispatch instructions #3）: fx 付きの旧
// edit.json を render-cut.mjs の CLI 経由で実レンダーし、「警告 + no-op で完走」を実測する
// （単体テストの間接検証だけで済ませない）。output.look（LUT）との併用込みで、旧プロジェクトが
// 実際に持ち得た形をそのまま通す。
test("a legacy edit.json with output.look (LUT) + cuts[].fx (retired v0 id) completes through the full render-cut CLI pipeline (warn + no-op, not a hard failure)", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "cut-fx-legacy-cli-"));
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
    assert.match(
      executed.stderr ?? "",
      /noise/,
      'expected the retired "noise" fx id to be surfaced via a warning on stderr, not silently swallowed',
    );
    const state = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");

    const outputPath = join(root, state.artifacts[0].path);
    const frame = frameSlice(dumpFrames(outputPath, 1), 0);
    let colored = 0;
    for (let i = 0; i < frame.length; i += 3) {
      if (Math.abs(frame[i] - frame[i + 1]) > 8 || Math.abs(frame[i] - frame[i + 2]) > 8) colored += 1;
    }
    t.diagnostic(`mono LUT + retired no-op fx: colored pixel count (of ${frame.length / 3})=${colored}`);
    assert.ok(colored < frame.length / 3 / 10, "expected the mono LUT to keep the output essentially colorless even with a (no-op) retired fx id present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
