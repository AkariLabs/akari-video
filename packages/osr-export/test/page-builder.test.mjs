import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseElectronArguments } from "../src/electron-main.mjs";
import { buildOsrPage, loadAndBuildOsrPage } from "../src/page-builder.mjs";

const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30, look: { lut: "warm", intensity: 0.7 } },
  sources: [{ id: "main", path: "assets/main.mp4" }],
  cuts: [{ id: "cut-0", src: "main", in: 0, out: 2 }],
  overlays: [],
};
const captions = [{ id: "c1", start: 0, end: 1, text: "字幕", time_domain: "output" }];
const overlays = [{ id: "o1", start: 0, duration: 1, html: "<div>HTML</div>", transform: {}, vars: {} }];

test("page builder は同じ入力から同一バイトを生成する", () => {
  const input = { edit, captions, overlays, projectRoot: "/unused", duration: 2, frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;", lutCubeText: "TITLE warm\nLUT_3D_SIZE 2\n" };
  assert.equal(buildOsrPage(input).html, buildOsrPage(input).html);
});

test("page builder は4層、字幕生成器、H+1、canvas 内 LUT を宣言する", () => {
  const result = buildOsrPage({ edit, captions, overlays, projectRoot: "/unused", duration: 2, frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;", lutCubeText: "TITLE warm\nLUT_3D_SIZE 2\n" });
  assert.equal(result.manifest.dimensions.pageHeight, 181);
  assert.equal(result.edit.output.width, 320);
  assert.equal(result.edit.output.look.lut, "warm");
  assert.equal(result.manifest.captionOverlayCount, 1);
  assert.equal(result.manifest.lutApplication, "engine-canvas");
  assert.match(result.html, /height: 181px/);
  assert.match(result.html, /id="akari-engine"/);
  assert.match(result.html, /id="akari-overlays"/);
  assert.match(result.html, /TITLE warm/);
  assert.doesNotMatch(result.html, /filter:\s*url|filter:\s*lut/i);
  assert.match(result.overlaySheetHtml, /data-overlay-id="c1-01"/);
});

test("--edit 未指定の Electron 引数は null のままでも projectRoot/edit.json を読む", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-default-edit-"));
  try {
    await writeFile(join(projectRoot, "edit.json"), JSON.stringify({
      version: 2,
      output: { width: 222, height: 124, fps: 30 },
      sources: [{ id: "main", path: "assets/main.mp4", proxy: null }],
      tracks: [{
        id: "main-video",
        lane: "visual",
        items: [{
          id: "cut-0", at: 0, duration: 60,
          source: { kind: "media", src: "main", in: 0, out: 2 },
        }],
      }],
    }));
    const parsed = parseElectronArguments([
      "--render", projectRoot, "--out", join(projectRoot, "out.mp4"), "--duration", "2",
    ]);
    assert.equal(parsed.editPath, null);
    const built = await loadAndBuildOsrPage({
      projectRoot,
      editPath: parsed.editPath,
      fps: 30,
      width: 222,
      height: 124,
      duration: 2,
    });
    assert.equal(built.edit.output.width, 222);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
