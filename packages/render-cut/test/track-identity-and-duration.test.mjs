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
