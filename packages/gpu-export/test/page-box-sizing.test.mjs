import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildGpuPage } from "../src/page-builder.mjs";
import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = join(packageRoot, "..", "..");
const edit = { version: 1, sources: [], cuts: [], output: { width: 320, height: 180, fps: 30 } };
const panel = '<div class="panel" style="width:760px;padding:26px 32px">A</div>';

test("the GPU page applies the preview border-box default to its DOM stage", () => {
  const built = buildGpuPage({ edit, projectRoot, duration: 1, width: 320, height: 180 });
  assert.match(built.html, /#akari-dom-stage, #akari-dom-stage \* \{ box-sizing: border-box; \}/u);
});

test("the GPU overlay sheet uses the same border-box default as the preview", () => {
  const sheet = renderOverlaySheet({
    overlays: [{ id: "panel", html: panel, start: 0, duration: 1 }],
    edit,
    projectRoot,
    duration: 1,
  });
  assert.match(sheet, /\* \{ box-sizing: border-box; \}/u);
});

test("legacy sheets without a sized padded fragment keep their bytes", () => {
  const sheet = renderOverlaySheet({
    overlays: [{ id: "plain", html: "<div>rectangle</div>", start: 0, duration: 1 }],
    edit,
    projectRoot,
    duration: 1,
  });
  assert.doesNotMatch(sheet, /\* \{ box-sizing: border-box; \}/u);
});

test("the GPU static-sprite document uses the same border-box default as the preview", async () => {
  const runtime = await readFile(join(packageRoot, "src", "page-runtime.js"), "utf8");
  assert.match(runtime, /html,body\{margin:0;width:100%;height:100%;overflow:hidden\}\*\{box-sizing:border-box\}/u);
});
