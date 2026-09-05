import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FALLBACK_REASONS } from "../../gpu-export/src/index.mjs";

import {
  assertGpuEligibility,
  readForceGpu,
  RefusalError,
  renderProject,
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

test("GPU eligibility refusal keeps the legacy message byte-for-byte without force", () => {
  assert.throws(
    () => assertGpuEligibility("gpu", {
      eligible: false,
      entries: [{ classification: "degraded", kind: "overlay", id: "o1", reason: "script" }],
      summary: { degraded: 1, unsupported: 0 },
    }),
    (error) => error instanceof RefusalError
      && error.message === "GPU export is ineligible: overlay:o1:script",
  );
});

test("explicit gpu accepts degraded-only eligibility when force is enabled", () => {
  assert.doesNotThrow(() => assertGpuEligibility("gpu", {
    eligible: false,
    entries: [{ classification: "dom", kind: "overlay", id: "o1", reason: "forced-dom:script", forced: true }],
    summary: { degraded: 1, unsupported: 0, forced: 1 },
  }, { force: true }));
});

test("explicit gpu still rejects unsupported entries when force is enabled", () => {
  assert.throws(
    () => assertGpuEligibility("gpu", {
      eligible: false,
      entries: [{ classification: "unsupported", kind: "caption", id: "c1", reason: "motion" }],
      summary: { degraded: 0, unsupported: 1, forced: 0 },
    }, { force: true }),
    (error) => error instanceof RefusalError
      && error.message === "GPU export is ineligible: caption:c1:motion（AKARI_FORCE_GPU は degraded のみ対象）",
  );
});

test("readForceGpu accepts only the exact string 1", () => {
  assert.equal(readForceGpu({ AKARI_FORCE_GPU: "1" }), true);
  assert.equal(readForceGpu({}), false);
  assert.equal(readForceGpu({ AKARI_FORCE_GPU: "0" }), false);
  assert.equal(readForceGpu({ AKARI_FORCE_GPU: "true" }), false);
});

test("renderProject stamps only an explicit GPU eligibility bypass and leaves auto on OSR", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-force-gpu-"));
  try {
    await mkdir(join(root, ".akari"));
    await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    await writeFile(join(root, "overlay.html"), "<iframe></iframe>");
    await writeFile(join(root, "source.mp4"), "fixture");
    await writeFile(join(root, "edit.json"), JSON.stringify({
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "unused", path: "source.mp4" }],
      tracks: [{
        id: "overlay-track",
        lane: "visual",
        items: [{ id: "forced-overlay", at: 0, duration: 30, source: { kind: "html", path: "overlay.html" } }],
      }],
    }));
    const errors = [];
    const env = { ...process.env, AKARI_FORCE_GPU: "1" };
    const forced = await renderProject(root, {
      planOnly: true,
      engine: "gpu",
      env,
      probeMediaImpl: () => ({
        streams: [{ codec_type: "video", width: 320, height: 180, avg_frame_rate: "30/1", pix_fmt: "yuv420p" }],
        format: { duration: "1" },
      }),
    }, { error: (line) => errors.push(line) });
    assert.equal(forced.gpu_forced, true);
    assert.equal(forced.provenance.engine, "gpu");
    assert.deepEqual(errors, [
      "[force-gpu] 適格性を迂回しました（検証用・納品不可）: overlay:forced-overlay:forced-dom:embedded-context",
    ]);
    const recorded = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(recorded.gpu_forced, true);
    assert.match(await readFile(join(root, ".akari", "reports", "render-report.html"), "utf8"), /検証用（GPU 強制）/u);

    errors.length = 0;
    const automatic = await renderProject(root, {
      planOnly: true,
      writeState: false,
      engine: "auto",
      env,
      probeMediaImpl: () => ({
        streams: [{ codec_type: "video", width: 320, height: 180, avg_frame_rate: "30/1", pix_fmt: "yuv420p" }],
        format: { duration: "1" },
      }),
    }, { error: (line) => errors.push(line) });
    assert.equal(Object.hasOwn(automatic, "gpu_forced"), false);
    assert.equal(automatic.provenance.engine, "osr");
    assert.deepEqual(errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
