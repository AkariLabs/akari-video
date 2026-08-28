import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { exportWithGpu, resolveGpuRuntimeOptions } from "../src/index.mjs";

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
  assert.equal(result.receipt.gpu.quality, "high");
  assert.equal(result.receipt.gpu.bitrate, 12_000_000);
  assert.equal(result.receipt.provenance.video_reencode, false);
  assert.equal(await readFile(out, "utf8"), "final-with-audio");
  await assert.rejects(access(`${out}.gpu-video.mp4`));
  await rm(projectRoot, { recursive: true, force: true });
});
