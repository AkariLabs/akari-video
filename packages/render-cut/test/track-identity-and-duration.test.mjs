// P0 2026-08-20 track-identity-and-duration: オーナー実機報告の再現と回帰確認。
// 「本編（V1）にあった動画クリップを新しい段（新設トラック）へ移す」操作だけを行い、
// 実際に ffmpeg でレンダーして (a) 出力バイトが一致する (b) 総尺が変わらない
// (c) edit-lint が新しい error を出さない、の 3 点を実測する（契約の指示 4）。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";
import { readRenderEdit, renderItemKind } from "../src/internal-render.mjs";
import { renderProject } from "../src/render-cut.mjs";
import { lintProject } from "../../edit-lint/src/edit-lint.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);
const FPS = 10;

async function makeSource(path, { duration }) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=red:s=320x180:r=${FPS}:d=${duration}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

// tracks: 移動前は 'base'（本編トラック）に置く。移動後は 'base' を空のまま残し、新設した
// 'moved' トラックへ同じクリップを移す（apps/shell/extensions/akari-annotations の
// moveItemToNewTrack と同じ形。空トラックは削除しない）。
function editV2({ moved }) {
  const clipItem = { id: "c1", at: 0, duration: 30, source: { kind: "media", src: "main", in: 0, out: 3 } };
  const tracks = moved
    ? [
        { id: "base", lane: "visual", items: [] },
        { id: "moved", lane: "visual", items: [clipItem] },
      ]
    : [
        { id: "base", lane: "visual", items: [clipItem] },
      ];
  return {
    version: 2,
    output: { width: 320, height: 180, fps: FPS },
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    tracks,
  };
}

async function makeProject({ moved }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-track-identity-"));
  await makeSource(join(root, "main.mp4"), { duration: 3 });
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, "edit.json"), `${JSON.stringify(editV2({ moved }), null, 2)}\n`);
  return root;
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

// --- r2（wave-verify r1 差し戻し）: 既存の crop 付き PiP トラックへクリップを移す回帰テスト ---

function samplePixelRgb(path, time, xFrac, yFrac) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(time), "-i", path,
      "-frames:v", "1",
      "-vf", `crop=1:1:iw*${xFrac}:ih*${yFrac},format=rgb24`,
      "-f", "rawvideo", "pipe:1",
    ],
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

function isColorR2({ r, g, b }, expected) {
  if (expected === "green") return g > 100 && r < 60 && b < 60;
  if (expected === "magenta") return r > 200 && b > 200 && g < 60;
  throw new Error(`unknown color ${expected}`);
}

async function makeSourceColor(path, { color, duration }) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=${FPS}:d=${duration}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

// track a: 素の全画面クリップ（移動元。移動後は空になる）。
// track b: crop 付きの正当な PiP クリップが元々ある既存トラック（移動先）。
// 移動後は a が空になり b が mainVisualTrackId に昇格するが、b 上の PiP は
// crop/perspective/blend/keyframes のいずれかを宣言していれば layers のままであるべき
// （r1 で確認された回帰: 昇格したトラック上の無関係な既存クリップまで cuts へ黙って
// 再分類され、cuts 経路が crop を読まないため全画面不透明合成に化けて見た目が壊れていた）。
const PIP_ITEM = {
  id: "pip-1", at: 0, duration: 30,
  source: { kind: "media", src: "pip", in: 0, out: 3 },
  transform: { scale: 0.3 },
  crop: { x: 0, y: 0, w: 1, h: 1 },
};

function editV2R2({ moved }) {
  const tracks = moved
    ? [
        { id: "a", lane: "visual", items: [] },
        { id: "b", lane: "visual", items: [
          PIP_ITEM,
          { id: "c1", at: 30, duration: 30, source: { kind: "media", src: "main", in: 0, out: 3 } },
        ] },
      ]
    : [
        { id: "a", lane: "visual", items: [
          { id: "c1", at: 0, duration: 30, source: { kind: "media", src: "main", in: 0, out: 3 } },
        ] },
        { id: "b", lane: "visual", items: [PIP_ITEM] },
      ];
  return {
    version: 2,
    output: { width: 320, height: 180, fps: FPS },
    sources: [
      { id: "main", path: "main.mp4", proxy: null },
      { id: "pip", path: "pip.mp4", proxy: null },
    ],
    tracks,
  };
}

async function makeProjectR2({ moved }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-track-identity-r2-"));
  await makeSourceColor(join(root, "main.mp4"), { color: "green", duration: 3 });
  await makeSourceColor(join(root, "pip.mp4"), { color: "magenta", duration: 3 });
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, "edit.json"), `${JSON.stringify(editV2R2({ moved }), null, 2)}\n`);
  return root;
}

test("P0 2026-08-20 track-identity-and-duration r2: 既存の crop 付き PiP トラックへ移しても、動かしていない PiP の出力ピクセルが変わらない", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");

  const before = await makeProjectR2({ moved: false });
  const after = await makeProjectR2({ moved: true });
  try {
    const beforeLint = await lintProject(before);
    const afterLint = await lintProject(after);
    assert.equal(beforeLint.verdict, "pass", JSON.stringify(beforeLint.findings, null, 2));
    assert.equal(afterLint.verdict, "pass", JSON.stringify(afterLint.findings, null, 2));

    // P0 2026-08-21 render-path-unification: crop/transform (no blend / chroma_key / keyframed
    // perspective) is now a feature the 'cut' engine renders natively (cut-transform.mjs's
    // appendCutLayerStyleVisual), so both the untouched PiP and the moved plain clip classify
    // 'cut' -- classification no longer depends on which track an item sits on (edit-store's
    // needsLayersEngine only reads the item's own declared properties). What used to distinguish
    // "main content" from "PiP overlay" was a track-position guess; that guess is gone, and two
    // separate 'cut'-kind tracks now always z-order-composite through buildTrackStackPlan (see
    // plan.mjs's usesDefaultInternalTrackOrder), which is what the pixel assertions below verify:
    // the PiP keeps its own small, transparent-edged footprint, not an opaque full-frame takeover.
    const afterRenderEdit = readRenderEdit(await readFile(join(after, "edit.json"), "utf8"), join(after, ".akari", "render-tmp"));
    const trackB = afterRenderEdit.internal.tracks.find(track => track.id === "b");
    const pipItem = trackB.items.find(item => item.id === "pip-1");
    assert.equal(renderItemKind(pipItem), "cut", "the untouched PiP now renders through the unified cut path (crop/transform feature parity)");
    const movedItem = trackB.items.find(item => item.id === "c1");
    assert.equal(renderItemKind(movedItem), "cut", "the moved plain clip should still become the new main-track cut");

    const beforeState = await renderProject(before, {});
    const afterState = await renderProject(after, {});
    assert.equal(beforeState.verify.verdict, "pass", JSON.stringify(beforeState.verify.findings));
    assert.equal(afterState.verify.verdict, "pass", JSON.stringify(afterState.verify.findings));

    const beforeOutput = join(before, beforeState.plan.output);
    const afterOutput = join(after, afterState.plan.output);

    // PiP の窓 [0,3) の中の t=1.5s で、中心は常に PiP 色（magenta）のまま。
    // 端は before では下地の green（track a のクリップ）が透けて見えるが、
    // after では a が空になっているため下地が無くなり黒になる（このテストの主眼ではない、
    // track a を空にした副作用）。両状態で共通して検証すべきなのは「端が magenta に
    // 塗りつぶされていないこと」— pip-1 は 'cut' 分類だが、buildTrackStackPlan の
    // transparentBackground 経路（段ごとの自前キャンバスを下地へ合成）を通るため、
    // footprint 外は透明のまま保たれるはず。もし誤ってフラット/不透明全画面合成の分岐へ
    // 落ちていたら、端まで PiP 自身の色で塗りつぶされて背景が完全に消えるはずだが、
    // それは起きていない。
    const beforeCenter = samplePixelRgb(beforeOutput, 1.5, 0.5, 0.5);
    const beforeEdge = samplePixelRgb(beforeOutput, 1.5, 0.02, 0.02);
    assert.ok(isColorR2(beforeCenter, "magenta"), `before: expected magenta PiP at center: ${JSON.stringify(beforeCenter)}`);
    assert.ok(isColorR2(beforeEdge, "green"), `before: expected green base (track a) to show through at the edge: ${JSON.stringify(beforeEdge)}`);

    const afterCenter = samplePixelRgb(afterOutput, 1.5, 0.5, 0.5);
    const afterEdge = samplePixelRgb(afterOutput, 1.5, 0.02, 0.02);
    assert.ok(isColorR2(afterCenter, "magenta"), `after: expected magenta PiP at center (unchanged from before): ${JSON.stringify(afterCenter)}`);
    assert.ok(
      !isColorR2(afterEdge, "magenta"),
      `after: PiP must still be a small scaled overlay, not an opaque full-frame magenta rectangle: edge=${JSON.stringify(afterEdge)}`,
    );
    // 該当クリップ（PiP）自身の出力ピクセルは移動前後で完全一致すること。
    assert.deepEqual(afterCenter, beforeCenter, "the untouched PiP's own center pixel must be byte-identical before/after the move");
  } finally {
    await rm(before, { recursive: true, force: true });
    await rm(after, { recursive: true, force: true });
  }
});

test("P0 2026-08-20 track-identity-and-duration: 本編クリップを新設トラックへ移しても実レンダーが変わらない", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");

  const before = await makeProject({ moved: false });
  const after = await makeProject({ moved: true });
  try {
    // (c) edit-lint が新しい error を出さない: 実際に edit-lint を回して両方とも pass すること。
    const beforeLint = await lintProject(before);
    const afterLint = await lintProject(after);
    assert.equal(beforeLint.verdict, "pass", JSON.stringify(beforeLint.findings, null, 2));
    assert.equal(afterLint.verdict, "pass", JSON.stringify(afterLint.findings, null, 2));
    assert.equal(
      afterLint.findings.filter(finding => finding.severity === "error").length,
      0,
      JSON.stringify(afterLint.findings, null, 2),
    );

    // 分類そのものの回帰確認: 移した先のトラックでも media アイテムは 'cut' のまま
    // （'layer' へ落ちない = 描画経路が段によって変わらない）。
    const afterRenderEdit = readRenderEdit(await readFile(join(after, "edit.json"), "utf8"), join(after, ".akari", "render-tmp"));
    const movedTrack = afterRenderEdit.internal.tracks.find(track => track.id === "moved");
    assert.equal(renderItemKind(movedTrack.items[0]), "cut", "moved clip should still dispatch through the cut path");

    // 実レンダー本体: (a) 出力バイトが一致する (b) 総尺が変わらない。
    const beforeState = await renderProject(before, {});
    const afterState = await renderProject(after, {});
    assert.equal(beforeState.verify.verdict, "pass", JSON.stringify(beforeState.verify.findings));
    assert.equal(afterState.verify.verdict, "pass", JSON.stringify(afterState.verify.findings));

    assert.equal(
      afterState.plan.predicted_duration_seconds,
      beforeState.plan.predicted_duration_seconds,
      "moving the clip to a new track must not change the predicted total duration",
    );

    const beforeOutput = join(before, beforeState.plan.output);
    const afterOutput = join(after, afterState.plan.output);
    const beforeSha256 = await sha256File(beforeOutput);
    const afterSha256 = await sha256File(afterOutput);
    assert.equal(afterSha256, beforeSha256, "moving the clip to a new track must not change the rendered output bytes");
  } finally {
    await rm(before, { recursive: true, force: true });
    await rm(after, { recursive: true, force: true });
  }
});
