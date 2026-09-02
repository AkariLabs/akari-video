import assert from "node:assert/strict";
import test from "node:test";

import { gpuRuntimeFallbackReason } from "../../gpu-export/src/index.mjs";
import { buildVideoPreset } from "../src/plan.mjs";
import { assertHevcPresetSupported, parseArguments, RefusalError, runGpuWithRuntimeFallback, verifyArtifact } from "../src/render-cut.mjs";

test("--codec parses both spellings, defaults to h264, and rejects unknown values", () => {
  assert.equal(parseArguments(["/project"]).codec, "h264");
  assert.equal(parseArguments(["/project", "--codec", "hevc"]).codec, "hevc");
  assert.equal(parseArguments(["/project", "--codec=h264"]).codec, "h264");
  assert.throws(() => parseArguments(["/project", "--codec", "av1"]), /h264\|hevc/u);
});

test("plan preset follows h264/high and hevc/main", () => {
  assert.deepEqual(buildVideoPreset({ codec: "h264", width: 1920, height: 1080, fps: 30 }), {
    video_codec: "h264", profile: "high", pixel_format: "yuv420p", color_range: "tv",
    audio_codec: "aac", width: 1920, height: 1080, fps: 30,
  });
  assert.deepEqual(buildVideoPreset({ codec: "hevc", width: 3840, height: 2160, fps: 60 }), {
    video_codec: "hevc", profile: "main", pixel_format: "yuv420p", color_range: "tv",
    audio_codec: "aac", width: 3840, height: 2160, fps: 60,
  });
  assert.doesNotThrow(() => assertHevcPresetSupported(buildVideoPreset({ codec: "hevc", width: 4096, height: 2160, fps: 120 })));
  assert.throws(() => assertHevcPresetSupported(buildVideoPreset({ codec: "hevc", width: 7680, height: 4320, fps: 30 })), RefusalError);
});

test("hevc-unsupported falls back in auto and becomes a refusal for explicit gpu", async () => {
  const error = new Error("HEVC unsupported");
  error.reasonCode = "hevc-unsupported";
  assert.equal(gpuRuntimeFallbackReason(error), "hevc-unsupported");
  const automatic = await runGpuWithRuntimeFallback({
    engineRequested: "auto",
    runGpu: async () => { throw error; },
    runOsr: async () => ({ receipt: { provenance: { codec: "hevc" } } }),
  });
  assert.equal(automatic.engine, "osr");
  assert.equal(automatic.fallback.reason, "hevc-unsupported");
  await assert.rejects(runGpuWithRuntimeFallback({
    engineRequested: "gpu",
    runGpu: async () => { throw error; },
    runOsr: async () => assert.fail("must not run"),
  }), RefusalError);
});

test("verifyArtifact reads HEVC/Main expectations from the plan preset", () => {
  const preset = buildVideoPreset({ codec: "hevc", width: 320, height: 180, fps: 10 });
  const metadata = {
    streams: [
      { codec_type: "video", codec_name: "hevc", profile: "Main", width: 320, height: 180, pix_fmt: "yuv420p", color_range: "tv", avg_frame_rate: "10/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "1" },
  };
  const verification = verifyArtifact({
    outputPath: "out.mp4",
    plan: {
      predicted_duration_seconds: 1,
      duration_tolerance_seconds: 0.2,
      preset,
      commands: { audio_mix: { hasNarration: false, hasAudibleAudio: false } },
    },
    edit: { cuts: [] },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      if (command === "ffprobe-test") return { status: 0, stdout: JSON.stringify(metadata), stderr: "" };
      if (args.includes("-progress")) return { status: 0, stdout: "frame=10\nprogress=end\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "mean_volume: -21.0 dB\nmax_volume: -3.0 dB\n" };
    },
  });
  assert.equal(verification.verdict, "pass", JSON.stringify(verification.findings));
});
