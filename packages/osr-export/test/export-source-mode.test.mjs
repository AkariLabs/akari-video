import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EXPORT_SOURCE_ENV, resolveExportSourceMode } from "../src/export-source-mode.mjs";
import { buildOsrPage } from "../src/page-builder.mjs";
import { buildOsrReceipt, normalizeSourceSelections } from "../src/receipt.mjs";

const edit = {
  version: 1,
  output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: "main", path: "assets/main.mp4", proxy: "assets/main.proxy.mp4" }],
  cuts: [{ id: "cut-0", src: "main", in: 0, out: 2 }],
  overlays: [],
};

test("AKARI_EXPORT_SOURCE の既定は original（未設定・未知の値・空文字は原本）", () => {
  assert.equal(EXPORT_SOURCE_ENV, "AKARI_EXPORT_SOURCE");
  assert.equal(resolveExportSourceMode({}), "original");
  assert.equal(resolveExportSourceMode({ AKARI_EXPORT_SOURCE: "" }), "original");
  assert.equal(resolveExportSourceMode({ AKARI_EXPORT_SOURCE: "nonsense" }), "original");
  assert.equal(resolveExportSourceMode({ AKARI_EXPORT_SOURCE: "original" }), "original");
  assert.equal(resolveExportSourceMode({ AKARI_EXPORT_SOURCE: " PROXY " }), "proxy");
  assert.equal(resolveExportSourceMode({ AKARI_EXPORT_SOURCE: "Auto" }), "auto");
});

test("OSR ページ config は sourceMode を運ぶ（既定 original・切り戻しは env 相当の引数）", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-source-mode-"));
  try {
    const page = buildOsrPage({ edit, projectRoot, width: 320, height: 180, fps: 30, duration: 2 });
    assert.match(page.html, /"sourceMode":"original"/u);
    const overridden = buildOsrPage({
      edit, projectRoot, width: 320, height: 180, fps: 30, duration: 2, sourceMode: "proxy",
    });
    assert.match(overridden.html, /"sourceMode":"proxy"/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("OSR レシートは素材ごとの chosen / reason / path / 寸法を残す", () => {
  const receipt = buildOsrReceipt({
    tier: 1,
    run: {
      sources: [
        { id: "s1", chosen: "original", reason: "hardware-ok", path: ".akari/work/silent/a.MOV", width: 1920, height: 1080, codec: "avc1.640028" },
        { id: "s2", chosen: "proxy", reason: "codec-unsupported", path: ".akari/sidecars/b.mp4", width: 406, height: 720 },
      ],
    },
  });
  assert.deepEqual(receipt.sources, [
    { id: "s1", chosen: "original", reason: "hardware-ok", path: ".akari/work/silent/a.MOV", width: 1920, height: 1080, codec: "avc1.640028" },
    { id: "s2", chosen: "proxy", reason: "codec-unsupported", path: ".akari/sidecars/b.mp4", width: 406, height: 720 },
  ]);
  assert.equal(buildOsrReceipt({ tier: 1, run: {} }).sources, null);
  // 製品経路（osr-export/src/index.mjs）は receipt の run に run.json のパスを渡すので、
  // 素材選択は sources 引数で受ける。
  const viaArgument = buildOsrReceipt({
    tier: 1,
    run: ".akari/osr-run.json",
    sources: [{ id: "a", chosen: "original", reason: "hardware-ok", path: "assets/a.mp4", width: 1920, height: 1080 }],
  });
  assert.deepEqual(viaArgument.sources, [
    { id: "a", chosen: "original", reason: "hardware-ok", path: "assets/a.mp4", width: 1920, height: 1080 },
  ]);
  assert.equal(viaArgument.run, ".akari/osr-run.json");
});

test("normalizeSourceSelections は必須キーの欠けた要素を落とす", () => {
  assert.equal(normalizeSourceSelections(null), null);
  assert.deepEqual(normalizeSourceSelections([
    { id: "", chosen: "original", reason: "hardware-ok", path: "a.mp4" },
    { id: "s1", chosen: "sideways", reason: "hardware-ok", path: "a.mp4" },
    { id: "s2", chosen: "original", reason: "", path: "a.mp4" },
    { id: "s3", chosen: "original", reason: "hardware-ok", path: "" },
    { id: "s4", chosen: "auto-proxy", reason: "auto-proxy", path: "a.mp4", width: 0, height: -1 },
  ]), [{ id: "s4", chosen: "auto-proxy", reason: "auto-proxy", path: "a.mp4", width: null, height: null }]);
});

test("OSR page-runtime は選択結果をページのグローバルへ置き electron-main が run.json へ写す", async () => {
  const [runtime, main] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/electron-main.mjs", import.meta.url), "utf8")),
  ]);
  assert.match(runtime, /window\.__akariSourceSelections = sourceSelection\.records;/u);
  assert.match(main, /readSourceSelections/u);
  assert.match(main, /sources: sourceSelections,/u);
});
