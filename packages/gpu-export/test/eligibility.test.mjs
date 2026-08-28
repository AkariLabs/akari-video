import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../../render-cut/src/captions.mjs";
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

test("v2 word styles are native while plain words remain a caption sprite", () => {
  const word = { text: "x", start: 0, end: 1 };
  const captions = ["karaoke", "pop", "reveal", "reveal-word"].map((style) => ({
    id: style, start: 0, end: 1, text: "x", style, words: [word],
  }));
  captions.push({ id: "plain", start: 0, end: 1, text: "x", words: [word] });
  const result = evaluate([], captions);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.entries.map((entry) => entry.reason), [
    "words-native", "words-native", "words-native", "words-native", "caption-sprite",
  ]);
});

test("unknown word style and unsupported caption motion fail closed", () => {
  const result = evaluate([], [
    { id: "style", start: 0, end: 1, text: "x", style: "future" },
    { id: "motion", start: 0, end: 1, text: "x", text_style: { animation: { in: { id: "wipe-left" } } } },
  ]);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.entries.map((entry) => entry.reason), [
    "caption-style-unsupported:future", "caption-motion-wipe-left-unsupported",
  ]);
});

test("malformed emphasis is ignored like captions.mjs normalization", () => {
  const result = evaluate([], [{ id: "caption", start: 0, end: 1, text: "x" }], {
    emphasisWords: [{ text: "x" }],
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.entries.map((entry) => entry.reason), ["caption-sprite"]);
});

test("karaoke mixed with one-char-bang emphasis fails closed", () => {
  const result = evaluate([], [{
    id: "mixed", start: 0, end: 2, text: "xy", style: "karaoke",
    words: [{ text: "x", start: 0, end: 1 }, { text: "y", start: 1, end: 2 }],
  }], { emphasisWords: [{ id: "e-0001", t_start: 0, t_end: 1, word: "x", emotion: "pain" }] });
  assert.equal(result.eligible, false);
  assert.equal(result.entries[0].reason, "words-native-color-and-geometry-mixed");
});

test("portrait promotion agrees with the canonical caption DOM output", () => {
  const cue = {
    id: "c-0001", start: 0, end: 2, text: "これは十分に長い縦長字幕です",
    words: [{ text: "これは十分に長い縦長字幕です", start: 0, end: 2 }],
  };
  const output = { width: 1080, height: 1920 };
  const eligibility = evaluateGpuEligibility({ edit: { overlays: [], output }, captions: [cue] });
  const [overlay] = generateCaptionOverlays([cue], [], { output });
  assert.equal(eligibility.entries[0].reason, "words-native");
  assert.match(overlay.html, /akari-caption__reveal-group/u);
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
