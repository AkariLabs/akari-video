import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateGpuEligibility } from "../../gpu-export/src/eligibility.mjs";
import { buildGpuReceipt } from "../../gpu-export/src/receipt.mjs";
import { resolveGpuLauncher } from "../../gpu-export/src/runner.mjs";
import {
  RefusalError,
  assertGpuEligibility,
  buildEngineProvenance,
  parseArguments,
  renderProject,
  resolveEngineChoice,
  runGpuWithRuntimeFallback,
  selectRenderEngineExecution,
} from "../src/render-cut.mjs";

test("render-cut parses explicit GPU engine", () => {
  assert.equal(parseArguments(["/project", "--engine", "gpu"]).engine, "gpu");
  assert.equal(parseArguments(["/project", "--engine=gpu"]).engine, "gpu");
});

test("auto retries an allowlisted GPU runtime failure from the start with OSR", async () => {
  const calls = [];
  const error = Object.assign(new Error("caption-measure-unstable"), {
    reasonCode: "caption-measure-unstable",
    gpuFailureRunPath: ".akari/gpu-run-failed.json",
  });
  const result = await runGpuWithRuntimeFallback({
    engineRequested: "auto",
    runGpu: async () => { calls.push("gpu"); throw error; },
    runOsr: async () => { calls.push("osr"); return { receipt: { provenance: { engine: "osr" } } }; },
  });
  assert.deepEqual(calls, ["gpu", "osr"]);
  assert.equal(result.engine, "osr");
  assert.deepEqual(result.fallback, { from: "gpu", reason: "caption-measure-unstable" });
  assert.equal(result.gpuFailureRunPath, ".akari/gpu-run-failed.json");
});

test("explicit GPU keeps allowlisted runtime failure fail-closed", async () => {
  let osrCalls = 0;
  await assert.rejects(runGpuWithRuntimeFallback({
    engineRequested: "gpu",
    runGpu: async () => { throw Object.assign(new Error("unstable"), { reasonCode: "caption-measure-unstable" }); },
    runOsr: async () => { osrCalls += 1; },
  }), /unstable/u);
  assert.equal(osrCalls, 0);
});

test("auto does not fallback from message text without a structured reasonCode", async () => {
  let osrCalls = 0;
  await assert.rejects(runGpuWithRuntimeFallback({
    engineRequested: "auto",
    runGpu: async () => { throw new Error("caption-measure-unstable appeared only in text"); },
    runOsr: async () => { osrCalls += 1; },
  }), /appeared only in text/u);
  assert.equal(osrCalls, 0);
});

test("auto selects GPU for eligible darwin and win32 projects", () => {
  assert.equal(resolveEngineChoice("auto", "darwin", { eligible: true }), "gpu");
  assert.equal(resolveEngineChoice("auto", "darwin", { eligible: false }), "osr");
  assert.equal(resolveEngineChoice("auto", "win32", { eligible: true }), "gpu");
  assert.equal(resolveEngineChoice("auto", "win32", { eligible: false }), "osr");
  assert.equal(resolveEngineChoice("auto", "linux", { eligible: true }), "legacy");
  assert.equal(resolveEngineChoice("auto", "linux", { eligible: false }), "legacy");
  assert.equal(resolveEngineChoice("auto", "darwin"), "osr");
  assert.equal(resolveEngineChoice("auto", "win32"), "osr");
});

test("explicit GPU reaches launcher resolution on win32 and linux", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    for (const platform of ["win32", "linux"]) {
      Object.defineProperty(process, "platform", { ...descriptor, value: platform });
      assert.equal(resolveEngineChoice("gpu", process.platform, { eligible: true }), "gpu");
      assert.equal(
        resolveEngineChoice("auto", process.platform, { eligible: true }),
        platform === "win32" ? "gpu" : "legacy",
      );
      await assert.rejects(
        renderProject("/missing-gpu-platform-fixture", { engine: "gpu" }),
        (error) => /edit\.json could not be read/u.test(error.message)
          && !/available on macOS only/u.test(error.message),
      );
      // e56ff566 でインストール済みデスクトップアプリ（tier 1）が候補に戻ったため、
      // プローブは npm electron（tier 2）だけ成功させて「門番を越えて launcher 解決に到達する」ことを固定する。
      const launcher = await resolveGpuLauncher({
        platform: process.platform,
        env: {},
        homeDirectory: "/nonexistent-akari-home",
        probe: async (_executable, { kind } = {}) => kind !== "desktop" && kind !== "desktop-runtime",
        resolveElectron: () => "/electron",
      });
      assert.equal(launcher.tier, 2);
    }
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});

test("win32 auto provenance records eligible and ineligible launcher tiers", () => {
  const eligible = { eligible: true };
  for (const tier of [1, 2]) {
    assert.deepEqual(buildEngineProvenance("auto", "win32", { tier }, eligible), {
      engine_requested: "auto",
      engine: "gpu",
    });
  }
  assert.deepEqual(
    buildEngineProvenance("auto", "win32", { tier: 3, reason: "GPU Electron launcher unavailable" }, eligible),
    {
      engine_requested: "auto",
      engine: "legacy",
      engine_fallback: { from: "gpu", reason: "GPU Electron launcher unavailable" },
    },
  );

  const ineligible = { eligible: false };
  for (const tier of [1, 2]) {
    assert.deepEqual(buildEngineProvenance("auto", "win32", { tier }, ineligible), {
      engine_requested: "auto",
      engine: "osr",
    });
  }
  assert.deepEqual(
    buildEngineProvenance("auto", "win32", { tier: 3, reason: "OSR Electron launcher unavailable" }, ineligible),
    {
      engine_requested: "auto",
      engine: "legacy",
      engine_fallback: { from: "osr", reason: "OSR Electron launcher unavailable" },
    },
  );
});

test("win32 auto keeps the GPU to OSR to legacy fallback chain non-fatal", () => {
  const gpuEngine = resolveEngineChoice("auto", "win32", { eligible: true });
  assert.equal(gpuEngine, "gpu");
  const gpuUnavailable = selectRenderEngineExecution(gpuEngine, {
    tier: 3,
    reason: "GPU Electron launcher unavailable",
  });
  assert.deepEqual(gpuUnavailable.engineFallback, {
    from: "gpu",
    reason: "GPU Electron launcher unavailable",
  });

  const osrEngine = resolveEngineChoice("auto", "win32", { eligible: false });
  assert.equal(osrEngine, "osr");
  const osrAvailable = selectRenderEngineExecution(osrEngine, { tier: 2 });
  assert.equal(osrAvailable.engine, "osr");
  assert.equal(osrAvailable.engineFallback, undefined);

  const osrUnavailable = selectRenderEngineExecution(osrEngine, {
    tier: 3,
    reason: "OSR Electron launcher unavailable",
  });
  assert.equal(osrUnavailable.engine, "legacy");
  assert.deepEqual(osrUnavailable.engineFallback, {
    from: "osr",
    reason: "OSR Electron launcher unavailable",
  });
});

test("explicit GPU keeps tier 3 launcher failure as a RefusalError", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-gpu-tier3-"));
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const hadChromePath = Object.hasOwn(process.env, "CHROME_PATH");
  const originalChromePath = process.env.CHROME_PATH;
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    const sourcePath = join(root, "assets", "source.mp4");
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath,
    ], { encoding: "utf8", timeout: 30_000 });
    assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
    await writeFile(join(root, "edit.json"), `${JSON.stringify({
      version: 2,
      output: { width: 160, height: 90, fps: 10 },
      sources: [{ id: "main", path: "assets/source.mp4", proxy: null }],
      tracks: [{
        id: "v-main",
        lane: "visual",
        items: [{
          id: "clip-main",
          at: 0,
          duration: 10,
          source: { kind: "media", src: "main", in: 0, out: 1 },
        }],
      }],
    }, null, 2)}\n`);

    process.env.CHROME_PATH = process.execPath;
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
    await assert.rejects(
      renderProject(root, { engine: "gpu", force: true }),
      (error) => error instanceof RefusalError
        && /GPU export is unavailable/u.test(error.message)
        && !/available on macOS only/u.test(error.message),
    );
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
    if (hadChromePath) process.env.CHROME_PATH = originalChromePath;
    else delete process.env.CHROME_PATH;
    await rm(root, { recursive: true, force: true });
  }
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
