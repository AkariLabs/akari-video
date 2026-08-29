import assert from "node:assert/strict";
import test from "node:test";

import { buildGpuPage } from "../src/page-builder.mjs";

const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30, look: { lut: "warm", intensity: 0.7 } },
  sources: [{ id: "main", path: "assets/main.mp4" }],
  cuts: [{ id: "cut", src: "main", in: 0, out: 2 }],
  overlays: [],
};

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
