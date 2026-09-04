import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { extractCaptionMeasureDiffs, gpuRawFramePath, parseElectronArguments } from "../src/electron-main.mjs";
import { buildGpuPage, loadAndBuildGpuPage } from "../src/page-builder.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TEXTSTYLE_CATALOG } = require("../../edit-store/lib/index.js");

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

test('GPU page builder は captions.json で stale anchor cache を再解決し、不在時は保持する', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'gpu-anchor-wiring-'));
  const anchored = {
    version: 2,
    output: { width: 64, height: 36, fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    tracks: [
      { id: 'main', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 300, source: { kind: 'media', src: 'main', in: 0, out: 10 } }] },
      { id: 'overlay', lane: 'visual', items: [{ id: 'box', at: 15, duration: 15, source: { kind: 'html', path: 'box.html' }, anchor: { caption: 'c-0003' } }] },
    ],
  };
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(anchored));
    await writeFile(join(projectRoot, 'box.html'), '<div>box</div>');
    let result = await loadAndBuildGpuPage({ projectRoot, duration: 4 });
    assert.equal(result.edit.overlays[0].start, 0.5);
    await writeFile(join(projectRoot, 'captions.json'), JSON.stringify([
      { id: 'c-0003', start: 2, end: 3, text: 'caption' },
    ]));
    result = await loadAndBuildGpuPage({ projectRoot, duration: 4 });
    assert.equal(result.edit.overlays[0].start, 2);
    assert.equal(result.edit.overlays[0].duration, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('GPU page builder の v1 拒否は captions.json の有無で同一', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'gpu-anchor-v1-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify({
      version: 1, output: { fps: 30 }, sources: [], cuts: [], overlays: [],
    }));
    await assert.rejects(() => loadAndBuildGpuPage({ projectRoot, duration: 1 }), /古い形式/u);
    await writeFile(join(projectRoot, 'captions.json'), '[]\n');
    await assert.rejects(() => loadAndBuildGpuPage({ projectRoot, duration: 1 }), /古い形式/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
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

test("GPU page builders pass forceDegraded into eligibility and create DOM runs", async () => {
  const overlays = [{ id: "forced", start: 0, duration: 1, html: "<iframe></iframe>", vars: {} }];
  const direct = buildGpuPage({
    edit: { ...edit, overlays },
    overlays,
    captions: [],
    projectRoot: "/unused",
    duration: 1,
    forceDegraded: true,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
  });
  assert.equal(direct.eligibility.entries[0].classification, "dom");
  assert.equal(direct.eligibility.entries[0].forced, true);
  assert.equal(direct.spriteManifest.dom[0].entries[0].id, "forced");

  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-force-page-builder-"));
  try {
    await writeFile(join(projectRoot, "edit.json"), JSON.stringify(zAxisEdit(["low"])));
    await writeFile(join(projectRoot, "low.html"), "<iframe></iframe>");
    const loaded = await loadAndBuildGpuPage({ projectRoot, duration: 1, forceDegraded: true });
    assert.equal(loaded.eligibility.entries[0].classification, "dom");
    assert.equal(loaded.eligibility.entries[0].forced, true);
    assert.equal(loaded.spriteManifest.dom[0].entries[0].id, "low");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
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
    entranceMode: "curve",
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
    id: "direct", start: 0, duration: 3, index: 1, z: 0, entranceMode: "none",
  });
  assert.equal(result.eligibility.entries[0].reason, "three-scene-entrance-curve");
  assert.equal(result.eligibility.entries[1].reason, "three-scene-canvas-direct");
});

test("GPU page manifest takes sampled entrance mode from eligibility", async () => {
  const html = await readFile(join(import.meta.dirname, "fixtures", "three-sampled-middle-keyframe.html"), "utf8");
  const overlays = [{ id: "sampled", start: 0, duration: 2, html }];
  const result = buildGpuPage({
    edit: { ...edit, overlays }, overlays, projectRoot: resolve(import.meta.dirname, "../../.."), duration: 2,
    frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;",
  });
  assert.deepEqual(result.spriteManifest.three, [{
    id: "sampled", start: 0, duration: 2, index: 0, z: 0, entranceMode: "sampled",
  }]);
  assert.equal(result.eligibility.entries[0].reason, "three-scene-entrance-sampled");
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

// issue #40 §2（2026-09-01）: emPx（page-runtime の字幕計測）と CSS の --caption-font-size は同じ実効 px。
test("GPU page emPx follows reference_height_px through the render-cut vars (720p 36px, 4K 108px)", () => {
  const captions = {
    default_text_style: {
      zone: "bottom", size_px: 36, reference_height_px: 720,
      stroke: { color: "#000000", width_px: 3 }, background: { radius_px: 8 },
    },
    captions: [{ id: "c-ref", start: 0, end: 1, text: "字幕", time_domain: "output" }],
  };
  const build = (width, height, root = captions) => buildGpuPage({
    edit: { ...edit, output: { ...edit.output, width, height } },
    overlays: [],
    captions: root,
    projectRoot: "/unused",
    width,
    height,
    duration: 1,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
  }).spriteManifest.captions[0];
  const hd = build(1280, 720);
  assert.equal(hd.emPx, 36);
  assert.equal(hd.vars["--caption-font-size"], "36px");
  const uhd = build(3840, 2160);
  assert.equal(uhd.emPx, 108);
  assert.equal(uhd.vars["--caption-font-size"], "108px");
  assert.equal(uhd.vars["--caption-stroke"], "18px #000000");
  assert.equal(uhd.vars["--plate-radius"], "24px");
  // cue 側の上書き（フィールド単位マージ）
  const overridden = build(3840, 2160, {
    ...captions,
    captions: [{ ...captions.captions[0], text_style: { reference_height_px: 1080 } }],
  });
  assert.equal(overridden.emPx, 72);
  assert.equal(overridden.vars["--caption-font-size"], "72px");
  // 宣言なしは従来どおり size_px そのまま（4K でも 36）
  const legacy = build(3840, 2160, { ...captions, default_text_style: { zone: "bottom", size_px: 36 } });
  assert.equal(legacy.emPx, 36);
  assert.equal(legacy.vars["--caption-font-size"], "36px");
  // size_px 未宣言は従来の既定（横長 38 / 縦長 幅 6%）
  assert.equal(build(3840, 2160, { captions: captions.captions }).emPx, 38);
  assert.equal(build(1080, 1920, { captions: captions.captions }).emPx, 65);
});

test("GPU 実読込点の captionOverlays は style_preset 参照と値焼き込みで一致する", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "gpu-style-preset-parity-"));
  try {
    const entries = Object.entries(TEXTSTYLE_CATALOG);
    const records = entries.map(([id], index) => ({
      id: `c-${String(index + 1).padStart(4, "0")}`,
      start: 0,
      end: 1,
      text: id,
      time_domain: "output",
    }));
    const editRoot = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [],
      tracks: [{
        id: "captions",
        lane: "visual",
        items: [{
          id: "captions-bag",
          at: 0,
          duration: 30,
          source: { kind: "captions", path: "captions.json", exclude: [] },
          items: [],
        }],
      }],
    };
    const writeProject = async (name, captionsRoot) => {
      const project = join(temporary, name);
      await mkdir(project);
      await Promise.all([
        writeFile(join(project, "edit.json"), JSON.stringify(editRoot)),
        writeFile(join(project, "captions.json"), JSON.stringify(captionsRoot)),
      ]);
      return project;
    };
    const referencedProject = await writeProject("referenced", {
      captions: records.map((record, index) => ({ ...record, style_preset: entries[index][0] })),
    });
    const burnedProject = await writeProject("burned", {
      captions: records.map((record, index) => ({ ...record, text_style: entries[index][1].style })),
    });
    const options = { duration: 1, fps: 30, width: 320, height: 180 };
    const referenced = await loadAndBuildGpuPage({ ...options, projectRoot: referencedProject });
    const burned = await loadAndBuildGpuPage({ ...options, projectRoot: burnedProject });
    assert.deepEqual(referenced.spriteManifest.captions, burned.spriteManifest.captions);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
