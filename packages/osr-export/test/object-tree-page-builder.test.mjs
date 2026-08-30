import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadAndBuildOsrPage } from "../src/page-builder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../render-cut/test/fixtures/object-tree-html-bag");

test("OSR page builder consumes six projected object-tree overlays and three clone masks", async () => {
  const result = await loadAndBuildOsrPage({
    projectRoot: fixtureRoot,
    editPath: join(fixtureRoot, "edit.json"),
    fps: 30,
    width: 640,
    height: 360,
    duration: 4,
  });

  assert.equal(result.edit.overlays.length, 6);
  assert.deepEqual(result.edit.overlays.map(overlay => overlay.id), [
    "s01#A", "s01.B", "g1.first", "g1.second", "plain", "s01.C",
  ]);
  assert.equal((result.overlaySheetHtml.match(/<div data-akari-part-mask=/gu) ?? []).length, 3);
  assert.equal((result.overlaySheetHtml.match(/visibility:hidden !important/gu) ?? []).length, 3);
});
