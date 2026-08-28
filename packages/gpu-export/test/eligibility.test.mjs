import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";

function evaluate(overlays, captions = [], extra = {}) {
  return evaluateGpuEligibility({ edit: { overlays, output: {} }, captions, ...extra });
}

test("static HTML is same and eligible", () => {
  const result = evaluate([{ id: "static", html: "<div>hello</div>" }]);
  assert.equal(result.eligible, true);
  assert.equal(result.entries[0].classification, "same");
  assert.deepEqual(result.summary, { same: 1, three: 0, degraded: 0, unsupported: 0 });
});

test("a single declarative 3D scene is eligible", () => {
  const html = '<script type="application/json" data-akari-3d-scene>{"model":"x.glb"}</script>';
  const result = evaluate([{ id: "three", html }]);
  assert.equal(result.eligible, true);
  assert.equal(result.entries[0].classification, "three");
});

test("the product 3D fragment may contain its render canvas", () => {
  const html = '<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas><div data-akari-3d-fallback></div><script type="application/json" data-akari-3d-scene>{"model":"assets/visible-cube.glb"}</script></div>';
  const result = evaluate([{ id: "scene-3d", html }]);
  assert.equal(result.eligible, true);
  assert.equal(result.entries[0].classification, "three");
  assert.deepEqual(result.entries[0].conditions, ["three-or-canvas-runtime"]);
});

test("the product 3D fragment becomes degraded when CSS animation is added", () => {
  const html = '<div><style>canvas{animation:spin 1s linear}@keyframes spin{to{transform:rotate(1turn)}}</style><canvas></canvas><script data-akari-3d-scene type="application/json">{}</script></div>';
  const result = evaluate([{ id: "animated-3d", html }]);
  assert.equal(result.eligible, false);
  assert.equal(result.entries[0].classification, "degraded");
  assert.ok(result.entries[0].conditions.includes("animation-timing"));
});

test("3D rejects video and any script besides its one JSON declaration", () => {
  for (const html of [
    '<canvas></canvas><video></video><script type="application/json" data-akari-3d-scene>{}</script>',
    '<canvas></canvas><script type="application/json" data-akari-3d-scene>{}</script><script type="application/json">{}</script>',
    '<canvas></canvas><script type="application/json" data-akari-3d-scene>{}</script><script>tick()</script>',
  ]) {
    const result = evaluate([{ id: "invalid-3d", html }]);
    assert.equal(result.entries[0].classification, "degraded");
  }
});

test("dynamic and external overlays are degraded", () => {
  const result = evaluate([
    { id: "animated", html: "<style>.x{animation: a 1s}</style>" },
    { id: "external", html: '<img src="https://example.invalid/x.png">' },
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.summary.degraded, 2);
  assert.ok(result.entries[0].conditions.includes("animation-timing"));
  assert.ok(result.entries[1].conditions.includes("absolute-external-url"));
});

test("3D mixed with another runtime condition is ineligible", () => {
  const html = '<script type="application/json" data-akari-3d-scene>{}</script><style>.x{transition:all 1s}</style>';
  const result = evaluate([{ id: "mixed", html }]);
  assert.equal(result.entries[0].classification, "degraded");
});

test("karaoke, word style, emphasis, and unsupported motion fail closed", () => {
  const result = evaluate([], [
    { id: "words", words: [{ text: "x", start: 0, end: 1 }] },
    { id: "style", style: "pop" },
    { id: "motion", text_style: { animation: { in: { id: "wipe-left" } } } },
  ], { emphasisWords: [{ text: "x" }] });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.entries.map((entry) => entry.reason), [
    "karaoke-words-unsupported-in-v0",
    "word-level-style-unsupported-in-v0",
    "caption-motion-wipe-left-unsupported",
    "emphasis-words-unsupported-in-v0",
  ]);
});

test("supported caption motion remains eligible", () => {
  const result = evaluate([], [{ id: "caption", text_style: { animation: { in: { id: "zoom-pop" } } } }]);
  assert.equal(result.eligible, true);
  assert.equal(result.entries[0].classification, "same");
});

test("per-cue animation merges slots over the default style", () => {
  const result = evaluate([], [{ id: "caption", text_style: { animation: { in: { id: "fade-up" } } } }], {
    defaultTextStyle: { animation: { loop: { id: "wipe-right" } } },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.entries[0].reason, "caption-motion-wipe-right-unsupported");
});
