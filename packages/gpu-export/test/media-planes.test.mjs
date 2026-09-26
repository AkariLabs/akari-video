import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

import { buildGpuPage } from "../src/page-builder.mjs";
import { buildMediaPlaneSummary } from "../src/media-plane-summary.mjs";
import { evaluateGpuEligibility } from "../src/eligibility.mjs";
import { GPU_BLEND_MODES, evaluateGpuBlendChannel, gpuBlendGlsl } from "../src/blend-modes.mjs";

const require = createRequire(import.meta.url);
const { partitionPreviewMediaPlanes } = require("../../edit-store/lib/index.js");
const runtimeSource = readFileSync(new URL("../src/page-runtime.js", import.meta.url), "utf8");
const output = { width: 320, height: 180, fps: 30 };
const cut = (id, track) => ({ id, src: "main", in: 0, out: 2, at: 0, track });
const overlay = (id, z, blend = "normal") => ({ id, z, blend, start: 0, duration: 2, html: `<div>${id}</div>` });
const edit = (cuts, overlays = []) => ({ output, sources: [{ id: "main", path: "main.mp4" }], cuts, layers: [], overlays });
const internal = { tracks: ["v1", "v2", "v3", "v4"].map(id => ({ id, items: [] })) };
const page = (input, overlays = [], extra = {}) => buildGpuPage({
  edit: input, overlays, internal, projectRoot: "/unused", duration: 2,
  frameEngineBundle: "", pageRuntime: "", ...extra,
});
const config = html => JSON.parse(html.match(/window\.__AKARI_GPU_CONFIG__=(.*?);(?:window\.__akariPartitionMediaPlanes|<\/script>)/su)[1]);

function runtimeInternals() {
  const window = { __AKARI_GPU_CONFIG__: {}, AkariFrameEngine: null, akariGpu: null };
  class FakeMessageChannel {
    constructor() { this.port1 = {}; this.port2 = { postMessage() {} }; }
  }
  vm.runInNewContext(runtimeSource, { window, MessageChannel: FakeMessageChannel, console });
  return window.__akariGpuMediaPlaneInternals;
}

test("one media band keeps the original GPU page and compositor route", () => {
  const input = edit([cut("main", 0), cut("photo", 1)]);
  const built = page(input, [overlay("top", 3)]);
  assert.equal(config(built.html).mediaPlanes, undefined);
  assert.doesNotMatch(built.html, /akari-media-plane|__akariPartitionMediaPlanes/u);
  assert.match(runtimeSource, /if \(config\.mediaPlanes\) \{\s*composeMediaPlanes[\s\S]*?\} else \{\s*spriteCompositor\.compose\(frame\.surface\.canvas, orderedDraws\)/u);
});

test("shared partition puts a caption bag and HTML sprite between video and photo", () => {
  const input = edit([cut("main", 0), cut("photo", 2)]);
  const overlays = [overlay("shape", 1)];
  const summary = buildMediaPlaneSummary(input, internal, overlays, 1);
  const bands = partitionPreviewMediaPlanes({ base: [], layers: summary.layers.map(layer => ({ id: layer.id })) }, summary);
  assert.deepEqual(bands.map(band => band.key), [0, 1]);
  assert.deepEqual(bands[1].entries.map(entry => entry.spec.id), ["photo"]);
  const built = page(input, overlays);
  const planes = config(built.html).mediaPlanes;
  assert.deepEqual(planes.bands.map(band => band.key), [0, 1]);
  assert.equal(planes.spriteZ.shape, 1);
  assert.match(built.html, /data-akari-media-plane="1"/u);
  assert.match(built.html, /__akariPartitionMediaPlanes/u);
});

test("caption sprite below a photo creates an upper media band", () => {
  const input = edit([cut("main", 0), cut("photo", 2)]);
  const built = page(input, [], {
    captions: [{ id: "cue", src: "main", start: 0, end: 2, text: "caption" }],
    captionTrackZ: 1,
  });
  const planes = config(built.html).mediaPlanes;
  assert.deepEqual(planes.bands.map(band => band.key), [0, 1]);
  assert.equal(planes.spriteZ[built.spriteManifest.captions[0].id], 1);
});

test("group caption item uses the same expanded stack position as OSR", () => {
  const grouped = { tracks: [
    { id: "v1", items: [{ id: "main" }] },
    { id: "v2", items: [{ id: "bag", source: { kind: "group" }, items: [{ id: "cue", source: { kind: "caption" } }] }] },
    { id: "v3", items: [{ id: "photo" }] },
  ] };
  const summary = buildMediaPlaneSummary(edit([cut("main", 0), cut("photo", 2)]), grouped,
    [{ ...overlay("cue", 1), parentId: "bag" }], 1);
  assert.equal(summary.barrierZ[0], summary.itemStackZ.cue);
  assert.ok(summary.itemStackZ.main < summary.barrierZ[0]);
  assert.ok(summary.barrierZ[0] < summary.itemStackZ.photo);
});

test("all schema blend modes stay GPU eligible; unknown modes warn and use normal composition", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/edit.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(GPU_BLEND_MODES, schema.$defs.layerBlendMode.enum);
  for (const mode of GPU_BLEND_MODES) {
    const input = edit([cut("main", 0)], [overlay("tint", 2, mode)]);
    const result = evaluateGpuEligibility({ edit: input });
    assert.equal(result.eligible, true, mode);
    assert.equal(result.entries[0].classification, "same", mode);
    if (mode !== "normal") {
      const built = page(input, input.overlays);
      assert.equal(config(built.html).mediaPlanes.spriteBlend.tint, mode);
    }
  }
  for (const mode of ["unknown", "color-dodge"]) {
    const input = edit([cut("main", 0)], [overlay("tint", 2, mode)]);
    const result = evaluateGpuEligibility({ edit: input });
    assert.equal(result.eligible, true);
    assert.equal(result.entries[0].reason, "static-html-sprite");
    const built = page(input, input.overlays);
    assert.deepEqual(built.warnings, [
      `HTML overlay tint blend ${mode} is unsupported; using normal composition`,
    ]);
    assert.equal(config(built.html).mediaPlanes, undefined);
    assert.doesNotMatch(built.html, /akari-media-plane|__akariPartitionMediaPlanes/u);
  }
  const between = edit([cut("main", 0), cut("photo", 2)], [overlay("tint", 1, "unknown")]);
  const middle = page(between, between.overlays);
  assert.equal(config(middle.html).mediaPlanes.spriteBlend.tint, undefined);
  assert.equal(config(middle.html).mediaPlanes.blendGlsl, undefined);
});

test("one expression table generates GLSL and evaluates every blend formula", () => {
  const expected = {
    normal: 0.45,
    screen: 0.475,
    multiply: 0.225,
    add: 0.55,
    difference: 0.35,
    darken: 0.25,
    lighten: 0.45,
    overlay: 0.3,
    hardlight: 0.4,
    softlight: 0.3,
  };
  const shader = gpuBlendGlsl();
  for (const [index, mode] of GPU_BLEND_MODES.entries()) {
    assert.match(shader, new RegExp(`if \\(mode == ${index}\\) return`, "u"), mode);
    assert.ok(Math.abs(evaluateGpuBlendChannel(mode, 0.25, 0.75, 0.4) - expected[mode]) < 1e-12, mode);
  }
  assert.ok(Math.abs(evaluateGpuBlendChannel("overlay", 0.8, 0.3, 0.5) - 0.76) < 1e-12);
  assert.ok(Math.abs(evaluateGpuBlendChannel("hardlight", 0.8, 0.3, 0.5) - 0.64) < 1e-12);
  assert.ok(Math.abs(evaluateGpuBlendChannel("softlight", 0.8, 0.3, 0.5) - 0.768) < 1e-12);
  assert.ok(Math.abs(evaluateGpuBlendChannel("softlight", 0.64, 0.75, 0.4) - 0.672) < 1e-12);
  assert.equal(evaluateGpuBlendChannel("add", 0.8, 0.75, 0.5), 1);
});

test("dynamic DOM runs split around multiply so it blends at its own stack position", () => {
  const animated = id => ({ ...overlay(id, 1), html: `<style>@keyframes fade{to{opacity:1}}</style><div style="animation:fade 1s">${id}</div>` });
  const overlays = [animated("before"), { ...animated("tint"), blend: "multiply" }, animated("after")];
  const built = page(edit([cut("main", 0), cut("photo", 2)], overlays), overlays);
  assert.deepEqual(built.spriteManifest.dom.map(run => run.entries.map(entry => entry.id)),
    [["before"], ["tint"], ["after"]]);
  const planes = config(built.html).mediaPlanes;
  assert.equal(planes.spriteBlend["dom-1"], "multiply");
  assert.equal(planes.spriteZ["dom-1"], 1);
});

test("GPU draw sequence sandwiches multiply between lower media and upper photo", () => {
  const { composeMediaPlanes } = runtimeInternals();
  const calls = [];
  const canvas = { id: "photo-canvas" };
  const compositor = {
    canvas: { id: "sprite-output" },
    updateSprite(id, source) { calls.push(["update", id, source.id]); },
    compose(base, draws) { calls.push(["compose", base.id, draws.map(draw => draw.id)]); },
  };
  const blender = {
    canvas: { id: "multiply-output" },
    blend(background, foreground, draw, mode) { calls.push(["blend", background.id, foreground.id, draw.id, mode]); },
  };
  const engine = { activeMediaBands: new Set([0, 1]), mediaPlanes: new Map([[1, { canvas }]]) };
  const config = { mediaPlanes: {
    bands: [{ key: 0, zIndex: 0 }, { key: 1, zIndex: 2 }],
    spriteZ: { tint: 1, caption: 3 }, spriteBlend: { tint: "multiply" },
  } };
  composeMediaPlanes(compositor, engine, { id: "base-video" }, [
    { id: "caption", z: 3, index: 1, opacity: 1 },
    { id: "tint", z: 1, index: 0, opacity: 1 },
  ], config, new Map([["tint", { id: "tint-canvas" }]]), blender);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["update", "__akari_media_plane_1", "photo-canvas"],
    ["compose", "base-video", []],
    ["blend", "sprite-output", "tint-canvas", "tint", "multiply"],
    ["compose", "multiply-output", ["__akari_media_plane_1", "caption"]],
  ]);
});

test("normal sprites and media planes preserve stack order in one compose", () => {
  const { composeMediaPlanes } = runtimeInternals();
  const calls = [];
  const compositor = {
    updateSprite(id) { calls.push(["update", id]); },
    compose(base, draws) { calls.push(["compose", base.id, draws.map(draw => draw.id)]); },
  };
  composeMediaPlanes(compositor, {
    activeMediaBands: new Set([0, 1]), mediaPlanes: new Map([[1, { canvas: {} }]]),
  }, { id: "main" }, [
    { id: "caption", z: 1, index: 1 }, { id: "behind", z: 1, index: 0 },
  ], { mediaPlanes: {
    bands: [{ key: 0, zIndex: 0 }, { key: 1, zIndex: 2 }],
    spriteZ: { behind: 1, caption: 3 }, spriteBlend: {},
  } }, new Map(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["update", "__akari_media_plane_1"],
    ["compose", "main", ["behind", "__akari_media_plane_1", "caption"]],
  ]);
});

test("geometry ::b sprite inherits its caption itemStackZ across a media band", () => {
  const { composeMediaPlanes } = runtimeInternals();
  const calls = [];
  const compositor = {
    updateSprite() {},
    compose(_base, draws) { calls.push(draws.map(draw => draw.id)); },
  };
  composeMediaPlanes(compositor, {
    activeMediaBands: new Set([0, 1]), mediaPlanes: new Map([[1, { canvas: {} }]]),
  }, {}, [
    { id: "cue", z: 1, index: 0 }, { id: "cue::b", z: 1, index: 0 },
  ], { mediaPlanes: {
    bands: [{ key: 0, zIndex: 0 }, { key: 1, zIndex: 5 }],
    spriteZ: { cue: 6 }, spriteBlend: {},
  } }, new Map(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),
    [["__akari_media_plane_1", "cue", "cue::b"]]);
});

test("secondary sprite resolves its owner's blend mode while retaining its own texture", () => {
  const { composeMediaPlanes } = runtimeInternals();
  const calls = [];
  const compositor = {
    canvas: {}, updateSprite() {},
    compose(_base, draws) { calls.push(["compose", draws.map(draw => draw.id)]); },
  };
  const blender = { canvas: {}, blend(_background, foreground, draw, mode) {
    calls.push(["blend", foreground.id, draw.id, mode]);
  } };
  composeMediaPlanes(compositor, {
    activeMediaBands: new Set([0]), mediaPlanes: new Map(),
  }, {}, [{ id: "tint::b", z: 1, index: 0 }], { mediaPlanes: {
    bands: [{ key: 0, zIndex: 0 }], spriteZ: { tint: 7 }, spriteBlend: { tint: "screen" },
  } }, new Map([["tint::b", { id: "second-texture" }]]), blender);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["compose", []], ["blend", "second-texture", "tint::b", "screen"], ["compose", []],
  ]);
});
