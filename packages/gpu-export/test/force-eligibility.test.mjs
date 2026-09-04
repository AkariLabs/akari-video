import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";

const FIXTURE_ROOT = join(import.meta.dirname, "fixtures");

const EXPECTED_FIXTURES = new Map([
  ["css-3d/a-perspective-rotatey.html", ["degraded", "css-3d-transform, css-3d-backface-hidden, animation-timing", ["css-3d-transform", "css-3d-backface-hidden", "animation-timing"]]],
  ["css-3d/b-preserve-3d-cloud.html", ["dom", "dom-layer-draw-element", ["css-3d-transform", "animation-timing"]]],
  ["css-3d/c-pillar-forest.html", ["dom", "dom-layer-draw-element", ["css-3d-transform", "animation-timing"]]],
  ["css-3d/d-translatez-telop.html", ["dom", "dom-layer-draw-element", ["css-3d-transform", "animation-timing", "advanced-css"]]],
  ["css-3d/e-translatez-only.html", ["dom", "dom-layer-draw-element", ["css-3d-transform", "animation-timing"]]],
  ["css-3d/f-perspective-only-2d.html", ["dom", "dom-layer-draw-element", ["css-3d-transform", "animation-timing"]]],
  ["css-3d/g-2d-baseline.html", ["dom", "dom-layer-draw-element", ["animation-timing"]]],
  ["css-3d/h-backface-control.html", ["dom", "dom-layer-draw-element", ["css-3d-transform", "animation-timing"]]],
  ["three-curve-classic.html", ["three", "three-scene-entrance-curve", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-advanced-css-on-chain.html", ["degraded", "three-sampled-condition:advanced-css", ["three-or-canvas-runtime", "animation-timing", "advanced-css"]]],
  ["three-sampled-advanced-css-outside-chain.html", ["degraded", "three-sampled-condition:advanced-css", ["three-or-canvas-runtime", "animation-timing", "advanced-css"]]],
  ["three-sampled-animated-descendant.html", ["degraded", "three-html-animated-descendants", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-chain-wrapper.html", ["three", "three-scene-entrance-sampled", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-middle-keyframe.html", ["three", "three-scene-entrance-sampled", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-multiple-animation.html", ["three", "three-scene-entrance-sampled", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-no-css3d-blocked-by-script.html", ["degraded", "three-sampled-condition:script-runtime,advanced-css", ["three-or-canvas-runtime", "script-runtime", "animation-timing", "advanced-css"]]],
  ["three-sampled-property.html", ["three", "three-scene-entrance-sampled", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-root-without-class.html", ["three", "three-scene-entrance-sampled", ["three-or-canvas-runtime", "animation-timing"]]],
  ["three-sampled-transition.html", ["three", "three-scene-entrance-sampled", ["three-or-canvas-runtime", "animation-timing"]]],
]);

test("forceDegraded routes both measured degraded fixtures through DOM while preserving eligibility truth", async () => {
  const overlays = await Promise.all([
    ["three", "three-sampled-animated-descendant.html"],
    ["css-3d", "css-3d/a-perspective-rotatey.html"],
  ].map(async ([id, file]) => ({ id, html: await readFile(join(FIXTURE_ROOT, file), "utf8") })));
  const result = evaluateGpuEligibility({
    edit: { output: {}, overlays },
    forceDegraded: true,
  });

  assert.deepEqual(result.entries.map((entry) => entry.classification), ["dom", "dom"]);
  assert.deepEqual(result.entries.map((entry) => entry.reason), [
    "forced-dom:three-html-animated-descendants",
    "forced-dom:css-3d-transform, css-3d-backface-hidden, animation-timing",
  ]);
  assert.deepEqual(result.entries.map((entry) => entry.forced), [true, true]);
  assert.equal(result.summary.forced, 2);
  assert.equal(result.summary.dom, 2);
  assert.equal(result.summary.degraded, 2);
  assert.equal(result.eligible, false);
});

test("default eligibility output remains deep-equal to every measured HTML fixture baseline", async () => {
  const fixturePaths = await listHtmlFixtures(FIXTURE_ROOT);
  assert.deepEqual(fixturePaths.map((path) => relative(FIXTURE_ROOT, path).split("\\").join("/")), [...EXPECTED_FIXTURES.keys()]);

  for (const path of fixturePaths) {
    const name = relative(FIXTURE_ROOT, path).split("\\").join("/");
    const [classification, reason, conditions] = EXPECTED_FIXTURES.get(name);
    const summary = { same: 0, three: 0, dom: 0, degraded: 0, unsupported: 0 };
    summary[classification] = 1;
    const expected = {
      eligible: classification !== "degraded" && classification !== "unsupported",
      entries: [{ kind: "overlay", id: "fixture", classification, reason, conditions }],
      summary,
    };
    const actual = evaluateGpuEligibility({
      edit: { output: {}, overlays: [{ id: "fixture", html: await readFile(path, "utf8") }] },
    });
    assert.deepEqual(actual, expected, name);
    assert.equal(Object.hasOwn(actual.summary, "forced"), false, name);
  }
});

async function listHtmlFixtures(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listHtmlFixtures(path));
    else if (entry.name.endsWith(".html")) paths.push(path);
  }
  return paths.sort();
}
