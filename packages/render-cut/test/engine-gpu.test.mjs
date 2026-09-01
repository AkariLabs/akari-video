import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_REASONS } from "../../gpu-export/src/index.mjs";

import {
  assertGpuEligibility,
  RefusalError,
  runGpuWithRuntimeFallback,
} from "../src/render-cut.mjs";

test("auto falls back from a recognized GPU runtime failure to OSR", async () => {
  const error = new Error("GPU unavailable");
  error.reasonCode = FALLBACK_REASONS[0];
  const result = await runGpuWithRuntimeFallback({
    engineRequested: "auto",
    runGpu: async () => { throw error; },
    runOsr: async () => ({ receipt: { engine: "osr" } }),
  });
  assert.equal(result.engine, "osr");
  assert.deepEqual(result.result.receipt, { engine: "osr" });
  assert.equal(result.fallback.from, "gpu");
});

test("explicit gpu remains fail-closed", async () => {
  const error = new Error("GPU unavailable");
  error.code = "GPU_DEVICE_UNAVAILABLE";
  await assert.rejects(
    runGpuWithRuntimeFallback({
      engineRequested: "gpu",
      runGpu: async () => { throw error; },
      runOsr: async () => assert.fail("must not run"),
    }),
    error,
  );
});

test("explicit gpu rejects an ineligible project", () => {
  assert.throws(
    () => assertGpuEligibility("gpu", {
      eligible: false,
      entries: [{ classification: "unsupported", kind: "overlay", id: "o1", reason: "script" }],
    }),
    RefusalError,
  );
});
