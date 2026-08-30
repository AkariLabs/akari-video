import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readRenderEdit } from "../src/internal-render.mjs";
import { renderOverlaySheet } from "../src/rasterize.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "item-keyframes");

test("projects inline, bag, and pure-group child keyframes as arrays", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const { edit } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp"), {
    projectRoot: fixtureRoot,
  });
  const byId = new Map(edit.overlays.map((overlay) => [overlay.id, overlay]));
  assert.equal(byId.get("plain").keyframes.length, 2);
  assert.equal(byId.get("plain").keyframes[1].t, 120);
  assert.equal(byId.get("s01.B").keyframes.length, 3);
  assert.equal(byId.get("g1.first").keyframes.length, 2);
  assert.equal(byId.get("g1.first").keyframes[1].t, 120);
  assert.equal(byId.get("s01.C").keyframes, undefined);
});

test("a missing keyframes bag warns and keeps the item static", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-item-keyframes-"));
  try {
    await cp(fixtureRoot, root, { recursive: true });
    await rm(join(root, "motion", "s01.json"));
    const warnings = [];
    const source = await readFile(join(root, "edit.json"), "utf8");
    const { edit } = readRenderEdit(source, join(root, ".akari", "render-tmp"), {
      projectRoot: root,
      onWarning: warning => warnings.push(warning),
    });
    assert.equal(edit.overlays.find((overlay) => overlay.id === "s01.B").keyframes, undefined);
    assert.match(warnings.join("\n"), /could not be read/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlay sheet adds the shared runtime only when item keyframes exist", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const { edit } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp"), {
    projectRoot: fixtureRoot,
  });
  const overlays = await Promise.all(edit.overlays.map(async (overlay) => ({
    ...overlay,
    html: overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : await readFile(join(fixtureRoot, overlay.html), "utf8"),
  })));
  const dynamicSheet = renderOverlaySheet({ overlays, edit, projectRoot: fixtureRoot, duration: 5 });
  assert.match(dynamicSheet, /data-akari-keyframes=/u);
  assert.match(dynamicSheet, /interpolateKeyframes/u);

  const staticOverlays = overlays.map(({ keyframes: _keyframes, ...overlay }) => overlay);
  const staticSheet = renderOverlaySheet({ overlays: staticOverlays, edit, projectRoot: fixtureRoot, duration: 5 });
  assert.doesNotMatch(staticSheet, /data-akari-keyframes=/u);
  assert.doesNotMatch(staticSheet, /interpolateKeyframes/u);
});
