// data-akari-3d-anchor の GPU 書き出し経路。
//   - アンカー付き 3D は直描き（canvas テクスチャ 1 枚）にせず composite へ回す
//   - composite の DOM 層複製へ投影済みの transform / visibility を写す
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { evaluateGpuEligibility } from "../src/eligibility.mjs";

const scene = '<script type="application/json" data-akari-3d-scene>{}</script>';
const canvas = '<canvas style="position:absolute;inset:0"></canvas>';
const label = (point, extra = "") =>
  `<span data-akari-3d-anchor="${point}"${extra}>地点</span>`;
const classify = (html, overlay = {}) => evaluateGpuEligibility({
  edit: { overlays: [{ id: "scene", html, ...overlay }], output: {} },
}).entries[0];

async function domInternals() {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const window = { __AKARI_GPU_CONFIG__: {}, AkariFrameEngine: {}, akariGpu: null };
  class FakeMessageChannel {
    constructor() { this.port1 = {}; this.port2 = { postMessage() {} }; }
  }
  vm.runInNewContext(source, {
    window, MessageChannel: FakeMessageChannel, console, setTimeout, clearTimeout, performance,
  });
  return window.__akariGpuDomInternals;
}

test("3D anchor elements keep the direct canvas path off", () => {
  assert.equal(classify(`${canvas}${scene}`).reason, "three-scene-canvas-direct");
  const staticAnchor = classify(`<div>${canvas}${label("0,1,0")}${scene}</div>`);
  assert.equal(staticAnchor.classification, "three");
  assert.equal(staticAnchor.reason, "three-scene-sampled-composite");

  // 文字を持たないピン（layout-only と判定されうる形）でも直描きにしない。
  const imageAnchor = classify(
    `<div>${canvas}<img data-akari-3d-anchor="0,0,0" src="data:image/png;base64,AAAA">${scene}</div>`);
  assert.equal(imageAnchor.classification, "three");
  assert.equal(imageAnchor.reason, "three-scene-sampled-composite");

  const animatedAnchor = classify(`<style>@keyframes rise{from{opacity:0}to{opacity:1}}.l{animation:rise 1s}</style>
    <div>${canvas}${label("0,1,0", ' class="l"')}${scene}</div>`);
  assert.equal(animatedAnchor.classification, "three");
  assert.equal(animatedAnchor.reason, "three-scene-sampled-composite");

  const unsupported = classify(`<script>console.log(1)</script><div>${canvas}${label("0,1,0")}${scene}</div>`);
  assert.equal(unsupported.classification, "degraded");
  assert.match(unsupported.reason, /three-sampled-condition/u);
});

test("composite copies projected anchor styles into the DOM layer clone", async () => {
  const { syncAnchorElementStyles } = await domInternals();
  const style = (transform = "", visibility = "") => ({
    transform,
    visibility,
    removeProperty(name) { if (name === "visibility") this.visibility = ""; },
  });
  const source = [
    { style: style("translate(120px, 80px)", "hidden") },
    { style: style("translate(10.5px, 20px)", "") },
  ];
  const target = [
    { style: style("", "") },
    { style: style("translate(1px, 2px)", "hidden") },
  ];
  const copied = syncAnchorElementStyles(
    { querySelectorAll: () => source },
    { querySelectorAll: () => target },
  );
  assert.equal(copied, 2);
  assert.equal(target[0].style.transform, "translate(120px, 80px)");
  assert.equal(target[0].style.visibility, "hidden");
  assert.equal(target[1].style.transform, "translate(10.5px, 20px)");
  assert.equal(target[1].style.visibility, "");
  assert.equal(syncAnchorElementStyles(null, { querySelectorAll: () => target }), 0);
});
