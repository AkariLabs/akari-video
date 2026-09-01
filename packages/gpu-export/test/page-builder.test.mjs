import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { extractCaptionMeasureDiffs, gpuRawFramePath, parseElectronArguments } from "../src/electron-main.mjs";
import { buildGpuPage, loadAndBuildGpuPage } from "../src/page-builder.mjs";

const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30, look: { lut: "warm", intensity: 0.7 } },
  sources: [{ id: "main", path: "assets/main.mp4" }],
  cuts: [{ id: "cut", src: "main", in: 0, out: 2 }],
  overlays: [],
};

function zAxisEdit(order) {
  const tracks = {
    low: { id: "low-track", lane: "visual", items: [{ id: "low", at: 0, duration: 30, source: { kind: "html", path: "low.html" } }] },
    captions: { id: "caption-track", lane: "visual", items: [{ id: "captions", at: 0, duration: 30, source: { kind: "captions", path: "captions.json", exclude: [] }, items: [] }] },
    high: { id: "high-track", lane: "visual", items: [{ id: "high", at: 0, duration: 30, source: { kind: "html", path: "high.html" } }] },
  };
  return {
    version: 2,
    output: { width: 64, height: 36, fps: 30 },
    sources: [],
    tracks: order.map((id) => tracks[id]),
  };
}

async function writeZAxisProject(projectRoot, order) {
  await Promise.all([
    writeFile(join(projectRoot, "edit.json"), JSON.stringify(zAxisEdit(order))),
    writeFile(join(projectRoot, "captions.json"), JSON.stringify([{ id: "c1", start: 0, end: 1, text: "caption" }])),
    writeFile(join(projectRoot, "low.html"), "<div>low</div>"),
    writeFile(join(projectRoot, "high.html"), "<div>high</div>"),
  ]);
}

function regionFilterEdit(lutId) {
  return {
    version:2, output:{width:64,height:36,fps:30},
    sources:[{id:'main',path:'assets/main.mp4'}],
    tracks:[
      { id:'v-main', lane:'visual', items:[{id:'cut',at:0,duration:30,source:{kind:'media',src:'main',in:0,out:1}}] },
      { id:'v-filter', lane:'visual', items:[{id:'region',at:0,duration:30,source:{kind:'filter',filter:{type:'lut',id:lutId,intensity:.5}}}] },
    ],
  };
}

test('GPU page builder resolves region-filter LUT cube text into page config', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'gpu-filter-lut-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(regionFilterEdit('mono')));
    const built = await loadAndBuildGpuPage({ projectRoot, duration:1 });
    assert.equal(built.edit.layers[0].filter.type, 'lut');
    assert.match(built.edit.layers[0].filter.cubeText, /LUT_3D_SIZE/u);
    assert.match(built.html, /filter layer LUT|cubeText/u);
  } finally { await rm(projectRoot, {recursive:true,force:true}); }
});

test('GPU page builder fails closed with the missing region-filter LUT id', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'gpu-filter-missing-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(regionFilterEdit('missing-region-lut')));
    await assert.rejects(() => loadAndBuildGpuPage({ projectRoot, duration:1 }), /missing-region-lut/u);
  } finally { await rm(projectRoot, {recursive:true,force:true}); }
});

test("GPU page omits the 3D sheet and exposes sprite/LUT declarations", () => {
  const overlays = [{ id: "static", start: 0, duration: 1, html: "<div>Static</div>", vars: {} }];
  const captions = [{ id: "c1", start: 0, end: 1, text: "Caption", time_domain: "output" }];
  const result = buildGpuPage({
    edit: { ...edit, overlays },
    overlays,
    captions,
    projectRoot: "/unused",
    duration: 2,
    lutCubeText: "TITLE warm\nLUT_3D_SIZE 2\n",
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
  });
  assert.equal(result.overlaySheetHtml, null);
  assert.equal(result.spriteManifest.statics.length, 1);
  assert.equal(result.spriteManifest.captions.length, 1);
  assert.equal(result.spriteManifest.three.length, 0);
  assert.equal(result.spriteManifest.dom.length, 0);
  assert.equal(result.manifest.lutApplication, "engine-canvas");
  assert.match(result.html, /id="akari-final"/);
  assert.doesNotMatch(result.html, /akari-stamp/);
  assert.doesNotMatch(result.html, /\/Users\//);
});

test("GPU page builder は字幕段の最下・中間・最上を overlays 2 段と同じ z 軸へ載せる", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-track-z-"));
  try {
    for (const order of [
      ["captions", "low", "high"],
      ["low", "captions", "high"],
      ["low", "high", "captions"],
    ]) {
      await writeZAxisProject(projectRoot, order);
      const result = await loadAndBuildGpuPage({ projectRoot, duration: 1 });
      const zById = new Map([
        ...result.spriteManifest.statics.map((value) => [value.id, value.z]),
        ...result.spriteManifest.captions.map((value) => [value.id, value.z]),
      ]);
      assert.deepEqual(order.map((id) => id === "captions" ? zById.get("c1-01") : zById.get(id)), [0, 1, 2]);
      assert.deepEqual(result.spriteManifest.captions.map(({ z, index }) => ({ z, index })), [
        { z: order.indexOf("captions"), index: 0 },
      ]);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("--edit 未指定の Electron 引数は null のままでも projectRoot/edit.json を読む", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-default-edit-"));
  try {
    await writeFile(join(projectRoot, "edit.json"), JSON.stringify({
      version: 2,
      output: { width: 222, height: 124, fps: 30 },
      sources: [{ id: "main", path: "assets/main.mp4", proxy: null }],
      tracks: [{
        id: "main-video",
        lane: "visual",
        items: [{
          id: "cut-0", at: 0, duration: 60,
          source: { kind: "media", src: "main", in: 0, out: 2 },
        }],
      }],
    }));
    const parsed = parseElectronArguments([
      "--render", projectRoot, "--out", join(projectRoot, "out.mp4"), "--duration", "2",
    ]);
    assert.equal(parsed.editPath, null);
    const built = await loadAndBuildGpuPage({
      projectRoot,
      editPath: parsed.editPath,
      fps: 30,
      width: 222,
      height: 124,
      duration: 2,
    });
    assert.equal(built.edit.output.width, 222);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("GPU Electron parses dump frames and uses raw/frame-N.rgba", () => {
  const parsed = parseElectronArguments([
    "--render", "/project", "--out", "/tmp/export/video.mp4", "--duration", "1",
    "--dump-frames", "29,0,12,12",
  ]);
  assert.deepEqual(parsed.dumpFrames, [0, 12, 29]);
  assert.equal(gpuRawFramePath(parsed.out, 12), "/tmp/export/raw/frame-12.rgba");
  assert.throws(() => parseElectronArguments([
    "--render", "/project", "--out", "/tmp/export/video.mp4", "--duration", "1",
    "--trap-readback", "--dump-frames", "0",
  ]), /cannot be combined/u);
});

test("GPU Electron recovers structured caption differences from renderer errors", () => {
  const summary = { totalCount: 1, shownCount: 1, truncated: false, entries: [{ field: "y", delta: 0.5 }] };
  const error = new Error(`caption-measure-unstable AKARI_CAPTION_MEASURE_DIFFS:${encodeURIComponent(JSON.stringify(summary))}`);
  assert.deepEqual(extractCaptionMeasureDiffs(error), summary);
});

test("GPU page manifest declares word mode, style, and emphasis from each cue", () => {
  const captions = {
    emphasis_words: [{ id: "e-0001", t_start: 1, t_end: 2, word: "強調", emotion: "pain" }],
    captions: [
      {
        id: "c-karaoke", start: 0, end: 1, text: "字幕", style: "karaoke", time_domain: "output",
        words: [{ text: "字幕", start: 0, end: 1 }],
      },
      {
        id: "c-emphasis", start: 1, end: 2, text: "強調", time_domain: "output",
        words: [{ text: "強調", start: 1, end: 2 }],
      },
    ],
  };
  const result = buildGpuPage({
    edit,
    overlays: [],
    captions,
    projectRoot: "/unused",
    duration: 2,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
  });
  assert.deepEqual(result.spriteManifest.captions.map((caption) => ({
    wordMode: caption.wordMode,
    styleId: caption.styleId,
    emphasisStyles: caption.emphasisStyles,
  })), [
    { wordMode: "karaoke", styleId: "karaoke", emphasisStyles: [] },
    { wordMode: "geometry", styleId: null, emphasisStyles: ["one-char-bang"] },
  ]);
});

test("GPU page groups consecutive DOM overlays and preserves declaration z-order", () => {
  const overlays = [
    { id: "dom-a", start: 0, duration: 2, html: "<style>.a{animation:a 1s}</style><div class=a>A</div>", transform: { x: 2, y: 3, scale: 1.2, rotate: 4 } },
    { id: "dom-b", start: 0, duration: 2, html: "<style>.b{filter:blur(1px)}</style><div class=b>B</div>", role: "background", vars: { "--x": "99px" } },
    { id: "static", start: 0, duration: 2, html: "<div>static</div>" },
    { id: "dom-c", start: 0, duration: 2, html: "<style>.c{transition:opacity 1s}</style><div class=c>C</div>" },
  ];
  const result = buildGpuPage({
    edit: { ...edit, overlays }, overlays, projectRoot: "/unused", duration: 2,
    frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;",
  });
  assert.equal(result.spriteManifest.dom.length, 2);
  assert.deepEqual(result.spriteManifest.dom.map((run) => [run.runId, run.index, run.entries.map((entry) => entry.id)]), [
    ["dom-0", 0, ["dom-a", "dom-b"]],
    ["dom-1", 3, ["dom-c"]],
  ]);
  assert.equal(result.spriteManifest.statics[0].index, 2);
  assert.equal(result.spriteManifest.dom[0].z, 0);
  assert.deepEqual(result.spriteManifest.dom[0].entries[0].vars, {
    "--x": "2px", "--y": "3px", "--scale": "1.2", "--rotate": "4deg",
  });
  assert.deepEqual(result.spriteManifest.dom[0].entries[1].vars, {
    "--x": "0px", "--y": "0px", "--scale": "1", "--rotate": "0deg",
  });
  assert.equal(result.manifest.domRunCount, 2);
  assert.equal(result.manifest.domOverlayCount, 3);
  assert.match(result.html, /id="akari-dom-stage"/);
  assert.doesNotMatch(result.html, /<canvas[^>]+layoutsubtree/iu);
});

test("GPU page cuts a DOM run when the track z changes", () => {
  const overlays = [
    { id: "dom-back", z: 0, start: 0, duration: 1, html: "<style>.x{animation:x 1s}</style><div>back</div>" },
    { id: "dom-front", z: 1, start: 0, duration: 1, html: "<style>.y{animation:y 1s}</style><div>front</div>" },
  ];
  const result = buildGpuPage({
    edit: { ...edit, overlays }, overlays, projectRoot: "/unused", duration: 1,
    frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;",
  });
  assert.deepEqual(result.spriteManifest.dom.map(({ z, entries }) => [z, entries.map((entry) => entry.id)]), [
    [0, ["dom-back"]],
    [1, ["dom-front"]],
  ]);
});

test("GPU page adds the parsed entrance only to animated 3D manifest entries", () => {
  const animatedHtml = `<div class="model-live">
    <style>
      .model-live { opacity:0; transform:translate(var(--model-x, 0px), var(--model-y, 0px)) scale(var(--model-scale, 1)); }
      [data-akari-active] .model-live, [data-no-timeline] .model-live {
        animation:model-live__enter 1.1s cubic-bezier(0.16, 1, 0.3, 1) .05s both;
      }
      @keyframes model-live__enter {
        from { opacity:0; transform:translate(calc(var(--model-x, 0px) + -20px), calc(var(--model-y, 0px) + 10px)) scale(calc(var(--model-scale, 1) * .8)); }
        to { opacity:1; transform:translate(var(--model-x, 0px), var(--model-y, 0px)) scale(var(--model-scale, 1)); }
      }
    </style>
    <canvas></canvas><script type="application/json" data-akari-3d-scene>{"model":"assets/scene3d/smartphone-mockup/model.glb"}</script>
  </div>`;
  const directHtml = '<canvas></canvas><script type="application/json" data-akari-3d-scene>{"model":"assets/scene3d/smartphone-mockup/model.glb"}</script>';
  const overlays = [
    { id: "animated", start: 1, duration: 2, html: animatedHtml, vars: { "--model-scale": "1.25" } },
    { id: "direct", start: 0, duration: 3, html: directHtml },
  ];
  const result = buildGpuPage({
    edit: { ...edit, overlays }, overlays, projectRoot: resolve(import.meta.dirname, "../../.."), duration: 3,
    frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;",
  });
  assert.deepEqual(result.spriteManifest.three[0], {
    id: "animated", start: 1, duration: 2, index: 0, z: 0,
    entrance: {
      durationSec: 1.1,
      delaySec: 0.05,
      timing: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
      fill: "both",
      from: { opacity: 0, tx: -20, ty: 10, sx: 1, sy: 1 },
      to: { opacity: 1, tx: 0, ty: 0, sx: 1.25, sy: 1.25 },
    },
  });
  assert.deepEqual(result.spriteManifest.three[1], {
    id: "direct", start: 0, duration: 3, index: 1, z: 0,
  });
  assert.equal(result.eligibility.entries[0].reason, "three-scene-entrance-curve");
  assert.equal(result.eligibility.entries[1].reason, "three-scene-canvas-direct");
});

test("GPU page carries text slot params to static sprites and DOM runs and inlines the slot runtime (#32)", () => {
  const overlays = [
    { id: "static", start: 0, duration: 1, html: '<div><span data-akari-slot="credit">x</span></div>', params: { credit: "A" } },
    { id: "dom", start: 1, duration: 1, html: '<style>.x{transition:opacity 1s}</style><span data-akari-slot="credit">x</span>', params: { credit: "B" } },
    { id: "plain", start: 2, duration: 1, html: "<div>plain</div>", params: {} },
  ];
  const result = buildGpuPage({
    edit: { ...edit, overlays },
    overlays,
    projectRoot: "/unused",
    duration: 3,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
    slotParamsRuntime: "window.akari={slotParams:{}};/*SLOT-RUNTIME*/",
  });
  assert.deepEqual(result.spriteManifest.statics.map((sprite) => [sprite.id, sprite.params]), [
    ["static", { credit: "A" }], ["plain", null],
  ]);
  assert.deepEqual(result.spriteManifest.dom.map((run) => run.entries.map((entry) => [entry.id, entry.params])), [
    [["dom", { credit: "B" }]],
  ]);
  assert.equal(result.manifest.textSlotOverlayCount, 2);
  assert.match(result.html, /SLOT-RUNTIME/u);
  assert.ok(result.html.indexOf("SLOT-RUNTIME") < result.html.indexOf("void 0;"), "slot runtime loads before the page runtime");

  const without = buildGpuPage({
    edit: { ...edit, overlays: [overlays[2]] },
    overlays: [overlays[2]],
    projectRoot: "/unused",
    duration: 3,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
    slotParamsRuntime: "/*SLOT-RUNTIME*/",
  });
  assert.equal(without.manifest.textSlotOverlayCount, 0);
  assert.doesNotMatch(without.html, /SLOT-RUNTIME/u);
});
