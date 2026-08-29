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
  parseArguments,
  renderProject,
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
  assert.equal(resolveEngineChoice("auto", "win32", { eligible: true }), "legacy");
  assert.equal(resolveEngineChoice("auto", "darwin"), "osr");
});

test("explicit GPU reaches launcher resolution on win32 and linux while auto remains unchanged", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    for (const platform of ["win32", "linux"]) {
      Object.defineProperty(process, "platform", { ...descriptor, value: platform });
      assert.equal(resolveEngineChoice("gpu", process.platform, { eligible: true }), "gpu");
      assert.equal(resolveEngineChoice("auto", process.platform, { eligible: true }), "legacy");
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
        probe: async (executable) => executable === "/electron",
        resolveElectron: () => "/electron",
      });
      assert.equal(launcher.tier, 2);
    }
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
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
