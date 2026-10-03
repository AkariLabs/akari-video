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
const classify = (html, overlay = {}) => evaluateGpuEligibility({
  edit: { overlays: [{ id: "scene", html, ...overlay }], output: {} },
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
    `<div><div data-akari-3d-fallback style="background:red"><span>Preview</span><img src="data:image/png;base64,AAAA"><br></div>${canvas}${scene}</div>`,
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

test("time-varying items leave direct while static opacity and transform stay", async (t) => {
  for (const [name, overlay] of [
    ["motion slide-up", { motion: { in: { preset: "slide-up", duration: 15 } } }],
    ["motionSource", { motionSource: { id: "move" } }],
    ["motionParents", { motionParents: [{ id: "parent" }] }],
    ["keyframes object", { keyframes: { transform: [{ x: 0 }, { x: 10 }] } }],
    ["keyframes array", { keyframes: [{ x: 0 }, { x: 10 }] }],
  ]) await t.test(name, () => {
    assert.notEqual(classify(canvas + scene, overlay), "three-scene-canvas-direct");
  });
  assert.equal(classify(canvas + scene, { opacity: 0.5 }), "three-scene-canvas-direct");
  assert.equal(classify(canvas + scene, { transform: { x: 100, y: 40, scale: 0.5, rotate: 20 } }), "three-scene-canvas-direct");
  assert.equal(classify(canvas + scene, { vars: { "--scale-x": "-1" } }), "three-scene-canvas-direct");
});

test("browser HTML parsing ambiguities leave direct", async (t) => {
  for (const [name, html] of [
    ["fallback on <p> is closed by an inner <div>", '<div>' + canvas + '<p data-akari-3d-fallback><div style="color:#fff">説明</div></p>' + scene + '</div>'],
    ["fallback on <td>", '<div>' + canvas + '<td data-akari-3d-fallback>説明</td>' + scene + '</div>'],
    ["<keygen> inside fallback", '<div>' + canvas + '<div data-akari-3d-fallback><keygen></div>' + scene + '</div>'],
    ["<image> inside fallback", '<div>' + canvas + '<div data-akari-3d-fallback><image></div>' + scene + '</div>'],
    ["<canvas> inside fallback", '<div>' + canvas + '<div data-akari-3d-fallback><canvas></canvas></div>' + scene + '</div>'],
    ["<svg><style> inside fallback", '<div>' + canvas + '<div data-akari-3d-fallback><svg><style>svg{color:red}</style></svg></div>' + scene + '</div>'],
    ["SVG style with entity inside fallback", '<div>' + canvas + '<div data-akari-3d-fallback><svg><style>svg{color:&amp;}</style></svg></div>' + scene + '</div>'],
    ["non-void <span/>", '<div><span/></div>' + canvas + scene],
    ["NBSP in tag name", '<div\u00a0data-akari-3d-fallback>見える文字</div>' + canvas + scene],
    ["full-width space in tag name", '<div\u3000data-akari-3d-fallback>見える文字</div>' + canvas + scene],
    ["empty <!--> followed by visible heading", '<!--><h1>見える</h1>-->' + canvas + scene],
    ["empty <!---> followed by visible heading", '<!---><h1>見える</h1>-->' + canvas + scene],
    ["--!> closes comment before visible heading", '<!-- a --!><h1>見える</h1> -->' + canvas + scene],
    ["comment markers inside attribute values", '<div title="<!--">見える</div><div title="-->"></div>' + canvas + scene],
    ["doctype outside fragment", '<!doctype html>' + canvas + scene],
    ["</script foo> closes raw text early", '<div>' + canvas + '<script type="application/json" data-akari-3d-scene>{}</script foo><h1>visible</h1></script></div>'],
    ["</script/> closes raw text early", '<div>' + canvas + '<script type="application/json" data-akari-3d-scene>{}</script/><h1>visible</h1></script></div>'],
    ["</style foo> closes raw text early", '<style>.a{width:1px}</style foo><h1>visible</h1><style></style>' + canvas + scene],
  ]) await t.test(name, () => {
    assert.notEqual(classify(html), "three-scene-canvas-direct");
  });
});

test("CSS parsing and selector ambiguities leave direct", async (t) => {
  for (const [name, html] of [
    ["url comment markers in inline CSS", '<canvas style="position:absolute;inset:0;--a:url(/*);background:red;--b:url(*/)"></canvas>' + scene],
    ["url comment markers in <style>", '<style>canvas{--a:url(/*);background:red;--b:url(*/)}</style>' + canvas + scene],
    ["entity-encoded comment marker in inline CSS", '<canvas style="font-family:&#34;/*&#34;;background:red"></canvas>' + scene],
    ["quoted comment marker in <style>", '<style>canvas{font-family:"/*";background:red}</style>' + canvas + scene],
    ["entity in inline CSS value", '<canvas style="font-family:&#34;safe&#34;;--a:&amp;"></canvas>' + scene],
    ["entity in <style> body", '<style>canvas{color:&amp;}</style>' + canvas + scene],
    ["quoted braces and semicolon in <style>", '<style>canvas { font-family: "}"; background: red; --x: "{ --y: 1"; }</style>' + canvas + scene],
    ["escaped brace in <style>", '<style>canvas { font-family: "x\\}"; background: red; }</style>' + canvas + scene],
    ["url with brace in <style>", '<style>canvas { --x: url(}); background: red; }</style>' + canvas + scene],
    ["display:list-item inline", '<canvas style="display:list-item"></canvas>' + scene],
    ["display:list-item in <style>", '<style>canvas{display:list-item}</style>' + canvas + scene],
    ["state selector [data-akari-active]", '<style>[data-akari-active] canvas{width:100%}</style>' + canvas + scene],
    ["pseudo-class selector", '<style>canvas:hover{width:100%}</style>' + canvas + scene],
    ["id selector", '<style>#scene canvas{width:100%}</style>' + canvas + scene],
    ["universal selector", '<style>*{width:100%}</style>' + canvas + scene],
    ["unknown attribute selector", '<style>[data-other] canvas{width:100%}</style>' + canvas + scene],
    ["bare div selector", '<style>div{width:100%}</style>' + canvas + scene],
    ["bare html selector", '<style>html{width:100%}</style>' + canvas + scene],
    ["bare body selector", '<style>body{width:100%}</style>' + canvas + scene],
  ]) await t.test(name, () => {
    assert.notEqual(classify(html), "three-scene-canvas-direct");
  });
});

test("ordinary comments, scoped CSS, and a synthetic scene stay direct", () => {
  const sample = [
    '<div class="demo-scene">',
    '<style>',
    '/* 説明のコメント。"camera": { "fromModel": ... }、mp4 / mov、**強調** */',
    '/* 2 つ目のコメント */',
    '.demo-scene { position:absolute; inset:0; --pan-x:var(--demo-x, 0); --zoom:var(--demo-scale, 1); }',
    '.demo-scene__canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }',
    '.demo-scene__fallback { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;',
    '  font-family:-apple-system, "Hiragino Sans", sans-serif; font-size:2.2cqmin;',
    '  color:rgba(255,255,255,0.55); letter-spacing:0.08em; }',
    '</style>',
    '<canvas class="demo-scene__canvas"></canvas>',
    '<div class="demo-scene__fallback" data-akari-3d-fallback>3D を読み込み中</div>',
    '<script type="application/json" data-akari-3d-scene>{}</script>',
    '</div>',
  ].join("\n");
  for (const html of [
    sample,
    '<!-- 説明 -->' + canvas + scene,
    '<style>[data-akari-3d-canvas] { display:inline-flex !important; }</style><canvas data-akari-3d-canvas></canvas>' + scene,
    '<style>.scope canvas { width:100%; }</style><div class="scope">' + canvas + scene + '</div>',
    '<style>canvas { width:100%; height:100%; }</style>' + canvas + scene,
    '<div class="static-scene"><style>.static-scene { position:absolute; inset:0; }</style><canvas class="static-scene__canvas"></canvas><div data-akari-3d-fallback></div>' + scene + '</div>',
    '<canvas></canvas>' + scene,
  ]) assert.equal(classify(html), "three-scene-canvas-direct", html.slice(0, 130));
});

test("large data URI attributes are classified without stack overflow", () => {
  const uri = `data:image/png;base64,${"A".repeat(32 * 1024 * 1024)}`;
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

test("rounded anisotropic rotation remains representable but real shear fails", async () => {
  const { threeCanvasDrawState: draw } = await runtimeInternals();
  const source = await readFile(join(import.meta.dirname, "..", "..", "frame-engine", "generated", "frame-engine.iife.js"), "utf8");
  const context = {};
  vm.runInNewContext(source, context);
  const width = 640, height = 360;
  const angle = 30 * Math.PI / 180;
  const round = (number) => Number(number.toPrecision(6));
  const a = round(Math.cos(angle) * 1.7), b = round(Math.sin(angle) * 1.7);
  const c = round(-Math.sin(angle) * 0.9), d = round(Math.cos(angle) * 0.9);
  const outerWidth = Math.abs(a) * width + Math.abs(c) * height;
  const outerHeight = Math.abs(b) * width + Math.abs(d) * height;
  const rect = { left: (width - outerWidth) / 2, top: (height - outerHeight) / 2,
    width: outerWidth, height: outerHeight };
  const state = draw(rect, { width, height }, { a, b, c, d }, width, height);
  const matrix = context.AkariFrameEngine.spriteTransformMatrix({ id: "scene", ...state }, width, height);
  for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const clipX = 2 * x / width - 1, clipY = 1 - 2 * y / height;
    const actualX = matrix[0] * clipX + matrix[3] * clipY + matrix[6];
    const actualY = matrix[1] * clipX + matrix[4] * clipY + matrix[7];
    const dx = x - width / 2, dy = y - height / 2;
    const expectedX = 2 * (width / 2 + a * dx + c * dy) / width - 1;
    const expectedY = 1 - 2 * (height / 2 + b * dx + d * dy) / height;
    assert.ok(Math.abs(actualX - expectedX) < 0.001 && Math.abs(actualY - expectedY) < 0.001);
  }
  assert.throws(() => draw({ left: 0, top: 0, width, height },
    { width, height }, { a: 1, b: 0, c: 0.2, d: 1 }, width, height), /shear/);
});

test("host and ancestor opacity reach the direct draw", async () => {
  const { threeCanvasStateFromStyles, orderedSpriteDraws } = await runtimeInternals();
  const rect = { left: 0, top: 0, width: 640, height: 360 };
  const layout = { width: 640, height: 360 };
  const plain = threeCanvasStateFromStyles(rect, layout, [{ transform: "none", opacity: "1" }], 640, 360);
  const half = threeCanvasStateFromStyles(rect, layout, [
    { transform: "none", opacity: "0.5" }, { transform: "none", opacity: "1" },
  ], 640, 360);
  assert.equal(plain, null);
  assert.deepEqual({ ...half }, { opacity: 0.5 });
  assert.deepEqual({ ...threeCanvasStateFromStyles(rect, layout, [
    { transform: "none", opacity: "2" }, { transform: "none", opacity: "-0.25" },
  ], 640, 360) }, { opacity: 0 });
  const manifest = { statics: [], three: [{ id: "scene", index: 0, start: 0, duration: 2, entranceMode: "none" }], vgpu: [], dom: [] };
  const ordered = (draw) => orderedSpriteDraws(manifest, 1, {}, null, null, new Map([["scene", { draw }]]));
  assert.equal(ordered(plain)[0].opacity, 1);
  assert.equal(ordered(half)[0].opacity, 0.5);
});

test("canvas placement reads the host chain and rejects unsupported DOM transforms", async () => {
  const { threeCanvasPlacement } = await runtimeInternals();
  const view = { getComputedStyle: (node) => node.computed };
  const host = { classList: { contains: (name) => name === "akari-overlay-container" },
    computed: { transform: "matrix(.8,0,0,.8,100,0)", opacity: "0.8" } };
  const middle = { parentElement: host, computed: { transform: "matrix(.5,0,0,.5,0,0)", opacity: "0.5" } };
  const canvasNode = { parentElement: middle, ownerDocument: { defaultView: view },
    computed: { transform: "none", opacity: "1" }, offsetWidth: 640, offsetHeight: 360,
    getBoundingClientRect: () => ({ left: 292, top: 148, width: 256, height: 144 }) };
  const container = { parentElement: host };
  assert.deepEqual({ ...threeCanvasPlacement(canvasNode, container, 640, 360) },
    { translateX: 100, translateY: 40, scaleX: 0.4, scaleY: 0.4, opacity: 0.4 });
  assert.throws(() => threeCanvasPlacement(canvasNode, { parentElement: {} }, 640, 360), /host/);
  assert.throws(() => threeCanvasPlacement({ ...canvasNode, parentElement: null }, container, 640, 360), /outside/);
  host.computed = { transform: "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)", opacity: "1" };
  assert.throws(() => threeCanvasPlacement(canvasNode, container, 640, 360), /unsupported 3D/);
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
