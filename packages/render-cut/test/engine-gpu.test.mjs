import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGpuEligibility } from "../../gpu-export/src/eligibility.mjs";
import { buildGpuReceipt } from "../../gpu-export/src/receipt.mjs";
import {
  RefusalError,
  assertGpuEligibility,
  parseArguments,
  resolveEngineChoice,
  selectRenderEngineExecution,
} from "../src/render-cut.mjs";

test("render-cut parses explicit GPU engine", () => {
  assert.equal(parseArguments(["/project", "--engine", "gpu"]).engine, "gpu");
  assert.equal(parseArguments(["/project", "--engine=gpu"]).engine, "gpu");
});

test("auto selects GPU only for eligible darwin projects", () => {
  assert.equal(resolveEngineChoice("auto", "darwin", { eligible: true }), "gpu");
  assert.equal(resolveEngineChoice("auto", "darwin", { eligible: false }), "osr");
  assert.equal(resolveEngineChoice("auto", "linux", { eligible: true }), "legacy");
  assert.equal(resolveEngineChoice("auto", "darwin"), "osr");
});

test("GPU execution disables every legacy compositing branch", () => {
  assert.deepEqual(selectRenderEngineExecution("gpu", { tier: 2 }), {
    useOsr: false,
    useGpu: true,
    engine: "gpu",
    engineFallback: undefined,
    runLegacyTrackStack: false,
    runLegacyLayers: false,
    runLegacyRasterize: false,
  });
});

test("explicit GPU is fail-closed when eligibility fails", () => {
  assert.throws(() => assertGpuEligibility("gpu", {
    eligible: false,
    entries: [{ kind: "overlay", id: "animated", classification: "degraded", reason: "animation-timing" }],
  }), (error) => error instanceof RefusalError && /overlay:animated:animation-timing/.test(error.message));
  assert.doesNotThrow(() => assertGpuEligibility("auto", { eligible: false, entries: [] }));
});

test("DOM-layer eligibility remains on the GPU side of render-cut auto selection", () => {
  const eligibility = evaluateGpuEligibility({
    edit: { overlays: [{ id: "dynamic", html: "<style>.x{animation:fade 1s}@keyframes fade{to{opacity:0}}</style><div class=x></div>" }] },
  });
  assert.equal(eligibility.entries[0].classification, "dom");
  assert.equal(eligibility.eligible, true);
  assert.equal(resolveEngineChoice("auto", "darwin", eligibility), "gpu");
  assert.doesNotThrow(() => assertGpuEligibility("gpu", eligibility));
});

test("render-cut GPU provenance receipt carries the DOM-layer result", () => {
  const domLayer = { runs: 1, overlays: 1, policy: "sync-layout", sentinel: { requested: 300, matched: 300 } };
  const receipt = buildGpuReceipt({
    tier: 2,
    run: { domLayer },
    eligibility: { entries: [{ kind: "overlay", id: "dynamic", classification: "dom", reason: "dom-layer-draw-element", conditions: ["animation-timing"] }] },
  });
  assert.deepEqual(receipt.gpu.domLayer, domLayer);
  assert.equal(receipt.gpu.eligibility[0].classification, "dom");
});
