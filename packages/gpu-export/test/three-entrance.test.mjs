import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";
import { parseThreeEntrance, scanThreeSampled } from "../src/three-entrance.mjs";

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

test("HTML comments do not alter 3D entrance script counts or extracted CSS", () => {
  const html = fragment().replace(
    '<div class="laptop-live">',
    '<!-- <script>ignored()</script><style>.bad{transition:all 1s}</style> --><div class="laptop-live">',
  );
  const parsed = parseThreeEntrance(html, { vars: { "--laptop-live-scale": "0.95" } });
  assert.equal(parsed.ok, true);
  const result = eligibility(html, { vars: { "--laptop-live-scale": "0.95" } });
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

test("3D entrance forms outside the curve grammar use computed-style sampling", () => {
  const cases = [
    ["rotate", fragment({ from: "translate(0px, 0px) rotate(12deg)" }), "three-entrance-unsupported-property:rotate"],
    ["skew", fragment({ from: "translate(0px, 0px) skew(12deg)" }), "three-entrance-unsupported-property:skew"],
    ["3D transform", fragment({ from: "translate3d(0px, 0px, 0px)" }), "three-entrance-unsupported-property:translate3d"],
    ["middle keyframe", fragment({ middle: "50% { opacity:.5; transform:translate(0px, 0px) scale(.9); }" }), "three-entrance-multi-keyframe"],
    ["iteration count", fragment({ animation: "laptop-live__enter 1.1s linear 0s 2 both" }), "three-entrance-iteration-count"],
    ["property registration", fragment({ extraCss: "@property --p { syntax:'<number>'; inherits:false; initial-value:0; }" }), "three-entrance-property"],
    ["fill omitted", fragment({ animation: "laptop-live__enter 1.1s linear 0s" }), "three-entrance-fill-mode"],
    ["multiple animations", fragment({ animation: "laptop-live__enter 1s linear both, other 1s linear both" }), "three-entrance-multiple-animation"],
    ["alternate direction", fragment({ animation: "laptop-live__enter 1s linear 0s alternate both" }), "three-entrance-alternate"],
    ["negative delay", fragment({ animation: "laptop-live__enter 1s linear -0.1s both" }), "three-entrance-delay"],
    ["wrong selector", fragment({ selectors: "[data-akari-active] .laptop-live" }), "three-entrance-selector"],
  ];
  for (const [label, html, reason] of cases) {
    assert.equal(parseThreeEntrance(html).reason, reason, label);
    const result = eligibility(html);
    assert.equal(result.entries[0].classification, "three", label);
    assert.equal(result.entries[0].reason, "three-scene-entrance-sampled", label);
  }
});

test("3D sampled entrance keeps chain CSS and animated descendants fail-closed", () => {
  const cases = [
    ["keyframe filter", fragment({ from: "translate(0px, 0px); filter:blur(1px)" }), "three-sampled-chain-css:filter"],
    ["keyframe clip path", fragment({ from: "translate(0px, 0px); clip-path:inset(0)" }), "three-sampled-chain-css:clip-path"],
    ["rule filter", fragment({ extraCss: ".laptop-live { filter:blur(1px); }" }), "three-sampled-chain-css:filter"],
    ["rule clip path", fragment({ extraCss: ".laptop-live { clip-path:inset(0); }" }), "three-sampled-chain-css:clip-path"],
    ["missing descendant", fragment({ extraCss: ".child { animation:laptop-live__enter 1s linear 0s both; }" }), "three-html-animated-descendants"],
  ];
  for (const [label, html, reason] of cases) {
    assert.deepEqual(scanThreeSampled(html), { ok: false, reason }, label);
    const result = eligibility(html);
    assert.equal(result.entries[0].classification, "degraded", label);
    assert.equal(result.entries[0].reason, reason, label);
  }
});

test("animation or transition on the canvas itself stays in the sampled chain", () => {
  const result = eligibility(fragment({ extraCss: ".laptop-live__canvas { transition:opacity 1s; }" }));
  assert.equal(result.entries[0].classification, "three");
  assert.equal(result.entries[0].reason, "three-scene-entrance-sampled");
});

test("sampled 3D entrance reports real 3D transforms as a matrix blocker", () => {
  const result = eligibility(fragment({ from: "translate(0px, 0px) rotateX(12deg)" }));
  assert.equal(result.entries[0].classification, "degraded");
  assert.equal(result.entries[0].reason, "three-entrance-3d-matrix");
});

test("sampled advanced CSS fixtures distinguish outside-chain, on-chain, and unsupported script conditions", async () => {
  const cases = [
    ["three-sampled-advanced-css-outside-chain.html", "three", "three-scene-entrance-sampled", { ok: true }],
    ["three-sampled-advanced-css-on-chain.html", "degraded", "three-sampled-chain-css:filter", { ok: false, reason: "three-sampled-chain-css:filter" }],
    ["three-sampled-no-css3d-blocked-by-script.html", "degraded", "three-sampled-condition:script-runtime", null],
  ];
  for (const [name, classification, reason, sampled] of cases) {
    const html = await readFile(join(import.meta.dirname, "fixtures", name), "utf8");
    const result = eligibility(html);
    assert.equal(result.entries[0].classification, classification, name);
    assert.equal(result.entries[0].reason, reason, name);
    if (sampled !== null) assert.deepEqual(scanThreeSampled(html), sampled, name);
  }
});

test("sampled candidates report unsupported conditions instead of curve-parser reasons", () => {
  const html = fragment().replace(
    '<script type="application/json"',
    '<video></video><script type="application/json"',
  );
  const result = eligibility(html);
  assert.equal(result.entries[0].classification, "degraded");
  assert.equal(result.entries[0].reason, "three-sampled-condition:media-element");
  assert.equal(result.entries[0].reason.startsWith("three-entrance-"), false);
});

test("sampled chain CSS detects inline declarations in document order", () => {
  const html = fragment().replace(
    '<div class="laptop-live">',
    '<div class="laptop-live" style="filter: blur(1px)">',
  );
  assert.deepEqual(scanThreeSampled(html), { ok: false, reason: "three-sampled-chain-css:filter" });
  const result = eligibility(html);
  assert.equal(result.entries[0].classification, "degraded");
  assert.equal(result.entries[0].reason, "three-sampled-chain-css:filter");
});

test("sampled 3D fixtures classify supported forms, a canvas-ancestor wrapper, the classic curve, and siblings", async (t) => {
  const cases = [
    ["three-sampled-root-without-class.html", "three", "three-scene-entrance-sampled"],
    ["three-sampled-advanced-css-outside-chain.html", "three", "three-scene-entrance-sampled"],
    ["three-sampled-advanced-css-on-chain.html", "degraded", "three-sampled-chain-css:filter"],
    ["three-sampled-no-css3d-blocked-by-script.html", "degraded", "three-sampled-condition:script-runtime"],
    ["three-sampled-middle-keyframe.html", "three", "three-scene-entrance-sampled"],
    ["three-sampled-multiple-animation.html", "three", "three-scene-entrance-sampled"],
    ["three-sampled-transition.html", "three", "three-scene-entrance-sampled"],
    ["three-sampled-property.html", "three", "three-scene-entrance-sampled"],
    ["three-sampled-chain-wrapper.html", "three", "three-scene-entrance-sampled"],
    ["three-curve-classic.html", "three", "three-scene-entrance-curve"],
    ["three-sampled-animated-descendant.html", "degraded", "three-html-animated-descendants"],
  ];
  for (const [name, classification, reason] of cases) {
    await t.test(name, async () => {
      const html = await readFile(join(import.meta.dirname, "fixtures", name), "utf8");
      const result = eligibility(html);
      assert.equal(result.entries[0].classification, classification);
      assert.equal(result.entries[0].reason, reason);
      if (reason === "three-scene-entrance-sampled") assert.equal(scanThreeSampled(html).ok, true);
    });
  }
});

test("sampled scanning requires a well-formed root-to-canvas chain", () => {
  const noCanvas = fragment().replace(/<canvas[\s\S]*?<\/canvas>/u, "");
  assert.deepEqual(scanThreeSampled(noCanvas), { ok: false, reason: "three-entrance-canvas-missing" });
  const malformed = fragment().replace("</div>", "</section>");
  assert.deepEqual(scanThreeSampled(malformed), { ok: false, reason: "three-html-animated-descendants" });
});

test("sampled matrix helpers convert centered axis-aligned transforms and reject real 3D", async () => {
  const internals = await runtimeInternals();
  const identity3d = { m13: 0, m14: 0, m23: 0, m24: 0, m31: 0, m32: 0, m34: 0, m43: 0, m33: 1, m44: 1 };
  const matrix = { ...identity3d, a: 0.817, b: 0, c: 0, d: 0.817, e: -204.32, f: 238.82 };
  assert.equal(internals.isSupported2DMatrix(identity3d), true);
  const state = internals.sampledDrawStateFromMatrix(matrix, 1920, 1080);
  assert.equal(state.scaleX, 0.817);
  assert.equal(state.scaleY, 0.817);
  assert.ok(Math.abs(state.translateX + 380) <= 1e-9);
  assert.ok(Math.abs(state.translateY - 140) <= 1e-9);
  assert.equal(internals.isSupported2DMatrix({ ...identity3d, m34: -0.01 }), false);
  assert.equal(internals.boxMatchesFrame({ x: 0.4, y: -0.4, width: 1920.5, height: 1079.5 }, 1920, 1080), true);
  assert.equal(internals.boxMatchesFrame({ x: 100, y: 30, width: 120, height: 120 }, 1920, 1080), false);
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
    { z: 0, index: 0, id: "animated", opacity: 0, translateX: -380, translateY: 140, scaleX: 0.817, scaleY: 0.817 },
    { z: 0, index: 1, id: "direct", opacity: 1 },
    { z: 0, index: 2, id: "static", opacity: 1 },
  ]);
  manifest.three[1].entranceMode = "sampled";
  const sampled = internals.orderedSpriteDraws(
    manifest,
    1,
    { activeAt() { return false; } },
    new Map([["direct", { opacity: 0.4, translateX: 12, scaleX: 0.9 }]]),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sampled[1])), {
    z: 0, index: 1, id: "direct", opacity: 0.4, translateX: 12, scaleX: 0.9,
  });
});
