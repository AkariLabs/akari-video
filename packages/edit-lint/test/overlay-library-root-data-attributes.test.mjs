import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { lintProject } from "../src/edit-lint.mjs";

// ライブラリの断片は data-start="0" data-duration="<素材の長さ>" で配られる（例: chalkboard-jp は 8 秒）。
const LIBRARY_FRAGMENT = '<div class="board" data-start="0" data-duration="8"><p>黒板</p></div>';

async function lintOverlay(t, { shared }) {
  const project = await mkdtemp(join(tmpdir(), "lint-library-root-attrs-"));
  const libraryHome = await mkdtemp(join(tmpdir(), "lint-library-root-attrs-home-"));
  t.after(() => Promise.all([project, libraryHome].map(dir => rm(dir, { recursive: true, force: true }))));
  await mkdir(join(project, ".akari"), { recursive: true });
  if (shared) {
    // 共有ライブラリ参照: プロジェクトに実体は無く、原本を AKARI_HOME/assets から読む。
    await writeFile(join(project, ".akari/asset-references.json"),
      JSON.stringify({ version: 0, references: [{ category: "overlay", id: "board" }] }));
    await mkdir(join(libraryHome, "assets/overlay/board"), { recursive: true });
    await writeFile(join(libraryHome, "assets/overlay/board/fragment.html"), LIBRARY_FRAGMENT);
  } else {
    await mkdir(join(project, "assets/overlay/board"), { recursive: true });
    await writeFile(join(project, "assets/overlay/board/fragment.html"), LIBRARY_FRAGMENT);
  }
  // 34.133… 秒（1024 フレーム）に 5 秒で置いた、実機報告（2026-09-27）と同じ形。
  await writeFile(join(project, "edit.json"), JSON.stringify({
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [],
    tracks: [{ id: "visual", lane: "visual", items: [
      { id: "board", at: 1024, duration: 150, source: { kind: "html", path: "assets/overlay/board/fragment.html" } },
    ] }],
  }));
  const result = await lintProject(project, {
    writeReports: false, env: { ...process.env, AKARI_HOME: libraryHome, AKARI_LIBRARY_ROOT: "" },
  });
  return result.findings.filter(finding => finding.check.startsWith("overlays.")).map(finding => finding.check);
}

test("shared-library overlay fragments are not checked for root data-start/data-duration", async t => {
  assert.deepEqual(await lintOverlay(t, { shared: true }), []);
});

test("project-local overlay fragments keep the root data-start/data-duration checks", async t => {
  assert.deepEqual((await lintOverlay(t, { shared: false })).sort(), [
    "overlays.data-attributes", "overlays.data-attributes", "overlays.root-data-attributes",
  ]);
});
