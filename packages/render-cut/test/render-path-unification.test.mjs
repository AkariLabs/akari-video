// P0 2026-08-21 render-path-unification: 受け入れ条件 4「transition_out・speed・freeze・crop・
// perspective・blend・keyframes のそれぞれが段の位置に依存せず効くことをテストで担保
// （最低各 1 本・実 ffmpeg）」の実装。各テストは同じ宣言を持つアイテムを 2 通りの段配置
// （A: 単独トラック=flat/default dispatch、B: 他の visual トラックと同居=buildTrackStackPlan
// 経由の合成）で実レンダーし、機能自体の効果（ピクセル・尺・フレーム内容）が配置に依存せず
// 同一であることを確認する。
//
// 段まわりの用語:
// - transition_out / speed / freeze はレガシー v1 cuts[] 由来のフィールドで、v2 アイテムでは
//   item.source.{transition_out,speed,freeze} に載る（packages/edit-store/src/internal-model.ts
//   の copyMediaSourceFields）。crop / perspective / blend / keyframes はアイテム直下のフィールド
//   （同ファイルの common）。
// - 「A: 単独」はそのアイテムが唯一の visual トラックのケース（cuts 系トラックが 1 本のみ →
//   usesDefaultInternalTrackOrder が true → 平坦な既定 dispatch）。
// - 「B: 同居」は別の実コンテンツを持つ visual トラックと並べたケース（cuts 系トラックが
//   2 本以上 → 常に buildTrackStackPlan 経由の z 順合成へ回る。plan.mjs の
//   usesDefaultInternalTrackOrder 自身のコメント参照）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";
import { renderProject } from "../src/render-cut.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);
const FPS = 10;
const WIDTH = 320;
const HEIGHT = 180;

function ffmpegAvailable() {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function ffprobeDurationSeconds(path) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}

async function makeColorSource(path, { color, duration, width = WIDTH, height = HEIGHT }) {
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:r=${FPS}:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ]);
}

// testsrc は時刻ごとに絵が変わるので、freeze の「2 フレームが画素一致」を意味のある主張にする
// （単色ソースだと freeze していなくても常に一致してしまう）。
function makeMovingSource(path, { duration, width = WIDTH, height = HEIGHT }) {
  ffmpeg([
    "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=${FPS}:duration=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ]);
}

function samplePixelRgb(path, time, xFrac, yFrac) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", path,
    "-frames:v", "1", "-vf", `crop=1:1:iw*${xFrac}:ih*${yFrac},format=rgb24`, "-f", "rawvideo", "pipe:1",
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

// Video-only raw frame bytes (no -f framemd5, no audio stream mixed in -- ffmpeg's "1 video
// frame" cap does not also cap how much trailing audio gets muxed into a framemd5 report, so
// naively hashing "1 frame" at two different -ss points captures two DIFFERENT amounts of
// trailing audio and can never match even for a genuinely frozen video frame).
function frameBytes(path, atSeconds) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", String(atSeconds), "-i", path,
    "-frames:v", "1", "-vf", "format=rgb24", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { encoding: "buffer" });
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  return result.stdout;
}

// h264's lossy reconstruction of two byte-identical source frames can still differ by a few units
// per channel depending on frame type/distance from the last keyframe (verified in
// cut-freeze.test.mjs's own comment), so an exact byte-equality check on decoded frames is the
// wrong tool for a lossy-encoded render -- compare with a tolerance instead, same reasoning as
// assertSameColor above.
// Mean absolute difference across the whole frame, not a per-byte max: a genuinely frozen (held)
// source frame's h264 reconstruction noise is small but non-zero everywhere, while an unfrozen
// testsrc frame from a different instant differs by a lot over most of the frame (testsrc's
// pattern is continuously changing, high-frequency content) -- a single outlier byte's max diff
// is too fragile a signal for a busy, lossy-encoded frame, but the mean is not.
function assertFramesMatch(actual, expected, message, tolerance = 3) {
  assert.equal(actual.length, expected.length, `${message}: frame byte length differs`);
  let total = 0;
  for (let index = 0; index < actual.length; index += 1) {
    total += Math.abs(actual[index] - expected[index]);
  }
  const meanDiff = total / actual.length;
  assert.ok(meanDiff <= tolerance, `${message}: mean per-byte diff ${meanDiff.toFixed(3)} exceeds tolerance ${tolerance}`);
}

function isColor({ r, g, b }, expected) {
  // libx264's own solid-color band on a small frame still carries a few units of lossy rounding
  // noise (0x00FF00 green decodes to roughly (0,128,1), not (0,255,0), because ffmpeg's default
  // lavfi "green" is the CSS/X11 half-intensity green, not pure (0,255,0)) -- thresholds are kept
  // loose on purpose, this is not the position-independence assertion itself.
  if (expected === "green") return g > 80 && r < 80 && b < 80;
  if (expected === "blue") return b > 150 && r < 80 && g < 80;
  if (expected === "red") return r > 150 && g < 80 && b < 80;
  if (expected === "magenta") return r > 150 && b > 150 && g < 80;
  throw new Error(`unknown color ${expected}`);
}

// P0 2026-08-21 render-path-unification: the two positions being compared can go through a
// different number of re-encode stages (e.g. flat single-encode vs track-stack's qtrle
// intermediate + recompose), so exact byte/pixel equality is the wrong tool here -- same
// "known non-determinism" this task's own established non-regression methodology already flags
// for post-encode comparison. A tight tolerance on each channel still catches a genuine
// position-dependent rendering difference while tolerating ordinary lossy-encode rounding noise.
function assertSameColor(actual, expected, message, tolerance = 6) {
  for (const channel of ["r", "g", "b"]) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${message}: channel ${channel} differs by more than ${tolerance} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`,
    );
  }
}

async function writeProject(edit) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-path-unification-"));
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
  return root;
}

async function renderAndGetOutputPath(root) {
  const state = await renderProject(root, {});
  assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
  return join(root, state.plan.output);
}

// --- (1) transition_out: フルフレームの本編トラック + 別段の同居有無 -------------------------

// task 2026-08-07-track-transition-lint-guard already forbids transition_out from ever combining
// with buildTrackStackPlan's multi-track z-order compositing at all (a real, pre-existing, and
// unrelated restriction -- resolveCutSegments/computeVideoRuns cannot represent an xfade's
// intentional overlap; see plan.mjs's own guard next to this comment's citation). So "does this
// feature work regardless of position" is tested the way the original P0 bug report actually
// happened instead: the SAME sequential 2-cut track, moved behind a newly-created EMPTY track
// (r1's exact scenario -- an empty visual track shifts nothing about dispatch, since
// usesDefaultInternalTrackOrder filters empty tracks out of its cuts-count check, so this stays on
// the flat/default dispatch in both positions and only the track's declared position/ref differs).
test("transition_out: dissolve boundary blends mid-transition regardless of which track position the sequential clip is declared on", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const sources = [
    { id: "green", path: "green.mp4", proxy: null },
    { id: "blue", path: "blue.mp4", proxy: null },
  ];
  // c2.at is deliberately 10 (1.0s), not 20 (2.0s): needsGapAwareCutTimeline (cut-timeline.mjs)
  // advances its cursor by segmentDuration - transition_out.duration, so a plain, no-gap,
  // xfade-eligible sequential pair must already bake the 1s overlap into c2's own declared
  // position -- an unadjusted, naively-adjacent `at` reads as an explicit gap and routes through
  // the gap-aware builder instead, which does not implement transition_out at all.
  const mainTrack = { id: "main", lane: "visual", items: [
    { id: "c1", at: 0, duration: 20, source: { kind: "media", src: "green", in: 0, out: 2, transition_out: { type: "dissolve", duration: 1 } } },
    { id: "c2", at: 10, duration: 20, source: { kind: "media", src: "blue", in: 0, out: 2 } },
  ] };
  const emptyTrack = { id: "empty", lane: "visual", items: [] };
  const alone = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [mainTrack] };
  const moved = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [emptyTrack, mainTrack] };

  const rootAlone = await writeProject(alone);
  const rootMoved = await writeProject(moved);
  try {
    await makeColorSource(join(rootAlone, "green.mp4"), { color: "green", duration: 2 });
    await makeColorSource(join(rootAlone, "blue.mp4"), { color: "blue", duration: 2 });
    await makeColorSource(join(rootMoved, "green.mp4"), { color: "green", duration: 2 });
    await makeColorSource(join(rootMoved, "blue.mp4"), { color: "blue", duration: 2 });

    const outputAlone = await renderAndGetOutputPath(rootAlone);
    const outputMoved = await renderAndGetOutputPath(rootMoved);

    const midAlone = samplePixelRgb(outputAlone, 1.5, 0.5, 0.5);
    const midMoved = samplePixelRgb(outputMoved, 1.5, 0.5, 0.5);
    t.diagnostic(`alone mid-transition rgb=${JSON.stringify(midAlone)}; moved-behind-empty-track mid-transition rgb=${JSON.stringify(midMoved)}`);
    assert.ok(!isColor(midAlone, "green") && !isColor(midAlone, "blue"), `expected a genuine blend, not a hard cut: ${JSON.stringify(midAlone)}`);
    assert.ok(!isColor(midMoved, "green") && !isColor(midMoved, "blue"), `expected a genuine blend, not a hard cut: ${JSON.stringify(midMoved)}`);
    assertSameColor(midMoved, midAlone, "transition_out's own mid-transition pixel must be identical regardless of the track's declared position");
  } finally {
    await Promise.all([rootAlone, rootMoved].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- (2) speed: フルフレームの本編トラック + 別段の同居有無 --------------------------------

test("speed: a 2x-sped-up cut produces the same shortened duration regardless of whether the track shares the timeline with another visual track", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const sources = [
    { id: "green", path: "green.mp4", proxy: null },
    { id: "red", path: "red.mp4", proxy: null },
  ];
  const mainTrack = { id: "main", lane: "visual", items: [
    { id: "c1", at: 0, duration: 20, source: { kind: "media", src: "green", in: 0, out: 4, speed: 2 } },
  ] };
  const decoyTrack = { id: "decoy", lane: "visual", items: [
    { id: "d1", at: 0, duration: 20, source: { kind: "media", src: "red", in: 0, out: 2 } },
  ] };
  const alone = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [mainTrack] };
  const withDecoy = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [decoyTrack, mainTrack] };

  const rootAlone = await writeProject(alone);
  const rootDecoy = await writeProject(withDecoy);
  try {
    await makeColorSource(join(rootAlone, "green.mp4"), { color: "green", duration: 4 });
    await makeColorSource(join(rootDecoy, "green.mp4"), { color: "green", duration: 4 });
    await makeColorSource(join(rootDecoy, "red.mp4"), { color: "red", duration: 2 });

    const outputAlone = await renderAndGetOutputPath(rootAlone);
    const outputDecoy = await renderAndGetOutputPath(rootDecoy);
    const durationAlone = ffprobeDurationSeconds(outputAlone);
    const durationDecoy = ffprobeDurationSeconds(outputDecoy);
    t.diagnostic(`alone duration=${durationAlone}s; with-decoy duration=${durationDecoy}s (expected close to 2s: 4s of source at 2x)`);
    assert.ok(Math.abs(durationAlone - 2) <= 0.15, `expected ~2s (4s source at speed 2), got ${durationAlone}s`);
    assert.ok(Math.abs(durationDecoy - 2) <= 0.15, `expected ~2s (4s source at speed 2), got ${durationDecoy}s`);
  } finally {
    await Promise.all([rootAlone, rootDecoy].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- (3) freeze: フルフレームの本編トラック + 別段の同居有無 -------------------------------

// Same restriction as transition_out above: cuts[].freeze is explicitly unsupported together with
// buildTrackStackPlan's multi-track compositing (plan.mjs's buildGapAwareMultiSourceCutCommand
// throws for it -- a pre-existing, deliberate, unrelated restriction). Tested the same way: moved
// behind a newly-created empty track (r1's exact scenario), not alongside real content.
test("freeze: a held frame stays pixel-identical across the frozen span regardless of which track position the clip is declared on", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const sources = [{ id: "moving", path: "moving.mp4", proxy: null }];
  const mainTrack = { id: "main", lane: "visual", items: [
    { id: "c1", at: 0, duration: 40, source: { kind: "media", src: "moving", in: 0, out: 3, freeze: { at_sec: 1, duration_sec: 1 } } },
  ] };
  const emptyTrack = { id: "empty", lane: "visual", items: [] };
  const alone = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [mainTrack] };
  const moved = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [emptyTrack, mainTrack] };

  const rootAlone = await writeProject(alone);
  const rootMoved = await writeProject(moved);
  try {
    makeMovingSource(join(rootAlone, "moving.mp4"), { duration: 3 });
    makeMovingSource(join(rootMoved, "moving.mp4"), { duration: 3 });

    const outputAlone = await renderAndGetOutputPath(rootAlone);
    const outputMoved = await renderAndGetOutputPath(rootMoved);

    // freeze の宣言区間は [1.0, 2.0)。区間内の 2 時刻のフレームが画素一致すれば held。
    const frameAAlone = frameBytes(outputAlone, 1.1);
    const frameBAlone = frameBytes(outputAlone, 1.8);
    const frameAMoved = frameBytes(outputMoved, 1.1);
    const frameBMoved = frameBytes(outputMoved, 1.8);
    assertFramesMatch(frameBAlone, frameAAlone, "alone: two frames inside the frozen span must be pixel-identical");
    assertFramesMatch(frameBMoved, frameAMoved, "moved: two frames inside the frozen span must be pixel-identical");

    const durationAlone = ffprobeDurationSeconds(outputAlone);
    const durationMoved = ffprobeDurationSeconds(outputMoved);
    t.diagnostic(`alone duration=${durationAlone}s; moved-behind-empty-track duration=${durationMoved}s (expected close to 4s: 3s source + 1s freeze hold)`);
    assert.ok(Math.abs(durationAlone - 4) <= 0.15, `expected ~4s (3s source + 1s freeze), got ${durationAlone}s`);
    assert.ok(Math.abs(durationMoved - 4) <= 0.15, `expected ~4s (3s source + 1s freeze), got ${durationMoved}s`);
  } finally {
    await Promise.all([rootAlone, rootMoved].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- (4)/(5)/(6)/(7): crop / perspective / blend / keyframes は PiP 型（全画面ではない）
// フィールドなので、比較の枠組みを変える: A = 単独トラック（flat dispatch、footprint 外は不透明黒
// キャンバス）、B = 別の実コンテンツを持つトラックと同居（buildTrackStackPlan 経由、footprint 外は
// 透過で下地が透ける）。footprint の外側の見え方は文脈依存で当然変わってよい（下地の有無が違う）
// — position independence として保証すべきは「footprint 自身の内容（宣言した効果そのもの）が
// 配置に依存せず同一」であること。

async function renderPipVariant({ pipItem, baseColor = "green" }) {
  const sources = [
    { id: "pip", path: "pip.mp4", proxy: null },
    { id: "base", path: "base.mp4", proxy: null },
  ];
  const pipTrack = { id: "pip-track", lane: "visual", items: [pipItem] };
  const baseTrack = { id: "base-track", lane: "visual", items: [
    { id: "b1", at: 0, duration: 30, source: { kind: "media", src: "base", in: 0, out: 3 } },
  ] };
  const alone = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [pipTrack] };
  const withBase = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [baseTrack, pipTrack] };

  const rootAlone = await writeProject(alone);
  const rootWithBase = await writeProject(withBase);
  await makeColorSource(join(rootAlone, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
  await makeColorSource(join(rootWithBase, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
  await makeColorSource(join(rootWithBase, "base.mp4"), { color: baseColor, duration: 3 });

  const outputAlone = await renderAndGetOutputPath(rootAlone);
  const outputWithBase = await renderAndGetOutputPath(rootWithBase);
  return { rootAlone, rootWithBase, outputAlone, outputWithBase };
}

// --- (4) crop ---------------------------------------------------------------------------

test("crop: the cropped footprint's own content is identical whether the item is the sole visual track or shares the timeline with a base track", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const pipItem = {
    id: "pip-1", at: 0, duration: 30,
    source: { kind: "media", src: "pip", in: 0, out: 3 },
    transform: { scale: 0.3 },
    crop: { x: 0, y: 0, w: 0.5, h: 1 },
  };
  const { rootAlone, rootWithBase, outputAlone, outputWithBase } = await renderPipVariant({ pipItem });
  try {
    const centerAlone = samplePixelRgb(outputAlone, 1.5, 0.5, 0.5);
    const centerWithBase = samplePixelRgb(outputWithBase, 1.5, 0.5, 0.5);
    t.diagnostic(`crop footprint center: alone=${JSON.stringify(centerAlone)} with-base=${JSON.stringify(centerWithBase)}`);
    assert.ok(isColor(centerAlone, "magenta"), `expected the cropped PiP at center: ${JSON.stringify(centerAlone)}`);
    assertSameColor(centerWithBase, centerAlone, "crop's own footprint pixel must be identical regardless of track position");

    // footprint 外: alone は不透明黒キャンバス、with-base は緑の下地が透ける — 文脈依存の差は
    // 期待どおり。ここでは「with-base で下地が実際に見えている」ことだけ確認する。
    const edgeWithBase = samplePixelRgb(outputWithBase, 1.5, 0.02, 0.02);
    assert.ok(isColor(edgeWithBase, "green"), `expected the base track to show through outside the footprint: ${JSON.stringify(edgeWithBase)}`);
  } finally {
    await Promise.all([rootAlone, rootWithBase].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- (5) perspective ----------------------------------------------------------------------

test("perspective: the corner-pinned footprint's own content is identical whether the item is the sole visual track or shares the timeline with a base track", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const pipItem = {
    id: "pip-1", at: 0, duration: 30,
    source: { kind: "media", src: "pip", in: 0, out: 3 },
    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
    perspective: { corners: [[0.1, 0], [0.9, 0], [0, 1], [1, 1]] },
  };
  const { rootAlone, rootWithBase, outputAlone, outputWithBase } = await renderPipVariant({ pipItem });
  try {
    // ソースは 200x100、中央 (160,90) にスケール1で置かれる -> box は (60,40)-(260,140)。
    // perspective 天辺は inset (10%..90%)。inset 外・inset 内で位置サンプル。
    const insideAlone = samplePixelRgb(outputAlone, 1.5, 0.5, 0.28);
    const insideWithBase = samplePixelRgb(outputWithBase, 1.5, 0.5, 0.28);
    t.diagnostic(`perspective inside sample: alone=${JSON.stringify(insideAlone)} with-base=${JSON.stringify(insideWithBase)}`);
    assert.ok(isColor(insideAlone, "magenta"), `expected magenta inside the trapezoid: ${JSON.stringify(insideAlone)}`);
    assertSameColor(insideWithBase, insideAlone, "perspective's own footprint pixel must be identical regardless of track position");

    const outsideWithBase = samplePixelRgb(outputWithBase, 1.5, 0.19, 0.23);
    assert.ok(isColor(outsideWithBase, "green"), `expected the base track to show through just outside the inset top-left corner: ${JSON.stringify(outsideWithBase)}`);
  } finally {
    await Promise.all([rootAlone, rootWithBase].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- (6) blend ----------------------------------------------------------------------------

test("blend: a screen-blend footprint's own composited color is identical whether the item is the sole visual track or shares the timeline with a base track", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const pipItem = {
    id: "pip-1", at: 0, duration: 30,
    source: { kind: "media", src: "pip", in: 0, out: 3 },
    transform: { scale: 1 },
    blend: "screen",
  };
  // blend は必ず layers 経路（needsLayersEngine）。alone では下地が黒、with-base では緑。
  // screen(0,0,255)(black)=blue のまま / screen(magenta, green) はどちらも 0 でない chan が
  // 混ざるため alone と異なる合成結果になるのが期待どおり（screen は下地に依存する演算）。
  // ここでの「配置に依存しない」主張は、同じ下地（両方とも緑）で揃えて確認する。
  const sources = [
    { id: "pip", path: "pip.mp4", proxy: null },
    { id: "base", path: "base.mp4", proxy: null },
    { id: "base2", path: "base2.mp4", proxy: null },
  ];
  const pipTrack = { id: "pip-track", lane: "visual", items: [pipItem] };
  const baseTrack = { id: "base-track", lane: "visual", items: [
    { id: "b1", at: 0, duration: 30, source: { kind: "media", src: "base", in: 0, out: 3 } },
  ] };
  const decoyTrack = { id: "decoy-track", lane: "visual", items: [
    { id: "b2", at: 0, duration: 30, source: { kind: "media", src: "base2", in: 0, out: 3 } },
  ] };
  // A: 1 本の cuts 系トラック（base）+ blend トラック = flat な layers dispatch。
  // B: 2 本の cuts 系トラック（base, decoy の等価な緑 2 枚）+ blend トラック =
  //    buildTrackStackPlan 経由（layers ステージが積み重ねの中の 1 段になる）。
  const flat = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [baseTrack, pipTrack] };
  const stacked = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [baseTrack, decoyTrack, pipTrack] };

  const rootFlat = await writeProject(flat);
  const rootStacked = await writeProject(stacked);
  try {
    await makeColorSource(join(rootFlat, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
    await makeColorSource(join(rootFlat, "base.mp4"), { color: "green", duration: 3 });
    await makeColorSource(join(rootStacked, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
    await makeColorSource(join(rootStacked, "base.mp4"), { color: "green", duration: 3 });
    await makeColorSource(join(rootStacked, "base2.mp4"), { color: "green", duration: 3 });

    const outputFlat = await renderAndGetOutputPath(rootFlat);
    const outputStacked = await renderAndGetOutputPath(rootStacked);

    const centerFlat = samplePixelRgb(outputFlat, 1.5, 0.5, 0.5);
    const centerStacked = samplePixelRgb(outputStacked, 1.5, 0.5, 0.5);
    t.diagnostic(`blend footprint center over a green base: flat=${JSON.stringify(centerFlat)} stacked=${JSON.stringify(centerStacked)}`);
    // screen(magenta=255,0,255, green=0,128,0) = 255,128,255 -- a bright pink/white, not plain magenta or green.
    assert.ok(centerFlat.r > 200 && centerFlat.g > 80 && centerFlat.b > 200, `expected a screen-blended color, not plain magenta or green: ${JSON.stringify(centerFlat)}`);
    assertSameColor(centerStacked, centerFlat, "blend's own composited footprint pixel must be identical regardless of how many other tracks are in the stack");
  } finally {
    await Promise.all([rootFlat, rootStacked].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- (7) keyframes (crop keyframes on the unified cut path) --------------------------------

test("keyframes: an animated crop position lands at the same footprint content at the same time regardless of whether the item is the sole visual track or shares the timeline with a base track", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const pipItem = {
    id: "pip-1", at: 0, duration: 30,
    source: { kind: "media", src: "pip", in: 0, out: 3 },
    transform: { scale: 0.5 },
    keyframes: [
      { t: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 } },
      { t: 30, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    ],
  };
  const { rootAlone, rootWithBase, outputAlone, outputWithBase } = await renderPipVariant({ pipItem });
  try {
    const midAlone = samplePixelRgb(outputAlone, 1.5, 0.5, 0.5);
    const midWithBase = samplePixelRgb(outputWithBase, 1.5, 0.5, 0.5);
    t.diagnostic(`keyframed-crop footprint at t=1.5s: alone=${JSON.stringify(midAlone)} with-base=${JSON.stringify(midWithBase)}`);
    assert.ok(isColor(midAlone, "magenta"), `expected the keyframed-crop PiP at center: ${JSON.stringify(midAlone)}`);
    assertSameColor(midWithBase, midAlone, "the animated crop's own footprint pixel must be identical regardless of track position");
  } finally {
    await Promise.all([rootAlone, rootWithBase].map(root => rm(root, { recursive: true, force: true })));
  }
});

// --- r2 (2026-08-21, independent Codex review before merge) --------------------------------
// The above tests (1)-(7) cover r1's own acceptance criteria (position independence). This
// section pins the 1 BLOCKER + 3 MAJOR regressions an independent read-only review found in that
// same r1 work before merge, each first confirmed real with a hand-built ffmpeg repro (see
// tasks/2026-08-21-render-path-unification/report.md's r2 section for the full verification
// trail) and then fixed. Kept in this file rather than a new one: same task, same helpers.

function makeMarkerSource(path, { duration, width = WIDTH, height = HEIGHT }) {
  // Solid red background with a small white square in the extreme top-left corner -- a marker
  // that a "crop away everything except the center" punch-in must remove, and a plain pass-through
  // must leave untouched. Used by the MAJOR-2 regression below.
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=red:s=${width}x${height}:r=${FPS}:d=${duration}`,
    "-vf", "drawbox=x=2:y=2:w=12:h=12:color=white:t=fill",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ]);
}

// --- BLOCKER: a transform-only PiP (no crop/perspective/keyframes) must scale relative to the
// source's OWN native size, not get canvas-letterbox-fit baked into its own footprint first ------

test("BLOCKER regression: a transform-only PiP's footprint is sized from the source's native pixels, not inflated by a canvas letterbox-fit", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  // 200x100 source, transform.scale=0.3, no crop/perspective/keyframes -- the exact shape that
  // used to dispatch through appendCutVisualTransform's unconditional canvas-fit-then-scale
  // chain. Correct native-relative footprint: 200*0.3=60 wide, 100*0.3=30 tall (half-height 15).
  // The pre-fix bug instead fit 200x100 into the 320x180 canvas first (->320x160, padded to
  // 320x180), THEN scaled that by 0.3 (->96x54, half-height 27, with an inflated interior that
  // stops being magenta only in the outer few px of black letterbox padding). A canvas point at
  // vertical distance 20px from center is outside the correct 30px-tall footprint (black
  // background expected) but still inside the buggy 54px-tall footprint's magenta interior
  // (black-pad band only starts at distance 24px there) -- so it discriminates the two directly.
  const sources = [{ id: "pip", path: "pip.mp4", proxy: null }];
  const pipTrack = { id: "pip-track", lane: "visual", items: [
    { id: "pip-1", at: 0, duration: 30, source: { kind: "media", src: "pip", in: 0, out: 3 }, transform: { scale: 0.3 } },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [pipTrack] };
  const root = await writeProject(edit);
  try {
    await makeColorSource(join(root, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
    const output = await renderAndGetOutputPath(root);
    const insideCorrectFootprint = samplePixelRgb(output, 1.5, 0.5, 90 / 180);
    const beyondCorrectFootprint = samplePixelRgb(output, 1.5, 0.5, 70 / 180);
    t.diagnostic(`center=${JSON.stringify(insideCorrectFootprint)} 20px-above-center=${JSON.stringify(beyondCorrectFootprint)}`);
    assert.ok(isColor(insideCorrectFootprint, "magenta"), `expected magenta at the footprint's own center: ${JSON.stringify(insideCorrectFootprint)}`);
    assert.ok(!isColor(beyondCorrectFootprint, "magenta"), `expected the opaque black canvas background 20px above center (outside the correct 30px-tall footprint) -- magenta here means the footprint was inflated by a canvas fit step: ${JSON.stringify(beyondCorrectFootprint)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- MAJOR-1: a keyframed rotate on a crop-bearing (layers-style) cut must actually animate ------

test("MAJOR-1 regression: a keyframed rotate on a crop-declared cut animates over time instead of staying static", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  // crop (an identity crop, {x:0,y:0,w:1,h:1}) forces dispatch to appendCutLayerStyleVisual, the
  // builder that (pre-fix) only ever read the static cut.transform.rotate field and never
  // transformKeyframes.rotateExpr -- so a cut with ONLY keyframed rotate (no static
  // transform.rotate at all) rendered permanently un-rotated. 100x60 source at native scale
  // (transform omits scale -> 1): half-width 50, half-height 30. A canvas point at
  // dx=40 from center is inside the un-rotated box (half-width 50) but outside once rotated to
  // ~90 degrees (half-width becomes ~30, the old half-height) -- so sampling that same point near
  // the start and near the end of the keyframe range discriminates "did it actually rotate".
  const sources = [{ id: "pip", path: "pip.mp4", proxy: null }];
  const pipTrack = { id: "pip-track", lane: "visual", items: [
    {
      id: "pip-1", at: 0, duration: 30,
      source: { kind: "media", src: "pip", in: 0, out: 3 },
      crop: { x: 0, y: 0, w: 1, h: 1 },
      keyframes: [
        { t: 0, transform: { rotate: 0 } },
        { t: 3, transform: { rotate: 90 } },
      ],
    },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [pipTrack] };
  const root = await writeProject(edit);
  try {
    await makeColorSource(join(root, "pip.mp4"), { color: "magenta", duration: 3, width: 100, height: 60 });
    const output = await renderAndGetOutputPath(root);
    const nearStart = samplePixelRgb(output, 0.1, (160 + 40) / 320, 0.5);
    const nearEnd = samplePixelRgb(output, 2.9, (160 + 40) / 320, 0.5);
    t.diagnostic(`dx=40 sample near t=0 (rotate~=0deg)=${JSON.stringify(nearStart)}; near t=3 (rotate~=90deg)=${JSON.stringify(nearEnd)}`);
    assert.ok(isColor(nearStart, "magenta"), `expected magenta at dx=40 while still near 0deg: ${JSON.stringify(nearStart)}`);
    assert.ok(!isColor(nearEnd, "magenta"), `expected dx=40 to have rotated OUT of the footprint by ~90deg -- staying magenta means the keyframed rotate was never applied: ${JSON.stringify(nearEnd)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- MAJOR-2: framing must still apply when combined with crop/perspective/keyframes -------------

test("MAJOR-2 regression: cuts[].framing still applies when the same cut also declares crop", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  // crop is an identity crop (forces the appendCutLayerStyleVisual dispatch without changing the
  // frame itself) declared alongside source.framing (a punch-in that crops the CENTER 50%x50%
  // window and rescales it to fill the canvas). Pre-fix, appendCutLayerStyleVisual never read
  // cut.framing at all, so the marker (a white square in the extreme top-left corner, well
  // outside the center 50% window) stayed visible in the output. If framing actually applies, the
  // punch-in crops that corner away entirely and the whole frame should read as plain background
  // red, including at the exact source pixel the marker used to occupy.
  const sources = [{ id: "base", path: "base.mp4", proxy: null }];
  const track = { id: "t1", lane: "visual", items: [
    {
      id: "cut-1", at: 0, duration: 30,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      source: { kind: "media", src: "base", in: 0, out: 3, framing: { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } },
    },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [track] };
  const root = await writeProject(edit);
  try {
    makeMarkerSource(join(root, "base.mp4"), { duration: 3 });
    const output = await renderAndGetOutputPath(root);
    const cornerSample = samplePixelRgb(output, 1.5, 0.02, 0.02);
    t.diagnostic(`top-left corner (marker's own source position) after framing+crop=${JSON.stringify(cornerSample)}`);
    assert.ok(isColor(cornerSample, "red"), `expected the marker cropped away by framing's punch-in (plain red background), got ${JSON.stringify(cornerSample)} -- white here means framing was silently dropped`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- MAJOR-3: a declared transition overlap shorter than the actual timeline overlap must still
// blend (clamped to what's really available), not silently hard-cut and drop frames -------------

test("MAJOR-3 regression: transition_out still blends when the next cut's explicit `at` gives less overlap than declared", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const sources = [
    { id: "red", path: "red.mp4", proxy: null },
    { id: "blue", path: "blue.mp4", proxy: null },
  ];
  // c1 declares a 1s dissolve (10 frames @10fps); a fully-honored declaration would place c2 at
  // at=20 (2.0s, i.e. duration 30 - transition 10 = 20). c2 instead declares at=25 (2.5s) --
  // only 0.5s/5 frames of actual overlap, half of what was declared. Pre-fix this mismatch routed
  // the whole array to the gap-aware engine (no transition_out support at all): an instant hard
  // cut, c2's first 0.5s of source silently dropped, and both clips' full audio overlapping
  // audibly across the boundary. Post-fix, the transition duration actually rendered is clamped
  // to the real 0.5s overlap (not the declared 1s) and offset accordingly.
  const track = { id: "t1", lane: "visual", items: [
    { id: "c1", at: 0, duration: 30, source: { kind: "media", src: "red", in: 0, out: 3, transition_out: { type: "dissolve", duration: 1 } } },
    { id: "c2", at: 25, duration: 20, source: { kind: "media", src: "blue", in: 0, out: 2 } },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [track] };
  const root = await writeProject(edit);
  try {
    await makeColorSource(join(root, "red.mp4"), { color: "red", duration: 3 });
    await makeColorSource(join(root, "blue.mp4"), { color: "blue", duration: 2 });
    const output = await renderAndGetOutputPath(root);
    const duration = ffprobeDurationSeconds(output);
    t.diagnostic(`predicted/actual duration=${duration}s (expected ~4.5s: 3+2-0.5 actual overlap)`);
    assert.ok(Math.abs(duration - 4.5) <= 0.2, `expected ~4.5s (self-consistent either way; this alone would not catch the bug), got ${duration}s`);

    const beforeBoundary = samplePixelRgb(output, 2.4, 0.5, 0.5);
    const midBoundary = samplePixelRgb(output, 2.7, 0.5, 0.5);
    const afterBoundary = samplePixelRgb(output, 3.2, 0.5, 0.5);
    t.diagnostic(`before=${JSON.stringify(beforeBoundary)} mid=${JSON.stringify(midBoundary)} after=${JSON.stringify(afterBoundary)}`);
    assert.ok(isColor(beforeBoundary, "red"), `expected pure red before the transition window: ${JSON.stringify(beforeBoundary)}`);
    assert.ok(isColor(afterBoundary, "blue"), `expected pure blue after the transition window: ${JSON.stringify(afterBoundary)}`);
    assert.ok(!isColor(midBoundary, "red") && !isColor(midBoundary, "blue"), `expected a genuine red/blue blend inside the actual 0.5s overlap -- a hard cut here means transition_out was silently dropped: ${JSON.stringify(midBoundary)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
