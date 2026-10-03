// 3D canvas の直描きに残せる断片と composite へ回す断片の境界を確かめる。
// canvas の矩形・回転・鏡映を SpriteDraw に渡す配置計算も検証する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { evaluateGpuEligibility } from "../src/eligibility.mjs";

const scene = '<script type="application/json" data-akari-3d-scene>{}</script>';
const canvas = '<canvas style="position:absolute;inset:0"></canvas>';
const classify = (html) => evaluateGpuEligibility({
  edit: { overlays: [{ id: "scene", html }], output: {} },
}).entries[0].reason;

async function runtimeInternals() {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const window = { __AKARI_GPU_CONFIG__: {}, AkariFrameEngine: {}, akariGpu: null };
  class FakeMessageChannel {
    constructor() { this.port1 = {}; this.port2 = { postMessage() {} }; }
  }
  vm.runInNewContext(source, { window, MessageChannel: FakeMessageChannel, console, setTimeout, clearTimeout, performance });
  return window.__akariGpuDomInternals;
}

test("canvas and layout-only fragments remain direct", () => {
  for (const html of [
    `${canvas}${scene}`,
    `<canvas></canvas><canvas data-akari-3d-canvas></canvas>${scene}`,
    `<div style="position:absolute;inset:0;display:grid;place-items:center;--size:1"><style>canvas { width:100%; height:100%; }</style>${canvas}${scene}</div>`,
    `<div><div data-akari-3d-fallback style="background:red"><h1>Preview</h1><img src="data:image/png;base64,AAAA"></div>${canvas}${scene}</div>`,
    `<div class="static-scene"><style>.static-scene { position:absolute; inset:0; }</style><canvas class="static-scene__canvas"></canvas><div data-akari-3d-fallback></div>${scene}</div>`,
    `<canvas></canvas>${scene}`,
  ]) assert.equal(classify(html), "three-scene-canvas-direct", html.slice(0, 120));
});

test("visible content and unsupported styles use composite", () => {
  for (const property of ["transform:rotate(10deg)", "rotate:10deg", "scale:1.1", "translate:10px", "background:#fff",
    "border:1px solid red", "opacity:.5", "padding:10px", "object-fit:cover", "display:none"]) {
    assert.equal(classify(`<div style="${property}">${canvas}${scene}</div>`), "three-scene-sampled-composite", property);
    assert.equal(classify(`<style>canvas{${property}}</style>${canvas}${scene}`), "three-scene-sampled-composite", property);
  }
  for (const html of [
    `${canvas}<h1>Title</h1>${scene}`,
    `<div>${canvas}Visible text${scene}</div>`,
    `<style>@media screen { canvas { width:100%; } }</style>${canvas}${scene}`,
  ]) assert.equal(classify(html), "three-scene-sampled-composite");
});

test("ambiguous fragments leave the direct path", () => {
  for (const html of [
    `<img src="data:image/png;base64,AAAA">${canvas}${scene}`,
    `<div>${canvas}<div data-akari-3d-fallback></div><div data-akari-3d-fallback></div>${scene}</div>`,
    `${canvas}<h1 title="data-akari-3d-fallback">Title</h1>${scene}`,
  ]) assert.notEqual(classify(html), "three-scene-canvas-direct");
});

test("fallback CSS, real attributes, entities, and hidden display leave the direct path", () => {
  for (const html of [
    `<div><div data-akari-3d-fallback><style>canvas{transform:rotate(10deg)}</style></div>${canvas}${scene}</div>`,
    `<canvas data-style="position:absolute" style="transform:rotate(10deg)"></canvas>${scene}`,
    `<canvas title="style=position:absolute" style="transform:rotate(10deg)"></canvas>${scene}`,
    `<canvas></canvas><script data-type="application/json" type="text/javascript" data-akari-3d-scene>{}</script>`,
    `<canvas style="position:absolute&#59 transform&#58rotate(10deg)"></canvas>${scene}`,
    `<canvas style="display:none!important"></canvas>${scene}`,
    `<canvas style="position:absolute" style="transform:rotate(10deg)"></canvas>${scene}`,
    `< div>${canvas}${scene}</div>`,
    `<canvas title="unclosed></canvas>${scene}`,
  ]) assert.notEqual(classify(html), "three-scene-canvas-direct", html.slice(0, 120));
});

test("large data URI attributes are classified without stack overflow", () => {
  const uri = `data:image/png;base64,${"A".repeat(8 * 1024 * 1024)}`;
  assert.equal(classify(`<div>${canvas}<div data-akari-3d-fallback><img src="${uri}"></div>${scene}</div>`), "three-scene-canvas-direct");
  assert.notEqual(classify(`<canvas style="background:url(${uri})"></canvas>${scene}`), "three-scene-canvas-direct");
});

test("canvas state maps the full frame, partial rectangles, host transform, and zero area", async () => {
  const { threeCanvasDrawState: draw } = await runtimeInternals();
  const identity = { a: 1, b: 0, c: 0, d: 1 };
  const place = (rect, layout = { width: rect.width, height: rect.height }, matrix = identity) => draw(rect, layout, matrix, 640, 360);
  assert.equal(place({ left: 0, top: 0, width: 640, height: 360 }), null);
  assert.deepEqual({ ...place({ left: 320, top: 0, width: 320, height: 360 }) },
    { translateX: 160, translateY: 0, scaleX: 0.5, scaleY: 1 });
  assert.deepEqual({ ...place({ left: 80, top: 40, width: 400, height: 200 }) },
    { translateX: -40, translateY: -40, scaleX: 0.625, scaleY: 200 / 360 });
  assert.deepEqual({ ...place({ left: 260, top: 130, width: 320, height: 180 },
    { width: 640, height: 360 }, { a: 0.5, b: 0, c: 0, d: 0.5 }) },
    { translateX: 100, translateY: 40, scaleX: 0.5, scaleY: 0.5 });
  assert.equal(place({ left: 0, top: 0, width: 0, height: 360 }), false);
  assert.throws(() => place({ left: 0, top: 0, width: 640, height: 360 },
    { width: 640, height: 360 }, { a: 1, b: 0, c: 0.2, d: 1 }), /shear/);
});

test("rotation reaches the intended four corners through the compositor matrix", async () => {
  const { threeCanvasDrawState: draw } = await runtimeInternals();
  const angle = 20 * Math.PI / 180, a = Math.cos(angle), b = Math.sin(angle);
  const width = 640, height = 360;
  const rect = { left: (width - (width * a + height * b)) / 2,
    top: (height - (width * b + height * a)) / 2,
    width: width * a + height * b, height: width * b + height * a };
  const state = draw(rect, { width, height }, { a, b, c: -b, d: a }, width, height);
  assert.ok(Math.abs(state.rotateDeg + 20) < 1e-9);
  assert.equal(state.originX, 320);
  assert.equal(state.originY, 180);
  assert.ok(Math.abs(state.scaleX - 1) < 1e-9 && Math.abs(state.scaleY - 1) < 1e-9);
  const source = await readFile(join(import.meta.dirname, "..", "..", "frame-engine", "generated", "frame-engine.iife.js"), "utf8");
  const context = {};
  vm.runInNewContext(source, context);
  const matrix = context.AkariFrameEngine.spriteTransformMatrix({ id: "scene", ...state }, width, height);
  for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const clipX = 2 * x / width - 1, clipY = 1 - 2 * y / height;
    const actualX = matrix[0] * clipX + matrix[3] * clipY + matrix[6];
    const actualY = matrix[1] * clipX + matrix[4] * clipY + matrix[7];
    const dx = x - width / 2, dy = y - height / 2;
    const expectedX = 2 * (width / 2 + a * dx - b * dy) / width - 1;
    const expectedY = 1 - 2 * (height / 2 + b * dx + a * dy) / height;
    assert.ok(Math.abs(actualX - expectedX) < 1e-6 && Math.abs(actualY - expectedY) < 1e-6);
  }
});

test("mirrors preserve all four corners, with and without rotation", async () => {
  const { threeCanvasDrawState: draw } = await runtimeInternals();
  const source = await readFile(join(import.meta.dirname, "..", "..", "frame-engine", "generated", "frame-engine.iife.js"), "utf8");
  const context = {};
  vm.runInNewContext(source, context);
  const width = 640, height = 360;
  const angle = 20 * Math.PI / 180;
  for (const { a, b, c, d } of [
    { a: -1, b: 0, c: 0, d: 1 },
    { a: -Math.cos(angle), b: -Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle) },
  ]) {
    const outerWidth = Math.abs(a) * width + Math.abs(c) * height;
    const outerHeight = Math.abs(b) * width + Math.abs(d) * height;
    const rect = { left: (width - outerWidth) / 2, top: (height - outerHeight) / 2,
      width: outerWidth, height: outerHeight };
    const state = draw(rect, { width, height }, { a, b, c, d }, width, height);
    assert.ok(state.scaleY < 0);
    const matrix = context.AkariFrameEngine.spriteTransformMatrix({ id: "scene", ...state }, width, height);
    for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
      const clipX = 2 * x / width - 1, clipY = 1 - 2 * y / height;
      const actualX = matrix[0] * clipX + matrix[3] * clipY + matrix[6];
      const actualY = matrix[1] * clipX + matrix[4] * clipY + matrix[7];
      const dx = x - width / 2, dy = y - height / 2;
      const expectedX = 2 * (width / 2 + a * dx + c * dy) / width - 1;
      const expectedY = 1 - 2 * (height / 2 + b * dx + d * dy) / height;
      assert.ok(Math.abs(actualX - expectedX) < 1e-6 && Math.abs(actualY - expectedY) < 1e-6);
    }
  }
});

test("ordered draws keep plain state and skip zero area", async () => {
  const { orderedSpriteDraws } = await runtimeInternals();
  const manifest = { statics: [], three: [{ id: "scene", index: 0, start: 0, duration: 2, entranceMode: "none" }], vgpu: [], dom: [] };
  const ordered = (draw) => orderedSpriteDraws(manifest, 1, {}, null, null, new Map([["scene", { draw }]]));
  assert.deepEqual({ ...ordered(null)[0] }, { z: 0, index: 0, id: "scene", opacity: 1 });
  assert.deepEqual({ ...ordered({ translateX: 160, scaleX: 0.5 })[0] },
    { z: 0, index: 0, id: "scene", translateX: 160, scaleX: 0.5, opacity: 1 });
  assert.equal(ordered(false).length, 0);
});
