import assert from "node:assert/strict";
import test from "node:test";

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
