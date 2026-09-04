import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";

const FIXTURE_ROOT = join(import.meta.dirname, "fixtures", "css-3d");

function evaluate(html) {
  return evaluateGpuEligibility({
    edit: { output: {}, overlays: [{ id: "css-3d", html }] },
    captions: [],
  }).entries[0];
}

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
  return { source, value: window.__akariGpuDomInternals };
}

test("CSS 3D spike fixtures have the measured eligibility classifications", async () => {
  const expected = new Map([
    ["a-perspective-rotatey.html", "degraded"],
    ["b-preserve-3d-cloud.html", "dom"],
    ["c-pillar-forest.html", "dom"],
    ["d-translatez-telop.html", "dom"],
    ["e-translatez-only.html", "dom"],
    ["f-perspective-only-2d.html", "dom"],
    ["g-2d-baseline.html", "dom"],
    ["h-backface-control.html", "dom"],
  ]);
  for (const [file, classification] of expected) {
    const entry = evaluate(await readFile(join(FIXTURE_ROOT, file), "utf8"));
    assert.equal(entry.classification, classification, basename(file));
    if (classification === "dom") assert.equal(entry.reason, "dom-layer-draw-element", basename(file));
    if (file === "g-2d-baseline.html") assert.deepEqual(entry.conditions, ["animation-timing"]);
    if (file === "a-perspective-rotatey.html") {
      assert.ok(entry.conditions.includes("css-3d-backface-hidden"));
      assert.match(entry.reason, /css-3d-backface-hidden/u);
    }
  }
});

test("backface hidden without a depth transform does not degrade 2D HTML", () => {
  const entry = evaluate("<style>.x{backface-visibility:hidden;transform:rotate(5deg)}</style><div class=x></div>");
  assert.equal(entry.classification, "same");
  assert.ok(!entry.conditions.includes("css-3d-backface-hidden"));
});

test("literal zero translate3d keeps the issue 34 static exception", () => {
  const entry = evaluate("<style>.x{transform:translate3d(var(--x),calc(1px + 2px),0)}</style><div class=x></div>");
  assert.equal(entry.classification, "same");
  assert.deepEqual(entry.conditions, []);
});

test("perspective rotateX matrix3d and nonzero translateZ geometry use the DOM layer", () => {
  for (const declaration of [
    "perspective:900px",
    "transform:rotateX(20deg)",
    "transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,20,1)",
    "transform:translateZ(20px)",
  ]) {
    const entry = evaluate(`<style>.x{${declaration}}</style><div class=x></div>`);
    assert.equal(entry.classification, "dom", declaration);
    assert.equal(entry.reason, "dom-layer-draw-element", declaration);
    assert.ok(entry.conditions.includes("css-3d-transform"), declaration);
  }
});

test("preserve-3d alone uses the DOM layer", () => {
  const entry = evaluate("<style>.x{transform-style:preserve-3d}</style><div class=x></div>");
  assert.equal(entry.classification, "dom");
  assert.equal(entry.reason, "dom-layer-draw-element");
});

test("preserve-3d conflict detector finds an intersecting reversed Z pair", async () => {
  const { value } = await internals();
  const conflicts = value.detectPreserve3dOrderConflicts([
    { id: "0", label: "div.front:1", ancestors: [], rect: { x: 0, y: 0, width: 100, height: 100 }, z: 20, paints: true },
    { id: "0/0", label: "div.back:1", ancestors: ["0"], rect: { x: 50, y: 50, width: 100, height: 100 }, z: 0, paints: true },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(conflicts)), [{ front: "div.front:1", back: "div.back:1" }]);
});

test("preserve-3d conflict detector ignores reversed-Z siblings", async () => {
  const { value } = await internals();
  const conflicts = value.detectPreserve3dOrderConflicts([
    { id: "0/0", label: "div.front:1", ancestors: ["0"], rect: { x: 0, y: 0, width: 100, height: 100 }, z: 430, paints: true },
    { id: "0/1", label: "div.back:2", ancestors: ["0"], rect: { x: 10, y: 10, width: 80, height: 80 }, z: -430, paints: true },
  ]);
  assert.equal(conflicts.length, 0);
});

test("preserve-3d conflict detector ignores nonintersecting elements", async () => {
  const { value } = await internals();
  const conflicts = value.detectPreserve3dOrderConflicts([
    { id: "0", label: "a", ancestors: [], rect: { x: 0, y: 0, width: 10, height: 10 }, z: 20, paints: true },
    { id: "0/0", label: "b", ancestors: ["0"], rect: { x: 20, y: 20, width: 10, height: 10 }, z: 0, paints: true },
  ]);
  assert.equal(conflicts.length, 0);
});

test("preserve-3d conflict detector accepts DOM order matching Z order", async () => {
  const { value } = await internals();
  const conflicts = value.detectPreserve3dOrderConflicts([
    { id: "0", label: "back", ancestors: [], rect: { x: 0, y: 0, width: 10, height: 10 }, z: 0, paints: true },
    { id: "0/0", label: "front", ancestors: ["0"], rect: { x: 0, y: 0, width: 10, height: 10 }, z: 20, paints: true },
  ]);
  assert.equal(conflicts.length, 0);
});

test("preserve-3d conflict detector ignores non-painting elements", async () => {
  const { value } = await internals();
  const conflicts = value.detectPreserve3dOrderConflicts([
    { id: "0", label: "wrapper", ancestors: [], rect: { x: 0, y: 0, width: 10, height: 10 }, z: 20, paints: false },
    { id: "0/0", label: "paint", ancestors: ["0"], rect: { x: 0, y: 0, width: 10, height: 10 }, z: 0, paints: true },
  ]);
  assert.equal(conflicts.length, 0);
});

test("Three entrances keep backface-hidden fail-closed while composite handles CSS 3D geometry", () => {
  const entry = evaluate(`
    <style>
      .scene { perspective: 900px; }
      .card { backface-visibility: hidden; transform: rotateY(180deg); animation: turn 1s linear; }
      @keyframes turn { to { transform: rotateY(0deg); } }
    </style>
    <div class="scene"><canvas></canvas><div class="card"></div></div>
    <script type="application/json" data-akari-3d-scene>{}</script>
  `);
  assert.equal(entry.classification, "degraded");
  assert.equal(entry.reason, "css-3d-backface-hidden");
  assert.ok(entry.conditions.includes("css-3d-backface-hidden"));
});

test("DOM layer schedules five preserve-3d samples and reports conflicts in its summary", async () => {
  const { source, value } = await internals();
  assert.equal(typeof value.preserve3dSampleTimes, "function");
  const start = 2;
  const duration = 4;
  const times = [...value.preserve3dSampleTimes(start, duration)];
  assert.equal(times.length, 5);
  assert.equal(times[0], start);
  assert.ok(times.every((seconds) => seconds >= start && seconds < start + duration));
  assert.ok(times.slice(1).every((seconds, index) => seconds > times[index]));
  let zeroDurationTimes;
  assert.doesNotThrow(() => { zeroDurationTimes = [...value.preserve3dSampleTimes(start, 0)]; });
  assert.equal(zeroDurationTimes.length, 5);
  assert.ok(zeroDurationTimes.every((seconds) => seconds === start));
  assert.match(source, /preserve3dOrderConflicts: \[\.\.\.this\.preserve3dOrder\.values\(\)\]/u);
});
