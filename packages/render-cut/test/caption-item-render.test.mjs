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
import { assertGpuEligibility, renderProject, resolveEngineChoice } from "../src/render-cut.mjs";
import { evaluateGpuEligibility } from '../../gpu-export/src/eligibility.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { collectExcludedCaptionIds } = require('../../edit-store/lib/index.js');

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

test("group photo and caption inherit a clipped time, composed transform, and opacity", async () => {
  const root = resolve(here, "../../../evidence/c0a-group-media-render/fixture");
  const raw = JSON.parse(await readFile(join(root, "edit.json"), "utf8"));
  const rendered = readRenderEdit(raw, join(root, ".akari", "render-tmp"), { projectRoot: root });
  const photo = rendered.edit.layers.find(layer => layer.id === "photo");
  assert.equal(photo.t, 1);
  assert.equal(photo.duration, 2);
  assert.equal(photo.opacity, 0.5);
  assert.equal(photo.transform.rotate, 18);
  assert.ok(photo.transform.scale < 0.5);
  const caption = rendered.edit.overlays.filter(overlay => overlay.id === "caption-line");
  assert.equal(caption.length, 1);
  assert.equal(rendered.edit.overlays.filter(overlay => overlay.captionId === 'c-0001').length, 1);
  assert.deepEqual([...collectExcludedCaptionIds(rendered.edit)], ['c-0001']);
  assert.equal(caption[0].start, 1.4);
  assert.ok(Math.abs(caption[0].duration - 1.2) < 1e-9);
  assert.equal(caption[0].opacity, 0.5);
  assert.equal(caption[0].keyframes, undefined);
  assert.equal(caption[0].transform.rotate, 18);
  const directRoot = resolve(here, "../../../evidence/c0a-group-media-render/fixture-caption-direct");
  const direct = readRenderEdit(await readFile(join(directRoot, "edit.json"), "utf8"),
    join(directRoot, ".akari", "render-tmp"), { projectRoot: directRoot });
  const directCaption = direct.edit.overlays.find(overlay => overlay.id === "caption-line");
  assert.equal(caption[0].html, directCaption.html, "group keeps the direct caption HTML byte-identical");
  assert.match(caption[0].html, /@font-face/u);
  assert.match(caption[0].html, /file:/u);
  assert.match(caption[0].html, /animation:\s*akari-caption-fade/u);
  const groupedEligibility = evaluateGpuEligibility({ edit: rendered.edit });
  const directEligibility = evaluateGpuEligibility({ edit: direct.edit });
  const groupedEntry = groupedEligibility.entries.find(entry => entry.id === "caption-line");
  const directEntry = directEligibility.entries.find(entry => entry.id === "caption-line");
  assert.deepEqual(groupedEntry, directEntry);
  assert.equal(groupedEntry.classification, "degraded");
  assert.ok(groupedEntry.conditions.includes("font-face-external-resource"));
  assert.equal(resolveEngineChoice("auto", process.platform, groupedEligibility), "osr");
  assert.equal(resolveEngineChoice("auto", process.platform, directEligibility), "osr");
  assert.throws(() => assertGpuEligibility("gpu", groupedEligibility), /GPU export is ineligible/u);
  assert.throws(() => assertGpuEligibility("gpu", directEligibility), /GPU export is ineligible/u);
});

test("render compatibility layers insert grouped media between direct siblings", async () => {
  const root = resolve(here, "../../../evidence/c0a-group-media-render/fixture-order");
  const raw = JSON.parse(await readFile(join(root, "edit.json"), "utf8"));
  const rendered = readRenderEdit(raw, join(root, ".akari", "render-tmp"), { projectRoot: root });
  assert.deepEqual(rendered.edit.layers.map(item => item.id), ['A', 'B', 'C', 'D', 'E']);
});

test("a captions bag inside a group is projected at the parent position once", async () => {
  const root = resolve(here, "../../../evidence/c0a-group-media-render/fixture");
  const raw = JSON.parse(await readFile(join(root, "edit.json"), "utf8"));
  const group = raw.tracks[1].items[0];
  group.items[1] = { id: 'inner-bag', at: 0, duration: 60,
    source: { kind: 'captions', path: 'captions.json', exclude: [] }, items: [] };
  raw.tracks.pop();
  const rendered = readRenderEdit(raw, join(root, ".akari", "render-tmp"), { projectRoot: root });
  const caption = rendered.edit.overlays.filter(overlay => overlay.id === 'inner-bag::c-0001');
  assert.equal(caption.length, 1);
  assert.equal(caption[0].start, 2.4);
  assert.ok(Math.abs(caption[0].duration - 0.6) < 1e-9);
  assert.equal(caption[0].opacity, 0.5);
  assert.equal(caption[0].transform.rotate, 18);
  assert.equal(caption[0].parentId, 'inner-bag');
  assert.deepEqual([...collectExcludedCaptionIds(rendered.edit)], ['c-0001']);
});

test("group caption clips to the parent and multiplies its appearance", async () => {
  const root = resolve(here, "../../../evidence/c0a-group-media-render/fixture");
  const raw = JSON.parse(await readFile(join(root, "edit.json"), "utf8"));
  const group = raw.tracks[1].items[0];
  group.duration = 30;
  group.items[1].opacity = 0.8;
  const rendered = readRenderEdit(raw, join(root, ".akari", "render-tmp"), { projectRoot: root });
  const rows = rendered.edit.overlays.filter(overlay => overlay.id === 'caption-line');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, 1.4);
  assert.ok(Math.abs(rows[0].duration - 0.6) < 1e-9);
  assert.equal(rows[0].opacity, 0.4);
  assert.ok(Math.abs(rows[0].transform.x - 115.06457847577869) < 1e-9);
  assert.equal(rows[0].transform.rotate, 18);
  const sourceRow = JSON.parse(await readFile(join(root, 'captions.json'), 'utf8')).captions[0];
  const directHtml = generateCaptionOverlays([{
    ...sourceRow, start: 1.4, end: 2, time_domain: 'output', src: undefined
  }], [{ in: 0, out: 2, at: 0, src: '__caption_item_clock__' }], {
    output: { width: 640, height: 360 }
  })[0].html;
  assert.equal(rows[0].html, directHtml);
  const activeAt = second => rows.filter(row => row.start <= second && second < row.start + row.duration);
  assert.equal(activeAt(0.5).length, 0);
  assert.equal(activeAt(1.7).length, 1);
  assert.equal(activeAt(2.1).length, 0);
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

test("v2 plan-only receipts include captions.json for an inline detached caption", { timeout: 60_000 }, async t => {
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
      engine: "osr",
      writeState: false,
    });
    assert.match(state.inputs["captions.json"]?.sha256 ?? "", /^[a-f0-9]{64}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
