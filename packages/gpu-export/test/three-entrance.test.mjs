import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";
import { parseThreeEntrance } from "../src/three-entrance.mjs";

const ROOTS = {
  "3d-lap-intro": {
    root: "laptop-live",
    from: "translate(calc(var(--laptop-live-x, 0px) + -380px), calc(var(--laptop-live-y, 0px) + 140px)) scale(calc(var(--laptop-live-scale, 1) * 0.86))",
    to: "translate(var(--laptop-live-x, 0px), var(--laptop-live-y, 0px)) scale(var(--laptop-live-scale, 1))",
    vars: { "--laptop-live-scale": "0.95" },
  },
  "3d-phone-intro": {
    root: "phone-live",
    from: "translate(calc(var(--phone-live-x, 0px) + 340px), calc(var(--phone-live-y, 0px) + 160px)) scale(calc(var(--phone-live-scale, 1) * 0.88))",
    to: "translate(var(--phone-live-x, 0px), var(--phone-live-y, 0px)) scale(var(--phone-live-scale, 1))",
    vars: { "--phone-live-scale": "1.0" },
  },
  "3d-icon-store": {
    root: "icon-live",
    from: "translate(calc(var(--icon-live-x, 0px) + 0px), calc(var(--icon-live-y, 0px) + 180px)) scale(calc(var(--icon-live-scale, 1) * 0.80))",
    to: "translate(var(--icon-live-x, 0px), var(--icon-live-y, 0px)) scale(var(--icon-live-scale, 1))",
    vars: { "--icon-live-scale": "0.85", "--icon-live-y": "30px" },
  },
};

function fragment({
  root = "laptop-live",
  animation = `${root}__enter 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.05s both`,
  from = "translate(calc(var(--laptop-live-x, 0px) + -380px), calc(var(--laptop-live-y, 0px) + 140px)) scale(calc(var(--laptop-live-scale, 1) * 0.86))",
  to = "translate(var(--laptop-live-x, 0px), var(--laptop-live-y, 0px)) scale(var(--laptop-live-scale, 1))",
  extraCss = "",
  middle = "",
  selectors = `[data-akari-active] .${root}, [data-no-timeline] .${root}`,
} = {}) {
  return `<div class="${root}">
    <style>
      .${root} { position:absolute; inset:0; opacity:0; transform:${to}; transform-origin:center; }
      .${root}__canvas { position:absolute; inset:0; }
      .${root}__fallback { position:absolute; inset:0; }
      ${selectors} { animation:${animation}; }
      ${extraCss}
      @keyframes ${root}__enter {
        from { opacity:0; transform:${from}; }
        ${middle}
        to { opacity:1; transform:${to}; }
      }
    </style>
    <canvas class="${root}__canvas"></canvas>
    <div class="${root}__fallback" data-akari-3d-fallback></div>
    <script type="application/json" data-akari-3d-scene>{}</script>
  </div>`;
}

function eligibility(html, extra = {}) {
  return evaluateGpuEligibility({ edit: { overlays: [{ id: "three", html, ...extra }], output: {} } });
}

async function runtimeInternals() {
  const frameEngineSource = await readFile(join(import.meta.dirname, "..", "generated", "frame-engine.js"), "utf8");
  const frameEngineContext = { console, TextEncoder, TextDecoder, URL, Blob, performance };
  vm.runInNewContext(frameEngineSource, frameEngineContext);
  const runtimeSource = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const window = {
    __AKARI_GPU_CONFIG__: {},
    AkariFrameEngine: frameEngineContext.AkariFrameEngine,
    akariGpu: null,
  };
  class FakeMessageChannel {
    constructor() {
      this.port1 = {};
      this.port2 = { postMessage() {} };
    }
  }
  vm.runInNewContext(runtimeSource, {
    window, MessageChannel: FakeMessageChannel, console, setTimeout, clearTimeout, performance,
  });
  return window.__akariGpuDomInternals;
}

test("the product-shaped entrance is eligible and resolves CSS variables to absolute endpoints", () => {
  const html = fragment();
  const parsed = parseThreeEntrance(html, { vars: { "--laptop-live-scale": "0.95" } });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entrance, {
    durationSec: 1.1,
    delaySec: 0.05,
    timing: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
    fill: "both",
    from: { opacity: 0, tx: -380, ty: 140, sx: 0.817, sy: 0.817 },
    to: { opacity: 1, tx: 0, ty: 0, sx: 0.95, sy: 0.95 },
  });
  const result = eligibility(html, { vars: { "--laptop-live-scale": "0.95" } });
  assert.equal(result.eligible, true);
  assert.equal(result.entries[0].classification, "three");
  assert.equal(result.entries[0].reason, "three-scene-entrance-curve");
});

test("transform x/y/scale variables and known timing keywords are supported", () => {
  const html = fragment({
    root: "model-live",
    animation: "model-live__enter 500ms ease-in-out 0s forwards",
    from: "translate(var(--model-live-x), var(--model-live-y)) scale(var(--model-live-scale))",
    to: "translate(0px 0px) scale(1 1)",
  });
  const parsed = parseThreeEntrance(html, { transform: { x: 12, y: -4, scale: 1.25 } });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entrance.from, { opacity: 0, tx: 12, ty: -4, sx: 1.25, sy: 1.25 });
  assert.deepEqual(parsed.entrance.timing, { x1: 0.42, y1: 0, x2: 0.58, y2: 1 });
});

test("3D entrance eligibility fails closed with a concrete condition", () => {
  const cases = [
    ["rotate", fragment({ from: "translate(0px, 0px) rotate(12deg)" }), "three-entrance-unsupported-property:rotate"],
    ["skew", fragment({ from: "translate(0px, 0px) skew(12deg)" }), "three-entrance-unsupported-property:skew"],
    ["3D transform", fragment({ from: "translate3d(0px, 0px, 0px)" }), "three-entrance-unsupported-property:translate3d"],
    ["filter", fragment({ from: "translate(0px, 0px); filter:blur(1px)" }), "three-entrance-unsupported-property:filter"],
    ["clip path", fragment({ from: "translate(0px, 0px); clip-path:inset(0)" }), "three-entrance-unsupported-property:clip-path"],
    ["middle keyframe", fragment({ middle: "50% { opacity:.5; transform:translate(0px, 0px) scale(.9); }" }), "three-entrance-multi-keyframe"],
    ["second animated element", fragment({ extraCss: ".child { animation:laptop-live__enter 1s linear 0s both; }" }), "three-entrance-multi-animated-element"],
    ["iteration count", fragment({ animation: "laptop-live__enter 1.1s linear 0s 2 both" }), "three-entrance-iteration-count"],
    ["transition", fragment({ extraCss: ".laptop-live__canvas { transition:opacity 1s; }" }), "three-entrance-transition"],
    ["property registration", fragment({ extraCss: "@property --p { syntax:'<number>'; inherits:false; initial-value:0; }" }), "three-entrance-property"],
    ["fill omitted", fragment({ animation: "laptop-live__enter 1.1s linear 0s" }), "three-entrance-fill-mode"],
    ["multiple animations", fragment({ animation: "laptop-live__enter 1s linear both, other 1s linear both" }), "three-entrance-multiple-animation"],
    ["alternate direction", fragment({ animation: "laptop-live__enter 1s linear 0s alternate both" }), "three-entrance-alternate"],
    ["negative delay", fragment({ animation: "laptop-live__enter 1s linear -0.1s both" }), "three-entrance-delay"],
    ["wrong selector", fragment({ selectors: "[data-akari-active] .laptop-live" }), "three-entrance-selector"],
  ];
  for (const [label, html, reason] of cases) {
    const result = eligibility(html);
    assert.equal(result.entries[0].classification, "degraded", label);
    assert.equal(result.entries[0].reason, reason, label);
  }
});

test("parsed curves reproduce Chrome getComputedStyle ground truth at five local times", async () => {
  const truth = JSON.parse(await readFile(join(import.meta.dirname, "fixtures", "three-entrance-ground-truth.json"), "utf8"));
  const internals = await runtimeInternals();
  const entrances = new Map(Object.entries(ROOTS).map(([id, fixture]) => {
    const parsed = parseThreeEntrance(fragment(fixture), { vars: fixture.vars });
    assert.equal(parsed.ok, true, id);
    return [id, parsed.entrance];
  }));
  for (const expected of truth) {
    const state = internals.threeEntranceStateAt(entrances.get(expected.id), expected.local);
    assert.ok(Math.abs(state.opacity - expected.opacity) <= 0.005, `${expected.id}@${expected.local}: opacity`);
    assert.ok(Math.abs(state.translateX - expected.tx) <= 0.5, `${expected.id}@${expected.local}: tx`);
    assert.ok(Math.abs(state.translateY - expected.ty) <= 0.5, `${expected.id}@${expected.local}: ty`);
    assert.ok(Math.abs(state.scaleX - expected.s) <= 0.00001, `${expected.id}@${expected.local}: sx`);
    assert.ok(Math.abs(state.scaleY - expected.s) <= 0.00001, `${expected.id}@${expected.local}: sy`);
  }
});

test("ordered draws add entrance state only to entrance-enabled 3D sprites", async () => {
  const parsed = parseThreeEntrance(fragment(), { vars: { "--laptop-live-scale": "0.95" } });
  const internals = await runtimeInternals();
  const manifest = {
    statics: [{ id: "static", index: 2, start: 0, duration: 4 }],
    three: [
      { id: "animated", index: 0, start: 1, duration: 3, entrance: parsed.entrance },
      { id: "direct", index: 1, start: 0, duration: 4 },
    ],
    dom: [],
  };
  const draws = internals.orderedSpriteDraws(manifest, 1, { activeAt() { return false; } });
  assert.deepEqual(JSON.parse(JSON.stringify(draws)), [
    { id: "animated", opacity: 0, translateX: -380, translateY: 140, scaleX: 0.817, scaleY: 0.817 },
    { id: "direct", opacity: 1 },
    { id: "static", opacity: 1 },
  ]);
});
