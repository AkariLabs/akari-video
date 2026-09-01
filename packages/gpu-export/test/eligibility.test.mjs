import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../../render-cut/src/captions.mjs";
import { evaluateGpuEligibility } from "../src/eligibility.mjs";

function evaluate(overlays, captions = [], extra = {}) {
  return evaluateGpuEligibility({ edit: { overlays, output: {} }, captions, ...extra });
}

test('region filter layers remain GPU eligible', () => {
  const result = evaluateGpuEligibility({
    edit: { output:{}, overlays:[], layers:[{ id:'region', kind:'filter', t:0, duration:1, filter:{type:'invert'} }] },
    captions:[],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.summary.unsupported, 0);
});

test("static HTML is same and eligible", () => {
  const result = evaluate([{ id: "static", html: "<div>hello</div>" }]);
  assert.equal(result.eligible, true);
  assert.equal(result.entries[0].classification, "same");
  assert.deepEqual(result.summary, { same: 1, three: 0, dom: 0, degraded: 0, unsupported: 0 });
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

test("declarative dynamic overlays use the DOM layer while external overlays remain degraded", () => {
  const result = evaluate([
    { id: "animated", html: "<style>.x{animation: a 1s}</style>" },
    { id: "external", html: '<img src="https://example.invalid/x.png">' },
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.summary.dom, 1);
  assert.equal(result.summary.degraded, 1);
  assert.equal(result.entries[0].classification, "dom");
  assert.equal(result.entries[0].reason, "dom-layer-draw-element");
  assert.ok(result.entries[0].conditions.includes("animation-timing"));
  assert.ok(result.entries[1].conditions.includes("absolute-external-url"));
});

test("animation timing and advanced CSS are eligible separately and together", () => {
  const result = evaluate([
    { id: "animation", html: "<style>.x{transition:opacity 1s}</style>" },
    { id: "advanced", html: "<style>.x{backdrop-filter:blur(4px)}</style>" },
    { id: "both", html: "<style>.x{animation:a 1s;filter:blur(1px)}@keyframes a{}</style>" },
    { id: "property", html: "<style>@property --x{syntax:'<number>';inherits:false;initial-value:0}</style>" },
  ]);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.entries.map((value) => value.classification), ["dom", "dom", "dom", "dom"]);
  assert.deepEqual(result.entries[2].conditions, ["animation-timing", "advanced-css"]);
});

test("DOM layer hard blockers fail closed with stable reasons", () => {
  const fixtures = [
    ["embedded-context", "<iframe></iframe>"],
    ["css-3d-transform", "<style>.x{perspective:10px}</style>"],
    ["css-3d-transform", "<style>.x{transform:perspective(10px)}</style>"],
    ["css-3d-transform", "<style>.x{transform-style:preserve-3d}</style>"],
    ["css-3d-transform", "<style>.x{transform:rotateX(2deg)}</style>"],
    ["css-3d-transform", "<style>.x{transform:rotateY(2deg)}</style>"],
    ["css-3d-transform", "<style>.x{transform:rotate3d(1,0,0,2deg)}</style>"],
    ["css-3d-transform", "<style>.x{transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)}</style>"],
    ["css-3d-transform", "<style>.x{transform:translateZ(2px)}</style>"],
    ["css-3d-transform", "<style>.x{transform:translate3d(1px,2px,3px)}</style>"],
    ["self-driving-clock", "<script>requestAnimationFrame(step)</script>"],
    ["self-driving-clock", "<script>setTimeout(step, 1)</script>"],
    ["self-driving-clock", "<script>setInterval(step, 1)</script>"],
    ["self-driving-clock", "<script>Date.now()</script>"],
    ["self-driving-clock", "<script>performance.now()</script>"],
    ["media-element", "<video></video>"],
    ["media-element", "<audio></audio>"],
    ["three-or-canvas-runtime", "<canvas></canvas>"],
    ["script-runtime", "<script>tick()</script>"],
  ];
  for (const [condition, html] of fixtures) {
    const result = evaluate([{ id: condition, html }]);
    assert.equal(result.entries[0].classification, "degraded", html);
    assert.ok(result.entries[0].conditions.includes(condition), html);
  }
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

test("flat translate3d/translateZ and same-document url(#) references stay eligible (#33, #34)", () => {
  const same = [
    ["translate3d-zero", "<style>.x{transform:translate3d(1px,2px,0)}</style>"],
    ["translate3d-zero-px", "<style>.x{transform:translate3d(1px, 2px, 0px)}</style>"],
    ["translate3d-negative-zero", "<style>.x{transform:translate3d(1px,2px,-0.0em)}</style>"],
    ["translateZ-zero", "<style>.x{transform:translateZ(0)}</style>"],
    ["translate3d-var-xy", "<style>.x{transform:translate3d(var(--x, 10px), var(--y), 0)}</style>"],
    ["translate3d-calc-x", "<style>.x{transform:translate3d(calc(1px + 2px), 0, 0px)}</style>"],
    ["fragment-url", "<style>.x{background:url(#grad)}</style>"],
    ["inline-no-semicolon", '<span style="background: var(--tsukui, #F2B441)"></span>'
      + '<svg><defs><linearGradient id="land"></linearGradient></defs><path fill="url(#land)"/></svg>'],
  ];
  for (const [id, html] of same) {
    const result = evaluate([{ id, html }]);
    assert.equal(result.entries[0].classification, "same", html);
    assert.deepEqual(result.entries[0].conditions, [], html);
  }
  // 入場アニメーションの keyframes 内の flat translate3d は DOM 層のまま（3D 条件が付かない）
  const keyframes = evaluate([{ id: "keyframes", html: "<style>@keyframes a{from{transform:translate3d(0,0,0)}to{transform:TRANSLATE3D(0, -20px, 0)}}</style>" }]);
  assert.equal(keyframes.entries[0].classification, "dom");
  assert.deepEqual(keyframes.entries[0].conditions, ["animation-timing"]);
  const degraded = [
    ["css-3d-transform", "<style>.x{transform:translate3d(1px,2px,3px)}</style>"],
    ["css-3d-transform", "<style>.x{transform:translate3d(1px,2px,var(--z))}</style>"],
    ["css-3d-transform", "<style>.x{transform:translate3d(1px,2px)}</style>"],
    ["css-3d-transform", "<style>.x{transform:translate3d(var(--x), 0, var(--z))}</style>"],
    ["css-3d-transform", "<style>.x{transform:translate3d(calc(1px + 2px), 0, calc(0px + 1px))}</style>"],
    ["css-3d-transform", "<style>.x{transform:translateZ(var(--z, 0))}</style>"],
    ["css-3d-transform", "<style>.x{transform:translate3d(1px, 2px, 0</style>"],
    ["css-3d-transform", "<style>.x{transform:translateZ(2px)}</style>"],
    ["background-image-external-resource", "<style>.x{background-image: url(foo.png)}</style>"],
    ["background-image-external-resource", "<div style=\"background: url('assets/bg.png')\"></div>"],
  ];
  for (const [condition, html] of degraded) {
    const result = evaluate([{ id: condition, html }]);
    assert.equal(result.entries[0].classification, "degraded", html);
    assert.ok(result.entries[0].conditions.includes(condition), html);
  }
});
