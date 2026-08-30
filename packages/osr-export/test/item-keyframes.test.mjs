import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readRenderEdit } from "../../render-cut/src/internal-render.mjs";
import { buildOsrPage } from "../src/page-builder.mjs";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "render-cut", "test", "fixtures", "item-keyframes",
);

test("OSR overlay sheet receives inline and resolved bag item keyframes", async () => {
  const sourceText = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const edit = readRenderEdit(sourceText, join(fixtureRoot, ".akari", "render-tmp"), {
    projectRoot: fixtureRoot,
  }).edit;
  const overlays = await Promise.all(edit.overlays.map(async (overlay) => ({
    ...overlay,
    html: overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : await readFile(join(fixtureRoot, overlay.html), "utf8"),
  })));
  const result = buildOsrPage({
    edit,
    overlays,
    projectRoot: fixtureRoot,
    fps: 30,
    width: 640,
    height: 360,
    duration: 5,
    stampRow: false,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
  });
  assert.equal((result.overlaySheetHtml.match(/data-akari-keyframes=/gu) ?? []).length, 3);
  assert.match(result.overlaySheetHtml, /data-overlay-id="s01\.B"[^>]+data-akari-keyframes=/u);
  assert.match(result.overlaySheetHtml, /function interpolateKeyframes/u);

  const source = JSON.parse(sourceText);
  assert.equal(source.tracks.at(-1).items[0].keyframes, undefined);
});
