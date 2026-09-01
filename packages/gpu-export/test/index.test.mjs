import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FALLBACK_REASONS, exportWithGpu, resolveGpuRuntimeOptions } from "../src/index.mjs";

test("GPU runtime fallback reasons are a closed shared set", () => {
  assert.deepEqual(FALLBACK_REASONS, ["caption-measure-unstable"]);
  assert.equal(Object.isFrozen(FALLBACK_REASONS), true);
});

test("GPU export rejects ineligible projects before launcher resolution", async () => {
  let resolved = false;
  await assert.rejects(exportWithGpu({
    eligibility: { eligible: false, entries: [{ kind: "overlay", id: "x", classification: "degraded", reason: "animation-timing" }] },
    launcherResolver: async () => { resolved = true; return { tier: 2 }; },
  }), /overlay:x:animation-timing/);
  assert.equal(resolved, false);
});

test("GPU export rejects tier 3", async () => {
  await assert.rejects(exportWithGpu({
    eligibility: { eligible: true, entries: [] },
    launcherResolver: async () => ({ tier: 3, reason: "missing" }),
  }), /unavailable/);
});

test("GPU environment options normalize and keep trap/verify exclusive", () => {
  assert.deepEqual(resolveGpuRuntimeOptions({ env: { AKARI_GPU_SOFT: "1", AKARI_GPU_QUEUE_DEPTH: "6", AKARI_GPU_BITRATE: "9000" } }), {
    soft: true, queueDepth: 6, quality: "high", bitrate: 9000, trapReadback: false, verifyFrames: false,
  });
  assert.throws(() => resolveGpuRuntimeOptions({ trapReadback: true, verifyFrames: true }), /mutually exclusive/);
  assert.equal(resolveGpuRuntimeOptions({ bitrate: 7000, env: { AKARI_GPU_BITRATE: "9000" } }).bitrate, 7000);
});

test("GPU export refuses master without bitrate before resolving a launcher", async () => {
  let resolved = false;
  await assert.rejects(exportWithGpu({
    quality: "master",
    eligibility: { eligible: true, entries: [] },
    launcherResolver: async () => { resolved = true; return { tier: 2 }; },
  }), /master は GPU 出口では --bitrate の明示が必要/);
  assert.equal(resolved, false);
});

test("GPU export muxes audio by stream copy contract and removes the video-only intermediate", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-index-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  await mkdir(renderDirectory, { recursive: true });
  let muxOptions;
  let launchOptions;
  const result = await exportWithGpu({
    projectRoot,
    out,
    audioSourcePath: join(projectRoot, "cut.mp4"),
    fps: 30,
    width: 320,
    height: 180,
    duration: 1,
    frames: 30,
    dumpFrames: [0, 29],
    eligibility: { eligible: true, entries: [] },
    launcher: { tier: 2, kind: "npm-electron", executable: "/electron" },
    launcherRunner: async (_launcher, options) => {
      launchOptions = options;
      await writeFile(options.out, "encoded-video");
      await writeFile(join(renderDirectory, "run.json"), JSON.stringify({
        status: "completed", gpu: { uploadPath: "direct", quality: options.quality, bitrate: options.bitrate, queueDepth: 4 }, memory: { peakBytes: 10 },
      }));
    },
    audioMuxer: async (options) => {
      muxOptions = options;
      await writeFile(options.outputPath, "final-with-audio");
      return true;
    },
    finalVerifier: async () => ({
      matched: true,
      checks: { frames: true },
      measured: { streams: [{ codec_type: "video", duration: "1" }, { codec_type: "audio", duration: "1" }] },
    }),
  });
  assert.equal(muxOptions.videoPath, `${out}.gpu-video.mp4`);
  assert.equal(muxOptions.outputPath, out);
  assert.equal(launchOptions.quality, "high");
  assert.equal(launchOptions.bitrate, 12_000_000);
  assert.deepEqual(launchOptions.dumpFrames, [0, 29]);
  assert.equal(result.receipt.gpu.quality, "high");
  assert.equal(result.receipt.gpu.bitrate, 12_000_000);
  assert.equal(result.receipt.provenance.video_reencode, false);
  assert.equal(await readFile(out, "utf8"), "final-with-audio");
  await assert.rejects(access(`${out}.gpu-video.mp4`));
  await rm(projectRoot, { recursive: true, force: true });
});

test("GPU export preserves a failed run and attaches its closed reason to the error", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-index-failure-"));
  const out = join(projectRoot, "render", "composite.mp4");
  await mkdir(join(projectRoot, "render"), { recursive: true });
  try {
    let caught;
    try {
      await exportWithGpu({
        projectRoot, out, fps: 30, width: 16, height: 16, duration: 1, frames: 30,
        eligibility: { eligible: true, entries: [] },
        launcher: { tier: 2, executable: "/electron" },
        launcherRunner: async (_launcher, options) => {
          await writeFile(join(projectRoot, "render", "run.json"), JSON.stringify({
            status: "failed", reasonCode: "caption-measure-unstable",
            gpu: { captionMeasureDiffs: { totalCount: 1, shownCount: 1, truncated: false, entries: [] } },
          }));
          throw new Error(`Electron exited 1: caption-measure-unstable (${options.out})`);
        },
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.reasonCode, "caption-measure-unstable");
    assert.equal(caught.gpuFailureRunPath, ".akari/gpu-run-failed.json");
    const persisted = JSON.parse(await readFile(join(projectRoot, caught.gpuFailureRunPath), "utf8"));
    assert.equal(persisted.status, "failed");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("GPU runtime options scale the preset bitrate by output size when width/height are known", () => {
  assert.equal(resolveGpuRuntimeOptions({ width: 3840, height: 2160 }).bitrate, 48_000_000);
  assert.equal(resolveGpuRuntimeOptions({ width: 1920, height: 1080 }).bitrate, 12_000_000);
  assert.equal(resolveGpuRuntimeOptions({ width: 3840, height: 2160, env: { AKARI_GPU_BITRATE: "9000" } }).bitrate, 9000);
});

const HYBRID_IGPU_DEVICES = [
  { vendor_id: 32902, device_id: 42920, device_string: "Intel(R) UHD Graphics", active: true, gpu_preference: 2 },
  { vendor_id: 4318, device_id: 11545, device_string: "NVIDIA GeForce RTX 5060 Laptop GPU", active: false, gpu_preference: 3 },
  { vendor_id: 5140, device_id: 140, device_string: "Microsoft Basic Render Driver", active: false, gpu_preference: 0 },
];
const UNSUPPORTED_ERROR = "Error: WebCodecs H.264 config is unsupported: prefer-hardware (avc1.640028 1280x720@30fps 6000000bps) renderer=ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)\n    at __akariGpuRun";

test("GPU export forwards gpuPreference to the launcher and records its return value as provenance.gpu_preference", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-index-pref-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  await mkdir(renderDirectory, { recursive: true });
  try {
    let launchOptions;
    const result = await exportWithGpu({
      projectRoot, out, fps: 30, width: 320, height: 180, duration: 1, frames: 30,
      gpuPreference: "force",
      eligibility: { eligible: true, entries: [] },
      launcher: { tier: 2, kind: "npm-electron", executable: "/electron" },
      launcherRunner: async (launcher, options) => {
        launchOptions = options;
        await writeFile(options.out, "encoded-video");
        await writeFile(join(renderDirectory, "run.json"), JSON.stringify({ status: "completed", gpu: { uploadPath: "direct" }, memory: { peakBytes: 10 } }));
        return { launcher, gpuPreference: {
          platform: "win32", policy: "force", exit: "gpu", executable: "C:\\x\\electron.exe", applied: true, previous: "GpuPreference=1;", restored: true, reason: "forced", recovered_stale: false,
        } };
      },
      audioMuxer: async (options) => { await writeFile(options.outputPath, "final"); return true; },
      finalVerifier: async () => ({ matched: true, checks: {}, measured: { streams: [{ codec_type: "video", duration: "1" }, { codec_type: "audio", duration: "1" }] } }),
    });
    assert.equal(launchOptions.gpuPreference, "force");
    assert.deepEqual(result.receipt.provenance.gpu_preference, {
      policy: "force", exit: "gpu", applied: true, previous: "GpuPreference=1;", restored: true, reason: "forced", recovered_stale: false,
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("GPU export replaces the hardware-encoder failure message with the Japanese one-liner and keeps the original", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-index-unsupported-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  await mkdir(renderDirectory, { recursive: true });
  try {
    let caught;
    try {
      await exportWithGpu({
        projectRoot, out, fps: 30, width: 1280, height: 720, duration: 1, frames: 30,
        eligibility: { eligible: true, entries: [] },
        launcher: { tier: 2, executable: "/electron" },
        launcherRunner: async () => {
          await writeFile(join(renderDirectory, "run.json"), JSON.stringify({
            status: "failed", error: UNSUPPORTED_ERROR,
            gpu: {
              platform: "win32", chromium: "142.0.0.0",
              renderer: { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)" },
              encoder_support: { "prefer-hardware": false, "prefer-software": true },
              devices: HYBRID_IGPU_DEVICES,
            },
          }));
          const error = new Error("OSR Electron exited 1 (no signal)");
          error.gpuPreference = { platform: "win32", policy: "off", executable: "C:\\x\\electron.exe", applied: false, previous: null, restored: null, reason: "policy-off", recovered_stale: false };
          throw error;
        },
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.originalMessage, "OSR Electron exited 1 (no signal)");
    assert.equal(caught.message, "ハードウェア H.264 エンコーダが使えません。書き出しプロセスは内蔵 GPU（Intel(R) UHD Graphics）で動作しています。高パフォーマンス GPU（NVIDIA GeForce RTX 5060 Laptop GPU）への自動切り替えが off です。AKARI_EXPORT_GPU_PREFERENCE=auto で再実行してください（原因: WebCodecs H.264 config is unsupported: prefer-hardware (avc1.640028 1280x720@30fps 6000000bps) renderer=ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)）");
    assert.doesNotMatch(caught.message, /[\r\n]/u);
    assert.equal(caught.gpuFailureRunPath, ".akari/gpu-run-failed.json");
    const persisted = JSON.parse(await readFile(join(projectRoot, caught.gpuFailureRunPath), "utf8"));
    assert.equal(persisted.gpu.renderer.renderer, "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)");
    assert.equal(persisted.gpu.devices.length, 3);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("GPU export leaves other failure messages untouched", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-index-other-failure-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  await mkdir(renderDirectory, { recursive: true });
  try {
    await assert.rejects(exportWithGpu({
      projectRoot, out, fps: 30, width: 16, height: 16, duration: 1, frames: 30,
      eligibility: { eligible: true, entries: [] },
      launcher: { tier: 2, executable: "/electron" },
      launcherRunner: async () => {
        await writeFile(join(renderDirectory, "run.json"), JSON.stringify({ status: "failed", error: "Error: GPU renderer process gone: crashed", gpu: { devices: HYBRID_IGPU_DEVICES } }));
        throw new Error("OSR Electron exited 1 (no signal)");
      },
    }), (error) => {
      assert.equal(error.message, "OSR Electron exited 1 (no signal)");
      assert.equal(Object.hasOwn(error, "originalMessage"), false);
      return true;
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
