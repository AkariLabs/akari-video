import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readRenderEdit } from "../src/internal-render.mjs";
import { renderProject, selectTrackStackStageOverlays } from "../src/render-cut.mjs";
import { renderOverlaySheet } from "../src/rasterize.mjs";
import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs } from "../src/render-inputs.mjs";
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

test("render-cut front-door expands bags by default while receipts stay bound to source HTML", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const { edit, internal } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp"));
  assert.deepEqual(edit.overlays.map(overlay => overlay.id), [
    "s01#A", "s01.B", "g1.first", "g1.second", "plain", "s01.C",
  ]);
  assert.equal(edit.overlays.filter(overlay => overlay.html.includes("data-akari-part-mask")).length, 3);
  assert.ok(edit.overlays.filter(overlay => overlay.html.trimStart().startsWith("<"))
    .every(overlay => /^overlays\/(?:card|plain)\.html$/u.test(overlay.htmlPath)));
  const inputs = await enumerateDeclaredRenderInputs({
    projectRoot: fixtureRoot,
    edit,
    editText: source,
    internalEdit: internal,
  });
  assert.equal(inputs.filter(input => input.role.startsWith("overlay:")).length, 6);
  const hashed = await hashDeclaredRenderInputs(inputs, { useConsumedText: true });
  const cardText = await readFile(join(fixtureRoot, "overlays", "card.html"), "utf8");
  assert.equal(
    hashed.find(input => input.role === "overlay:s01#A").sha256,
    createHash("sha256").update(cardText).digest("hex"),
  );

  const forcedUnexpanded = readRenderEdit(
    source,
    join(fixtureRoot, ".akari", "render-tmp", "osr-page"),
    { expandParts: false },
  ).edit;
  assert.equal(forcedUnexpanded.overlays[0].id, "s01", "explicit false is the only non-expanded mode");
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

test("non-default track-stack stage selects every expanded clone by its bag parentId", async () => {
  const source = await readFile(join(fixtureRoot, "edit.json"), "utf8");
  const overlays = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp")).edit.overlays;
  const selected = selectTrackStackStageOverlays(
    { kind: "overlays", overlayIds: ["s01"] }, overlays, [],
  );
  assert.deepEqual(selected.map(overlay => overlay.id), ["s01#A", "s01.B"]);
  assert.ok(selected.every(overlay => overlay.html.includes("data-akari-part-mask")));
});

test("legacy plan-only path carries the same three masked overlays", { timeout: 60_000 }, async t => {
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.status !== 0) return t.skip("ffmpeg is unavailable");
  const root = await mkdtemp(join(tmpdir(), "akari-render-bag-plan-"));
  try {
    await cp(fixtureRoot, root, { recursive: true });
    const media = join(root, "source.mp4");
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", media,
    ]);
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const editPath = join(root, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.sources = [{ id: "main", path: "source.mp4" }];
    edit.tracks.unshift({ id: "base", lane: "visual", items: [
      { id: "cut", at: 0, duration: 120, source: { kind: "media", src: "main", in: 0, out: 4 } },
    ] });
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
    const state = await renderProject(root, {
      planOnly: true, force: true, engine: "legacy", writeState: false,
    });
    assert.equal(state.plan.commands.rasterize['static-screenshot'].outputs.length, 6);
    assert.equal(state.inputs["overlays/card.html"].sha256,
      createHash("sha256").update(await readFile(join(root, "overlays", "card.html"))).digest("hex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
