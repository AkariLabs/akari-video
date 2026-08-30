import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readRenderEdit } from "../src/internal-render.mjs";
import { renderOverlaySheet } from "../src/rasterize.mjs";
import { enumerateDeclaredRenderInputs } from "../src/render-inputs.mjs";
import { loadAndBuildGpuPage } from "../../gpu-export/src/page-builder.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "object-tree-html-bag");

test("expanded renderer projection preserves frame-derived fractional overlay times exactly", () => {
  const source = {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [],
    tracks: [{ id: "v1", lane: "visual", items: [{
      id: "fractional",
      at: 264,
      duration: 96,
      source: { kind: "html", path: "<div>fractional</div>" },
    }] }],
  };
  const record = readRenderEdit(
    source,
    "/project/.akari/render-tmp/osr-page",
  ).edit.overlays[0];
  assert.equal(Object.is(record.start, 264 / 30), true);
  assert.equal(Object.is(record.duration, 96 / 30), true);
});

test("render-cut front-door keeps source paths until declared inputs are frozen", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const { edit, internal } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp"));
  assert.deepEqual(edit.overlays.map(overlay => overlay.id), [
    "s01", "s01.B", "g1.first", "g1.second", "plain", "s01.C",
  ]);
  assert.ok(edit.overlays.every(overlay => /^overlays\/(?:card|plain)\.html$/u.test(overlay.html)));
  const inputs = await enumerateDeclaredRenderInputs({
    projectRoot: fixtureRoot,
    edit,
    editText: source,
    internalEdit: internal,
  });
  assert.equal(inputs.filter(input => input.role.startsWith("overlay:")).length, 6);

  const forcedExpanded = readRenderEdit(
    source,
    join(fixtureRoot, ".akari", "render-tmp"),
    { expandParts: true },
  ).edit;
  assert.equal(forcedExpanded.overlays[0].id, "s01#A", "explicit true overrides render-tmp inference");

  const forcedUnexpanded = readRenderEdit(
    source,
    join(fixtureRoot, ".akari", "render-tmp", "osr-page"),
    { expandParts: false },
  ).edit;
  assert.equal(forcedUnexpanded.overlays[0].id, "s01", "explicit false overrides osr-page inference");
});

test("object-tree HTML bag fixture projects six stable renderer records", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const { edit } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp", "test"));

  assert.deepEqual(edit.overlays.map(overlay => overlay.id), [
    "s01#A", "s01.B", "g1.first", "g1.second", "plain", "s01.C",
  ]);
  assert.equal(edit.overlays.length, 6);
  assert.equal(edit.overlays.filter(overlay => overlay.html.includes("data-akari-part-mask")).length, 3);

  const explicit = edit.overlays.find(overlay => overlay.id === "s01.B");
  assert.equal(explicit.start, 6 / 30);
  assert.equal(explicit.duration, 114 / 30);
  assert.equal(explicit.part, "B");
  assert.equal(explicit.parentId, "s01");
  assert.equal(explicit.transform.y, -40);
  assert.match(explicit.html, /color:red/u);
  assert.match(explicit.html, /差し替え/u);

  const firstGroupChild = edit.overlays.find(overlay => overlay.id === "g1.first");
  assert.ok(Math.abs(firstGroupChild.transform.x - 90) < 1e-9);
  assert.ok(Math.abs(firstGroupChild.transform.y - 70) < 1e-9);
  assert.equal(firstGroupChild.transform.scale, 1);
  assert.equal(firstGroupChild.transform.rotate, 75);
  assert.equal(firstGroupChild.opacity, 0.4);
  assert.equal(firstGroupChild.blend, "screen");

  const plain = edit.overlays.find(overlay => overlay.id === "plain");
  assert.equal(plain.html, "overlays/plain.html", "unlabeled overlay reference stays byte-identical");
});

test("overlay sheet escapes clone ids containing # and keeps exactly three masks", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const { edit } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp", "sheet"));
  const overlays = await Promise.all(edit.overlays.map(async overlay => ({
    ...overlay,
    html: overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : await readFile(join(fixtureRoot, overlay.html), "utf8"),
  })));
  const sheet = renderOverlaySheet({ overlays, edit, projectRoot: fixtureRoot, duration: 4 });

  assert.match(sheet, /data-overlay-id="s01#A"/u);
  assert.equal((sheet.match(/<div data-akari-part-mask=/gu) ?? []).length, 3);
  assert.equal((sheet.match(/visibility:hidden !important/gu) ?? []).length, 3);
});

test("GPU page builder receives the same six records and projected transform variables", async () => {
  const result = await loadAndBuildGpuPage({
    projectRoot: fixtureRoot,
    editPath: join(fixtureRoot, "edit.json"),
    fps: 30,
    width: 640,
    height: 360,
    duration: 4,
  });

  assert.equal(result.eligibility.eligible, true);
  assert.equal(result.spriteManifest.statics.length, 6);
  assert.equal(result.spriteManifest.statics.filter(sprite =>
    sprite.html.includes("data-akari-part-mask")).length, 3);
  assert.equal(result.spriteManifest.statics.find(sprite => sprite.id === "s01.B").vars["--y"], "-40px");
  assert.deepEqual(
    Object.fromEntries(["--x", "--y"].map(name => [name,
      result.spriteManifest.statics.find(sprite => sprite.id === "g1.first").vars[name]])),
    { "--x": "90px", "--y": "70px" },
  );
});
