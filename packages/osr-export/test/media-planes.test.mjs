import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { buildOsrPage, loadAndBuildOsrPage } from "../src/page-builder.mjs";

const require = createRequire(import.meta.url);
const { partitionPreviewMediaPlanes } = require("../../edit-store/lib/index.js");
const runtimeSource = readFileSync(new URL("../src/page-runtime.js", import.meta.url), "utf8");

const output = { width: 320, height: 180, fps: 30 };
const edit = (cuts, layers = []) => ({ output, sources: [{ id: "main", path: "main.mp4" }], cuts, layers, overlays: [] });
const cut = (id, track) => ({ id, src: "main", in: 0, out: 2, at: 0, track });
const overlay = (id, z, blend = "normal") => ({ id, z, blend, start: 0, duration: 2, html: `<div>${id}</div>` });
const page = (input, overlays, extra = {}) => buildOsrPage({
  edit: input, overlays, projectRoot: "/unused", duration: 2,
  frameEngineBundle: "", pageRuntime: "", ...extra,
});
const tags = html => [...html.matchAll(/<(canvas|iframe)\b/gu)].map(match => match[1]);
const frames = html => [...html.matchAll(/<iframe\b[\s\S]*?<\/iframe>/gu)].map(match => match[0]);

test("barrier partitions multiple base cuts independently and keeps an upper cut transparent", () => {
  const visual = { transform: {}, opacity: 1 };
  const summary = {
    timelineTracks: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
    cutsById: {
      main: { id: "main", trackId: "v1", renderTrack: 0 },
      photo: { id: "photo", trackId: "v3", renderTrack: 2 },
    },
    overlays: [{ id: "shape", trackId: "v2" }],
  };
  const bands = partitionPreviewMediaPlanes({
    base: [{ id: "main", visual }, { id: "photo", visual }], layers: [],
  }, summary);
  assert.deepEqual(bands.map(band => band.key), [0, 1]);
  assert.deepEqual(bands[0].baseIndices, [0]);
  assert.equal(bands[1].entries[0].baseIndex, 1);
  assert.equal(bands[1].entries[0].spec.blend, "normal");
  assert.equal(bands[1].entries[0].spec.visual.transform, visual.transform);
});

test("caption bag, caption item, blend overlay and grouped-caption itemStackZ are barriers", () => {
  const summary = {
    timelineTracks: [{ id: "v1" }, { id: "v2" }, { id: "v3" }, { id: "v4" }],
    trackStackZ: { v1: 0, v2: 2, v3: 5, v4: 7 },
    itemStackZ: { main: 1, bag: 3, shape: 4, photo: 6, placed: 8 },
    cutsById: { main: { id: "main", trackId: "v1" }, photo: { id: "photo", trackId: "v3" } },
    layers: [{ id: "extra", trackId: "v3", renderTrack: 2 }],
    overlays: [{ id: "shape", trackId: "v2", blend: "multiply" }, { id: "placed", trackId: "v4" }],
    captionTrackId: "v2",
  };
  const bands = partitionPreviewMediaPlanes({
    base: [], layers: [{ id: "main" }, { id: "photo" }, { id: "extra" }],
  }, summary);
  assert.deepEqual(bands.map(band => band.key), [0, 4]);
  assert.deepEqual(bands[1].entries.map(entry => entry.spec.id), ["photo", "extra"]);
  assert.equal(bands[1].zIndex, 6);
});

test("one band retains the original canvas and overlay sheet structure, including blend frames", () => {
  const input = edit([{ id: "main", src: "main", in: 0, out: 2, track: 0 }, cut("photo", 1)]);
  const normal = page(input, [overlay("top", 2)]).html;
  const digest = value => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(normal), "03faaac54a97e3984c61823c84990728b5d55d95fe18da9d07a4ea503c227fff");
  assert.equal(tags(normal).length, 2);
  assert.match(normal, /<canvas id="akari-engine"/u);
  assert.match(normal, /<iframe id="akari-overlays" src="\/overlay-sheet.html"/u);
  assert.doesNotMatch(normal, /akari-media-plane|__akariPartitionMediaPlanes/u);

  const blended = page(input, [overlay("top", 2, "multiply")]).html;
  assert.equal(digest(blended), "e4902e358fe67a98c03004ffda7d6a7c114ebf615f13c4f43ee3de0ed868b626");
  assert.equal(tags(blended).length, 3);
  assert.match(blended, /id="akari-overlays"[^>]*display:none/u);
  assert.match(blended, /mix-blend-mode:multiply/u);
});

test("media canvases interleave with shape, caption item and blend at track z", () => {
  const input = edit([cut("main", 0), cut("photo", 2), cut("front", 4)]);
  const html = page(input, [overlay("shape", 1, "multiply"), overlay("placed", 3)]).html;
  const elements = tags(html);
  assert.deepEqual(elements.map(value => value === "canvas" ? "canvas" : "overlay"),
    ["canvas", "overlay", "canvas", "overlay", "canvas"]);
  assert.match(html, /mix-blend-mode:multiply;z-index:3/u);
  assert.match(html, /data-akari-media-plane="1"[^>]*z-index:4/u);
  assert.match(html, /z-index:7/u);
  assert.match(html, /data-akari-media-plane="2"[^>]*z-index:8/u);
  assert.match(html, /__akariPartitionMediaPlanes/u);
});

test("multi-band page groups normal overlays at one barrier and separates different barriers", () => {
  const input = edit([cut("main", 0), cut("photo", 2)]);
  const html = page(input, [overlay("shape", 1), overlay("cue-a", 3), overlay("cue-b", 3), overlay("cue-c", 3)]).html;
  const sheets = frames(html);
  assert.equal(sheets.length, 2);
  assert.match(sheets[0], /data-overlay-id=&quot;shape&quot;/u);
  assert.deepEqual([...sheets[1].matchAll(/data-overlay-id=&quot;([^&]+)&quot;/gu)].map(match => match[1]),
    ["cue-a", "cue-b", "cue-c"]);
  assert.deepEqual(tags(html), ["canvas", "iframe", "canvas", "iframe"]);
});

test("200 caption cues above an interleaved photo still use one caption iframe", () => {
  const input = edit([cut("main", 0), cut("photo", 2)]);
  const cues = Array.from({ length: 200 }, (_, index) => overlay(`cue-${index}`, 3));
  const html = page(input, [overlay("shape", 1), ...cues]).html;
  assert.equal(frames(html).length, 2);
  assert.equal((frames(html)[1].match(/data-overlay-id=&quot;cue-/gu) ?? []).length, 200);
});

test("blend frames split only continuous normal runs while preserving z then declaration order", () => {
  const input = edit([cut("main", 0), cut("photo", 2)]);
  const html = page(input, [
    overlay("late", 3), overlay("a", 1), overlay("b", 1), overlay("blend", 1, "multiply"),
    overlay("c", 1), overlay("d", 1), overlay("last", 3),
  ]).html;
  const sheets = frames(html);
  assert.equal(sheets.length, 4);
  assert.deepEqual(sheets.map(sheet => [...sheet.matchAll(/data-overlay-id=&quot;([^&]+)&quot;/gu)].map(match => match[1])), [
    ["a", "b"], ["blend"], ["c", "d"], ["late", "last"],
  ]);
  assert.match(sheets[1], /data-blend="multiply"/u);
  assert.ok(sheets.filter(sheet => sheet.includes('data-blend="normal"')).length === 3);
});

test("caption bag is below a higher photo and caption item follows its own track", () => {
  const captions = [{ id: "speech", start: 0, end: 2, text: "spoken" }];
  const input = edit([cut("main", 0), cut("photo", 2)]);
  const html = page(input, [overlay("placed", 1)], { captions, captionTrackZ: 1 }).html;
  const elements = tags(html);
  assert.equal(elements[0], "canvas");
  assert.ok(elements.slice(1, -1).every(value => value === "iframe"));
  assert.equal(elements.at(-1), "canvas");
  assert.match(html, /data-akari-media-plane="1"/u);
});

test("grouped caption item uses itemStackZ in the emitted page", () => {
  const internal = { output: { fps: 30 }, tracks: [
    { id: "v1", items: [{ id: "main", source: { kind: "media" } }] },
    { id: "v2", items: [{ id: "group", source: { kind: "group" }, children: [
      { id: "placed", source: { kind: "caption" } },
    ] }] },
    { id: "v3", items: [{ id: "photo", source: { kind: "media" } }] },
  ] };
  const html = page(edit([cut("main", 0), cut("photo", 1)]), [overlay("placed", 1)], { internal }).html;
  assert.deepEqual(tags(html), ["canvas", "iframe", "canvas"]);
  assert.match(html, /"itemStackZ":\{"main":1,"group":3,"placed":4,"photo":6\}/u);
  assert.match(html, /"barrierZ":\[4\]/u);
  assert.match(html, /"photo":\{"id":"photo","trackId":"v3","renderTrack":2\}/u);
});

test("v2 track order survives the compatibility projection's compressed media track numbers", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-media-plane-v2-"));
  try {
    await writeFile(join(root, "shape.html"), "<div>shape</div>");
    await writeFile(join(root, "edit.json"), JSON.stringify({
      version: 2, output, sources: [{ id: "main", path: "main.mp4" }],
      tracks: [
        { id: "v1", lane: "visual", items: [{ id: "main", at: 0, duration: 60,
          source: { kind: "media", src: "main", in: 0, out: 2 } }] },
        { id: "v2", lane: "visual", items: [{ id: "shape", at: 0, duration: 60,
          source: { kind: "html", path: "shape.html" } }] },
        { id: "v3", lane: "visual", items: [{ id: "photo", at: 0, duration: 60,
          source: { kind: "media", src: "main", in: 0, out: 2 } }] },
      ],
    }));
    const result = await loadAndBuildOsrPage({ projectRoot: root, duration: 2 });
    assert.deepEqual(result.edit.cuts.map(value => value.track), [0, 1]);
    assert.deepEqual(tags(result.html), ["canvas", "iframe", "canvas"]);
    assert.match(result.html, /data-akari-media-plane="1"/u);
    assert.match(result.html, /"photo":\{"id":"photo","trackId":"v3","renderTrack":2\}/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime composes bands and seeks grouped caption animators in one iframe", async () => {
  const calls = [];
  const animatorCalls = [];
  const frameSeeks = [];
  const baseCanvas = { id: "base" };
  const upperCanvas = { id: "upper", dataset: { akariMediaPlane: "1" }, style: {} };
  const roots = ["cue-a", "cue-b"].map(id => ({ getAttribute: name => name === "data-overlay-id" ? id : null }));
  const overlayFrame = {
    contentDocument: { readyState: "complete", querySelectorAll: () => roots },
    contentWindow: { __akariReady: Promise.resolve(), __akariSeek: async seconds => {
      frameSeeks.push(seconds);
      return { warnings: [] };
    } },
  };
  const summary = {
    timelineTracks: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
    cutsById: { main: { id: "main", trackId: "v1" }, photo: { id: "photo", trackId: "v3" } },
    barrierZ: [1],
  };
  const FE = {
    WebGL2Compositor: class {
      constructor(canvas, options) { this.canvas = canvas; this.options = options; this.uploadPath = "direct"; }
      async compose(base, layers) {
        calls.push({ canvas: this.canvas.id, transparent: this.options.transparent === true, base: base.length, layers: layers.length });
        return { close() {} };
      }
      dispose() {}
    },
    FrameMetrics: class {},
    StreamReaper: class { reap() { return { liveStreams: 0 }; } released() { return 0; } },
    buildResolvedTimelinePlan: () => ({ totalDuration: 2 }),
    evaluationPlanFromResolvedTimeline: () => ({
      base: ["main", "photo"].map(id => ({ id, visual: { transform: {}, opacity: 1 } })),
      layers: [], output: {},
    }),
    async evaluateFrame(plan, { compositor }) {
      const surface = await compositor.compose([{}, {}], [], {}, {}, plan);
      return { close() { surface.close(); } };
    },
    applyCaptionAnimatorDom(root, declaration) {
      animatorCalls.push([root.getAttribute("data-overlay-id"), declaration.cueLocalSeconds]);
    },
  };
  const stamp = { style: {} };
  const window = {
    __AKARI_OSR_CONFIG__: { edit: { cuts: [], layers: [], sources: [] }, fps: 30,
      width: 320, height: 180, adjustLutCubeTexts: {}, mediaPlaneSummary: summary,
      captionAnimators: {
        "cue-a": { animator: [], start: 0, duration: 2 },
        "cue-b": { animator: [], start: 0, duration: 2 },
      } },
    AkariFrameEngine: FE,
    __akariPartitionMediaPlanes: partitionPreviewMediaPlanes,
    __akariEncodeStamp: frame => ({ css: String(frame) }),
    addEventListener() {},
  };
  vm.runInNewContext(runtimeSource, {
    window,
    document: {
      fonts: { ready: Promise.resolve() },
      getElementById: id => ({ "akari-engine": baseCanvas, "akari-stamp": stamp })[id] ?? null,
      querySelectorAll: selector => selector === ".akari-media-plane" ? [upperCanvas] : [overlayFrame],
    },
    requestAnimationFrame: callback => callback(),
    console,
  });
  await window.__akariReady;
  assert.deepEqual(frameSeeks, [0]);
  assert.deepEqual(animatorCalls, [["cue-a", 0], ["cue-b", 0]]);
  assert.deepEqual(calls, [
    { canvas: "base", transparent: false, base: 1, layers: 0 },
    { canvas: "upper", transparent: true, base: 0, layers: 1 },
    { canvas: "base", transparent: false, base: 1, layers: 0 },
    { canvas: "upper", transparent: true, base: 0, layers: 1 },
  ]);
  await window.__akariSeek(1, 30);
  assert.equal(calls.length, 6);
  assert.deepEqual(frameSeeks, [0, 1]);
  assert.deepEqual(animatorCalls.slice(2), [["cue-a", 1], ["cue-b", 1]]);
  assert.equal(stamp.style.backgroundColor, "30");
});
