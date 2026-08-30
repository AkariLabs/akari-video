import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../src/captions.mjs";
import {
  readRenderEdit,
  renderItemDeclaration,
  renderItemKind,
} from "../src/internal-render.mjs";
import { renderProject } from "../src/render-cut.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "caption-item-render");
const sourceVideo = resolve(here, "../../../test-project/source.mp4");

async function fixture() {
  return {
    edit: JSON.parse(await readFile(join(fixtureRoot, "edit.json"), "utf8")),
    captions: JSON.parse(await readFile(join(fixtureRoot, "captions.json"), "utf8")),
  };
}

function project(edit, options = {}) {
  return readRenderEdit(edit, join(fixtureRoot, ".akari", "render-tmp"), {
    projectRoot: fixtureRoot,
    ...options,
  });
}

test("caption item is dispatched and declared with its frame-derived output window", async () => {
  const { edit } = await fixture();
  const rendered = project(edit);
  const item = rendered.internal.tracks.flatMap(track => track.items)
    .find(candidate => candidate.id === "c2-out");

  assert.equal(renderItemKind(item), "caption");
  const declaration = renderItemDeclaration(item);
  assert.equal(declaration.id, "c2-out");
  assert.equal(declaration.start, 61 / 30);
  assert.equal(declaration.duration, 1);
  assert.equal(declaration.transform.y, -200);
  assert.equal(declaration.captionId, "c2");

  const overlay = rendered.edit.overlays.find(candidate => candidate.id === "c2-out");
  assert.equal(Object.is(overlay.start, 61 / 30), true);
  assert.equal(Object.is(overlay.duration, 30 / 30), true);
  assert.equal(overlay.transform.y, -200);
  assert.equal(overlay.opacity, 0.8);
  assert.equal(overlay.vars["--caption-color"], "#ffcc00");
  assert.equal(overlay.vars["--caption-font-size"], "46px");
  assert.equal(overlay.htmlPath, "captions.json");
  assert.equal(overlay.captionId, "c2");
});

test("detached caption HTML and vars are byte-identical to the shared caption generator", async () => {
  const { edit, captions } = await fixture();
  const rendered = project(edit);
  const detached = rendered.edit.overlays.find(overlay => overlay.id === "c2-out");
  const row = captions.captions.find(caption => caption.id === "c2");
  const direct = generateCaptionOverlays([row], rendered.edit.cuts, {
    output: { width: 640, height: 360 },
    sourceCount: 1,
    defaultTextStyle: captions.default_text_style,
    emphasisWords: captions.emphasis_words,
  })[0];

  assert.equal(detached.html, direct.html);
  assert.equal(JSON.stringify(detached.vars), JSON.stringify(direct.vars));
});

test("missing and hidden caption items are skipped without throwing", async () => {
  const { edit } = await fixture();
  const missing = structuredClone(edit);
  missing.tracks[2].items[0].source.id = "missing-row";
  const warnings = [];
  const missingProjection = project(missing, { onWarning: warning => warnings.push(warning) });
  assert.equal(missingProjection.edit.overlays.some(overlay => overlay.id === "c2-out"), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /missing-row/u);

  const hidden = structuredClone(edit);
  hidden.tracks[2].items[0].hidden = true;
  const hiddenProjection = project(hidden);
  assert.equal(hiddenProjection.edit.overlays.some(overlay => overlay.id === "c2-out"), false);
});

test("a missing captions.json warns once and skips every caption item", async () => {
  const { edit } = await fixture();
  const root = await mkdtemp(join(tmpdir(), "akari-caption-item-missing-root-"));
  try {
    const warnings = [];
    const rendered = readRenderEdit(edit, join(root, ".akari", "render-tmp"), {
      projectRoot: root,
      onWarning: warning => warnings.push(warning),
    });
    assert.equal(rendered.edit.overlays.some(overlay => overlay.id === "c2-out"), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /captions\.json was not found/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caption item keeps tree z-order and is projected when bag expansion is disabled", async () => {
  const { edit } = await fixture();
  const expanded = project(edit).edit.overlays.map(overlay => overlay.id);
  assert.ok(expanded.indexOf("c2-out") < expanded.indexOf("order-html"));

  const unexpanded = project(edit, { expandParts: false }).edit.overlays;
  const caption = unexpanded.find(overlay => overlay.id === "c2-out");
  assert.equal(caption.start, 61 / 30);
  assert.equal(caption.transform.y, -200);
  assert.ok(unexpanded.indexOf(caption) < unexpanded.findIndex(overlay => overlay.id === "order-html"));
});

test("legacy plan-only receipts include captions.json for an inline detached caption", { timeout: 60_000 }, async t => {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
    return t.skip("ffmpeg is unavailable");
  }
  const root = await mkdtemp(join(tmpdir(), "akari-caption-item-plan-"));
  try {
    await cp(fixtureRoot, root, { recursive: true });
    await mkdir(join(root, "assets"), { recursive: true });
    await cp(sourceVideo, join(root, "assets", "source.mp4"));
    const state = await renderProject(root, {
      planOnly: true,
      force: true,
      engine: "legacy",
      writeState: false,
    });
    assert.match(state.inputs["captions.json"]?.sha256 ?? "", /^[a-f0-9]{64}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
