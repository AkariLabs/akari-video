import assert from "node:assert/strict";
import test from "node:test";

import { buildOsrPage } from "../src/page-builder.mjs";

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
