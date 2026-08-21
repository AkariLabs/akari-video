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

// r5 (Codex re-review, real regression this task's own r4 fix introduced): r4's duration:0
// projection fix short-circuited on `playbackDuration === 0` (packages/edit-store/src/
// internal-model.ts's buildV2Item), which also catches a WHOLE-REGION freeze -- a genuinely
// positive item.duration where ALL of it is a frozen hold (e.g. duration: 1s with
// freeze.duration_sec: 1s), since playbackDuration = duration - freezeSeconds = 0 there too. r4
// collapsed that case's trim window to cutOut === cutIn (a literal zero-frame stream), starving
// appendFreezeAwareVideoTrim (packages/render-cut/src/cut-freeze.mjs) of any seed frame to hold
// at all. Fixed by keying the short-circuit off the item's own declared durationFrames instead of
// the freeze-adjusted playbackDuration -- this test renders a real whole-region freeze end to end
// (v2 edit.json -> internal-model projection -> render-cut) and confirms it still holds a real,
// visible frame for its full declared duration, matching what a partial freeze (the sibling test
// above) already does.
test("freeze regression (r5): a whole-region freeze (item.duration entirely covered by freeze.duration_sec) still holds a real seed frame, not an empty trim window", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const sources = [{ id: "moving", path: "moving.mp4", proxy: null }];
  const mainTrack = { id: "main", lane: "visual", items: [
    // duration: 1s, freeze.duration_sec: 1s -- the ENTIRE declared v2 duration is "spent" on the
    // frozen hold (playbackDuration = 1 - 1 = 0 in buildV2Item's own accounting), unlike the
    // partial-freeze test above (duration 4s, freeze only 1s of it). at_sec:0 means the hold is
    // inserted right at the start of the [in,out) window, before any of it plays normally.
    // render-cut's OWN segmentDuration (cut-timeline.mjs) treats freeze as ADDITIVE on top of
    // however long (out-in)/speed already takes, independent of and unaffected by this task's own
    // r4/r5 fixes -- for this declaration that's (1-0)/1 + 1 = 2s total, not 1s (verified directly
    // against the exported segmentDuration function before writing this assertion, to avoid
    // asserting a plausible-sounding but wrong expected value). This test's actual purpose is
    // narrower and unrelated to that pre-existing arithmetic: confirm r5 does NOT starve the trim
    // window into an empty (cutOut === cutIn) stream the way r4's playbackDuration===0 bug did --
    // i.e. that a real, non-black seed frame is held, matching whatever main/pre-r4 already
    // produced for this exact declaration shape.
    { id: "c1", at: 0, duration: 10, source: { kind: "media", src: "moving", in: 0, out: 1, freeze: { at_sec: 0, duration_sec: 1 } } },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [mainTrack] };
  const root = await writeProject(edit);
  try {
    makeMovingSource(join(root, "moving.mp4"), { duration: 1 });
    const output = await renderAndGetOutputPath(root);
    const duration = ffprobeDurationSeconds(output);
    t.diagnostic(`whole-region freeze output duration=${duration}s (expected ~2s: (out-in)/speed=1s + freeze.duration_sec=1s, additive per cut-timeline.mjs's own segmentDuration)`);
    assert.ok(Math.abs(duration - 2) <= 0.15, `expected ~2s ((out-in)/speed + freeze, additive), got ${duration}s`);
    // The frozen hold (at_sec:0) sits at the very start of the timeline -- two timestamps well
    // within [0, 1) must be pixel-identical (a real, held seed frame), and that frame must not be
    // a black/empty decode failure from a starved zero-frame trim.
    const frameA = frameBytes(output, 0.1);
    const frameB = frameBytes(output, 0.8);
    assertFramesMatch(frameB, frameA, "two frames inside the whole-region frozen span must be pixel-identical (a real held seed frame)");
    const isBlack = frameA.every(byte => byte < 8);
    assert.ok(!isBlack, `expected a real decoded seed frame (testsrc content), not a black/empty frame from a starved zero-frame trim window: sample bytes ${JSON.stringify([...frameA.slice(0, 12)])}`);
  } finally {
    await rm(root, { recursive: true, force: true });
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

// r3 (2026-08-21, Codex re-review after the r2 fix): the original BLOCKER repro is structurally
// a PiP OVERLAY, which -- per the original report's own wording ("1本のbase cutsトラック+
// transform-onlyPiPトラックの既定順プロジェクト") and per usesDefaultInternalTrackOrder's own
// "more than one 'cuts' track always routes through buildTrackStackPlan" rule -- always requires
// at least two visual tracks (a base + the PiP), which is exactly what makes this item's own
// canvas a non-bottom buildTrackStackPlan stage (transparentBackground=true). A single lone
// track with no base beneath it isn't a genuine overlay at all (there's nothing for it to be
// "on top of") -- see cut-transform.mjs's own comment on the transparentBackground-gated fit for
// why that shape is instead correctly treated as canvas-basis main content (r3's own fix for a
// DIFFERENT regression the r2-only fix introduced -- see the very next test below). This test's
// own base track is deliberately a plain, untransformed, same-resolution clip so its own content
// is uninteresting -- it exists only to give the PiP track something to sit "on top of" and
// produce the correct transparentBackground=true stage.
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
  const sources = [
    { id: "base", path: "base.mp4", proxy: null },
    { id: "pip", path: "pip.mp4", proxy: null },
  ];
  const baseTrack = { id: "base-track", lane: "visual", items: [
    { id: "b1", at: 0, duration: 30, source: { kind: "media", src: "base", in: 0, out: 3 } },
  ] };
  const pipTrack = { id: "pip-track", lane: "visual", items: [
    { id: "pip-1", at: 0, duration: 30, source: { kind: "media", src: "pip", in: 0, out: 3 }, transform: { scale: 0.3 } },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [baseTrack, pipTrack] };
  const root = await writeProject(edit);
  try {
    await makeColorSource(join(root, "base.mp4"), { color: "green", duration: 3 });
    await makeColorSource(join(root, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
    const output = await renderAndGetOutputPath(root);
    const insideCorrectFootprint = samplePixelRgb(output, 1.5, 0.5, 90 / 180);
    const beyondCorrectFootprint = samplePixelRgb(output, 1.5, 0.5, 70 / 180);
    t.diagnostic(`center=${JSON.stringify(insideCorrectFootprint)} 20px-above-center=${JSON.stringify(beyondCorrectFootprint)}`);
    assert.ok(isColor(insideCorrectFootprint, "magenta"), `expected magenta at the footprint's own center: ${JSON.stringify(insideCorrectFootprint)}`);
    assert.ok(!isColor(beyondCorrectFootprint, "magenta"), `expected the base track's green to show through 20px above center (outside the correct 30px-tall footprint) -- magenta here means the footprint was inflated by a canvas fit step: ${JSON.stringify(beyondCorrectFootprint)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// r3: the main-content regression the r2-only fix introduced -- a main clip (no PiP track, no
// framing, a plain/default transform) whose source resolution differs from the output canvas
// used to render as a center CROP of the source instead of a full-frame DOWNSCALE, because r2
// made the canvas-fit step conditional on cuts[].framing alone, which this shape never declares.
test("BLOCKER regression (r3): a main clip whose source resolution differs from the canvas still downscales to fit, not a center crop", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  // 640x360 source (same 16:9 aspect as the 320x180 canvas, so a correct fit is a clean 2x
  // downscale with zero letterbox padding -- isolates the fit-vs-crop question from framing's
  // own separately-tested letterbox math). testsrc so the frame has real spatial structure: a
  // center crop and a full downscale produce a whole-frame content that differs almost
  // everywhere (unlike a solid color source, or a single sampled pixel -- testsrc's own pattern
  // happens to be flat/black at some individual points in BOTH interpretations, which is why this
  // compares the ENTIRE decoded frame's mean per-byte difference against a known-correct
  // reference, the same tolerance-based whole-frame technique this file's own
  // assertFramesMatch/assertSameColor helpers already use for lossy-encode-safe comparison,
  // rather than a single hand-picked sample point).
  const sources = [{ id: "main", path: "main.mp4", proxy: null }];
  const mainTrack = { id: "main-track", lane: "visual", items: [
    { id: "m1", at: 0, duration: 30, transform: { x: 0, y: 0, scale: 1 }, source: { kind: "media", src: "main", in: 0, out: 3 } },
  ] };
  const edit = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [mainTrack] };
  const root = await writeProject(edit);
  try {
    const sourcePath = join(root, "main.mp4");
    makeMovingSource(sourcePath, { duration: 3, width: 640, height: 360 });
    const output = await renderAndGetOutputPath(root);
    // The known-correct reference: the same source, plain ffmpeg-scaled to the canvas size (a
    // full downscale, not a crop) -- independent of render-cut's own pipeline entirely.
    const referencePath = join(root, "reference.mp4");
    ffmpeg(["-i", sourcePath, "-vf", `scale=${WIDTH}:${HEIGHT}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", referencePath]);
    const actual = frameBytes(output, 1.5);
    const reference = frameBytes(referencePath, 1.5);
    let total = 0;
    for (let index = 0; index < actual.length; index += 1) total += Math.abs(actual[index] - reference[index]);
    const meanDiff = total / actual.length;
    t.diagnostic(`mean per-byte diff against a plain full-downscale reference: ${meanDiff.toFixed(3)} (a center-crop bug measured ~68 by hand; ordinary lossy re-encode noise measured ~1)`);
    assert.ok(meanDiff <= 10, `expected a full-frame downscale (mean diff close to ordinary encode noise), not a center crop of the source: mean diff ${meanDiff.toFixed(3)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// r4 (2026-08-21, Codex diff re-review of the r3 fix): the r3 fix (appendCutVisualTransform's
// fit-basis keyed off transparentBackground) was itself still wrong at the exact boundary it was
// meant to fix -- buildTrackStackPlan passed transparentBackground:true unconditionally to EVERY
// cuts-kind stage, including stageIndex 0 (the true bottom of the stack, whose own `previous` is
// always a plain black basePath with no real content -- see track-compose.mjs's
// buildTrackBaseCommand). So a bottom-stage transform/opacity clip's own rendered geometry
// depended on whether a stack existed at all, not on its own declaration -- reachable just by
// adding an unrelated second 'cuts' track next to it. r4 decouples the fit-basis question into
// its own signal (canvasBasisTransform, plan.mjs), computed as `stageIndex === 0` independent of
// transparentBackground (which still controls alpha compositing AND this stage's own lossless
// qtrle intermediate codec choice -- an unrelated concern threaded through unchanged).
test("BLOCKER regression (r4): adding an unrelated, non-overlapping-in-time second cuts track does not change an existing bottom-stage clip's own geometry", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  // 640x360 (16:9) testsrc main clip, plain default transform, no framing -- the exact
  // main-content shape from the r3 test above. Rendered alone (flat/default dispatch) as the
  // reference, then again with a second, entirely non-overlapping-in-time cuts track added
  // (forces buildTrackStackPlan) -- the main clip's own rendered frame must be unaffected by a
  // track it never shares a moment on screen with.
  const sources = [
    { id: "main", path: "main.mp4", proxy: null },
    { id: "decoy", path: "decoy.mp4", proxy: null },
  ];
  const mainTrack = { id: "main-track", lane: "visual", items: [
    { id: "m1", at: 0, duration: 20, transform: { x: 0, y: 0, scale: 1 }, source: { kind: "media", src: "main", in: 0, out: 2 } },
  ] };
  const decoyTrack = { id: "decoy-track", lane: "visual", items: [
    { id: "d1", at: 25, duration: 10, source: { kind: "media", src: "decoy", in: 0, out: 1 } },
  ] };
  const alone = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources: [sources[0]], tracks: [mainTrack] };
  const withDecoy = { version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS }, sources, tracks: [mainTrack, decoyTrack] };
  const rootAlone = await writeProject(alone);
  const rootWithDecoy = await writeProject(withDecoy);
  try {
    makeMovingSource(join(rootAlone, "main.mp4"), { duration: 2, width: 640, height: 360 });
    makeMovingSource(join(rootWithDecoy, "main.mp4"), { duration: 2, width: 640, height: 360 });
    await makeColorSource(join(rootWithDecoy, "decoy.mp4"), { color: "red", duration: 1 });
    const outputAlone = await renderAndGetOutputPath(rootAlone);
    const outputWithDecoy = await renderAndGetOutputPath(rootWithDecoy);
    const frameAlone = frameBytes(outputAlone, 1.0);
    const frameWithDecoy = frameBytes(outputWithDecoy, 1.0);
    let total = 0;
    for (let index = 0; index < frameAlone.length; index += 1) total += Math.abs(frameAlone[index] - frameWithDecoy[index]);
    const meanDiff = total / frameAlone.length;
    t.diagnostic(`mean per-byte diff, alone vs. with an unrelated non-overlapping decoy track added: ${meanDiff.toFixed(3)} (a basis-flip bug measured ~109 by hand; ordinary lossy re-encode noise measured ~1)`);
    assert.ok(meanDiff <= 10, `expected the main clip's own geometry to be unaffected by an unrelated track it never shares a moment with: mean diff ${meanDiff.toFixed(3)}`);
  } finally {
    await Promise.all([rootAlone, rootWithDecoy].map(root => rm(root, { recursive: true, force: true })));
  }
});

// r4: the companion case to the test above -- an item declared with a small, PiP-style transform
// (matching the ORIGINAL BLOCKER's own shape) renders native-basis (its own small footprint) when
// it's an upper, non-bottom stage sitting on top of a base track, but must switch to canvas-basis
// (a full-canvas fit, since transform.scale=1's default now applies to the fitted frame) once
// it's moved down to become the sole/bottom track -- matching what the identical declaration
// would do in the flat/default (no-stack) dispatch, exactly like "main" behaves. (The former base
// track is dropped entirely for the "moved" case, rather than swapped to sit on top of the pip:
// stacking it above with its own full-canvas, untransformed content would completely obscure the
// pip underneath regardless of the pip's own basis, which would test compositing z-order instead
// of the fit-basis question this test is actually isolating.)
test("BLOCKER regression (r4): moving a PiP-declared item down to become the sole/bottom track switches it to canvas-basis, matching the flat/default dispatch", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg unavailable");
  const pipItem = { id: "pip-1", at: 0, duration: 30, source: { kind: "media", src: "pip", in: 0, out: 3 }, transform: { scale: 0.3 } };
  // Upper stage (unchanged from the original BLOCKER shape): base track first (bottom), PiP track second (top).
  const upper = {
    version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS },
    sources: [
      { id: "base", path: "base.mp4", proxy: null },
      { id: "pip", path: "pip.mp4", proxy: null },
    ],
    tracks: [
      { id: "base-track", lane: "visual", items: [{ id: "b1", at: 0, duration: 30, source: { kind: "media", src: "base", in: 0, out: 3 } }] },
      { id: "pip-track", lane: "visual", items: [pipItem] },
    ],
  };
  // Moved down to become the sole track (the base content is removed entirely, not stacked above
  // it -- see the comment above): pip-1 now goes through the flat/default dispatch, exactly like
  // any other single-track main-content clip.
  const movedToSoleTrack = {
    version: 2, output: { width: WIDTH, height: HEIGHT, fps: FPS },
    sources: [{ id: "pip", path: "pip.mp4", proxy: null }],
    tracks: [{ id: "pip-track", lane: "visual", items: [pipItem] }],
  };
  const rootUpper = await writeProject(upper);
  const rootMoved = await writeProject(movedToSoleTrack);
  try {
    await makeColorSource(join(rootUpper, "base.mp4"), { color: "green", duration: 3 });
    await makeColorSource(join(rootUpper, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
    await makeColorSource(join(rootMoved, "pip.mp4"), { color: "magenta", duration: 3, width: 200, height: 100 });
    const outputUpper = await renderAndGetOutputPath(rootUpper);
    const outputMoved = await renderAndGetOutputPath(rootMoved);
    // Upper stage: native-basis, small (60x30) footprint -- 20px above center is outside it.
    const upperBeyondFootprint = samplePixelRgb(outputUpper, 1.5, 0.5, 70 / 180);
    t.diagnostic(`upper stage, 20px above center: ${JSON.stringify(upperBeyondFootprint)} (expected NOT magenta -- small native-basis footprint)`);
    assert.ok(!isColor(upperBeyondFootprint, "magenta"), `expected the upper-stage PiP to keep its small native-basis footprint: ${JSON.stringify(upperBeyondFootprint)}`);
    // Moved to sole/bottom track: canvas-basis -- transform.scale=0.3 now shrinks the FITTED
    // (full-canvas) frame, so the footprint should be much larger and clearly present well beyond
    // the small native-basis footprint's own bounds.
    const movedBeyondFootprint = samplePixelRgb(outputMoved, 1.5, 0.5, 70 / 180);
    t.diagnostic(`moved to sole/bottom track, 20px above center: ${JSON.stringify(movedBeyondFootprint)} (expected magenta -- canvas-basis footprint is much larger)`);
    assert.ok(isColor(movedBeyondFootprint, "magenta"), `expected the item to switch to a canvas-basis (larger) footprint once moved to the sole/bottom track, matching the flat/default dispatch: ${JSON.stringify(movedBeyondFootprint)}`);
  } finally {
    await Promise.all([rootUpper, rootMoved].map(root => rm(root, { recursive: true, force: true })));
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
