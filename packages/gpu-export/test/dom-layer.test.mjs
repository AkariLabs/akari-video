import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

async function internals() {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const window = { __AKARI_GPU_CONFIG__: {}, AkariFrameEngine: null, akariGpu: null };
  class FakeMessageChannel {
    constructor() {
      this.port1 = {};
      this.port2 = { postMessage() {} };
    }
  }
  vm.runInNewContext(source, { window, MessageChannel: FakeMessageChannel, console, setTimeout, clearTimeout, performance });
  return window.__akariGpuDomInternals;
}

test("DOM sentinel colors are deterministic", async () => {
  const value = await internals();
  assert.deepEqual([...value.sentinelColor(0)], [16, 53, 89]);
  assert.deepEqual([...value.sentinelColor(17)], [33, 138, 52]);
  assert.deepEqual([...value.sentinelColor(223)], [239, 48, 78]);
});

test("DOM settle policy follows requestPaint availability", async () => {
  const value = await internals();
  assert.equal(value.chooseSettlePolicy({ requestPaint() {} }), "raf2-paint-event");
  assert.equal(value.chooseSettlePolicy({}), "sync-layout");
});

test("DOM activity and cross-kind draw order use track z then declaration indexes", async () => {
  const value = await internals();
  const run = { runId: "dom-0", z: 1, index: 1, entries: [{ start: 1, duration: 2 }] };
  assert.equal(value.runActiveAt(run, 0.5), false);
  assert.equal(value.runActiveAt(run, 1), true);
  assert.equal(value.runActiveAt(run, 3), false);
  const draws = value.orderedSpriteDraws({
    statics: [{ id: "static", z: 0, index: 2, start: 0, duration: 4 }],
    three: [{ id: "three", z: 2, index: 0, start: 0, duration: 4 }],
    dom: [run],
  }, 1.5, { activeAt: value.runActiveAt });
  assert.deepEqual(Array.from(draws, (draw) => draw.id), ["static", "dom-0", "three"]);
  assert.deepEqual(Array.from(draws, ({ z, index }) => [z, index]), [[0, 2], [1, 1], [2, 0]]);
});

test("GPU Electron applies one ordered DOM flag source and the receipt reads it", async () => {
  const mainSource = await readFile(join(import.meta.dirname, "..", "src", "electron-main.mjs"), "utf8");
  const runtimeSource = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const start = mainSource.indexOf("const DOM_LAYER_SWITCHES");
  const end = mainSource.indexOf("]);", start);
  const declaration = mainSource.slice(start, end);
  assert.ok(declaration.indexOf('"enable-features", "CanvasDrawElement"') < declaration.indexOf('"disable-gpu-vsync"'));
  assert.ok(declaration.indexOf('"disable-gpu-vsync"') < declaration.indexOf('"disable-frame-rate-limit"'));
  assert.doesNotMatch(declaration, /partial-raster/u);
  assert.match(mainSource, /if \(value === null\) app\.commandLine\.appendSwitch\(name\)/u);
  assert.match(mainSource, /else app\.commandLine\.appendSwitch\(name, value\)/u);
  assert.match(mainSource, /domLayerFlags,/u);
  assert.match(runtimeSource, /flags: Array\.isArray\(this\.config\.domLayerFlags\) \? \[\.\.\.this\.config\.domLayerFlags\] : \[\]/u);
});
