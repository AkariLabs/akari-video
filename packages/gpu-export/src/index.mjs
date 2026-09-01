import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { summarizeGpuAdapters } from "../../osr-export/src/gpu-adapters.mjs";
import { normalizeGpuPreferenceRecord } from "../../osr-export/src/gpu-preference.mjs";
import { muxSourceAudio } from "../../osr-export/src/index.mjs";
import { verifyFinalVideo } from "../../osr-export/src/ffprobe.mjs";
import { resolveGpuEncoding } from "./bitrate.mjs";
import { CAPTION_MEASURE_UNSTABLE_REASON } from "./eligibility.mjs";
import { describeHardwareEncoderFailure, firstLine, HARDWARE_ENCODER_UNSUPPORTED_MARKER } from "./gpu-diagnostics.mjs";
import { buildGpuReceipt } from "./receipt.mjs";
import { launchGpuExport, resolveGpuLauncher } from "./runner.mjs";

export const FALLBACK_REASONS = Object.freeze([CAPTION_MEASURE_UNSTABLE_REASON]);

export function gpuRuntimeFallbackReason(error, fallbackReasons = FALLBACK_REASONS) {
  const reasonCode = typeof error?.reasonCode === "string" ? error.reasonCode : null;
  if (reasonCode && fallbackReasons.includes(reasonCode)) return reasonCode;
  return null;
}

export async function exportWithGpu({
  projectRoot,
  out,
  audioSourcePath = null,
  fps,
  width,
  height,
  duration,
  frames = Math.round(duration * fps),
  soft = false,
  queueDepth = 4,
  quality = "high",
  bitrate = undefined,
  trapReadback = false,
  verifyFrames = false,
  dumpFrames = [],
  // Windows のアプリ別 GPU 設定の一時上書き方針（auto | off | force）。undefined なら env AKARI_EXPORT_GPU_PREFERENCE → auto。
  gpuPreference = undefined,
  eligibility,
  ffmpegCommand = null,
  ffprobeCommand = null,
  env = process.env,
  io = console,
  launcher: suppliedLauncher = null,
  launcherResolver = resolveGpuLauncher,
  launcherRunner = launchGpuExport,
  audioMuxer = muxSourceAudio,
  finalVerifier = verifyFinalVideo,
} = {}) {
  if (eligibility?.eligible !== true) {
    throw new Error(`GPU eligibility failed: ${formatEligibilityFailures(eligibility)}`);
  }
  const encoding = resolveGpuEncoding({
    quality,
    bitrate: bitrate ?? env.AKARI_GPU_BITRATE,
    width,
    height,
  });
  const launcher = suppliedLauncher ?? await launcherResolver({ env });
  if (launcher?.tier === 3) throw new Error(`GPU export unavailable: ${launcher.reason ?? "Electron unavailable"}`);
  const videoOnlyPath = `${out}.gpu-video.mp4`;
  const runPath = join(dirname(videoOnlyPath), "run.json");
  try {
    const launched = await launcherRunner(launcher, {
      projectRoot,
      out: videoOnlyPath,
      fps,
      width,
      height,
      duration,
      frames,
      soft,
      queueDepth,
      quality: encoding.quality,
      bitrate: encoding.bitrate,
      trapReadback,
      verifyFrames,
      dumpFrames,
      gpuPreference,
      onStdout: (text) => io.log?.(text.trimEnd()),
      onStderr: (text) => io.error?.(text.trimEnd()),
    });
    const gpuPreferenceRecord = launched?.gpuPreference ?? null;
    const run = JSON.parse(await readFile(runPath, "utf8"));
    if (run.status === "unsupported" && verifyFrames) {
      const persistentRunPath = join(projectRoot, ".akari", "gpu-run.json");
      await mkdir(dirname(persistentRunPath), { recursive: true });
      await copyFile(runPath, persistentRunPath);
      run.persistentPath = relative(projectRoot, persistentRunPath).split("\\").join("/");
      return {
        launcher,
        run,
        receipt: buildGpuReceipt({ tier: launcher.tier, launcher, run, eligibility, finalVerify: null, profile: soft ? "soft" : "gpu", gpuPreference: gpuPreferenceRecord }),
      };
    }
    if (run.status !== "completed") throw new Error(`GPU encoder unavailable: ${run.status}`);
    const resolvedFfprobe = ffprobeCommand ?? resolveFfprobe({ env });
    await audioMuxer({
      ffmpegCommand: ffmpegCommand ?? resolveFfmpeg({ env }),
      ffprobeCommand: resolvedFfprobe,
      videoPath: videoOnlyPath,
      audioPath: audioSourcePath ?? videoOnlyPath,
      outputPath: out,
      frames,
      fps,
    });
    const finalVerify = await finalVerifier({
      command: resolvedFfprobe,
      path: out,
      frames,
      fps,
      width,
      height,
      requireAudio: true,
    });
    finalVerify.avTermination = measureAvTermination(finalVerify, fps);
    finalVerify.checks = { ...finalVerify.checks, avTermination: finalVerify.avTermination.matched };
    if (!finalVerify.matched) throw new Error(`final ffprobe verification failed: ${JSON.stringify(finalVerify.checks)}`);
    if (!finalVerify.avTermination.matched) {
      throw new Error(`final A/V termination differs by ${finalVerify.avTermination.deltaSeconds}s (limit ${finalVerify.avTermination.toleranceSeconds}s)`);
    }
    const persistentRunPath = join(projectRoot, ".akari", "gpu-run.json");
    await mkdir(dirname(persistentRunPath), { recursive: true });
    const persistentRun = { ...run, finalVerify };
    await writeFile(runPath, `${JSON.stringify(persistentRun, null, 2)}\n`);
    await copyFile(runPath, persistentRunPath);
    persistentRun.persistentPath = relative(projectRoot, persistentRunPath).split("\\").join("/");
    return {
      launcher,
      run: persistentRun,
      receipt: buildGpuReceipt({
        tier: launcher.tier,
        launcher,
        run: persistentRun,
        eligibility,
        finalVerify,
        profile: soft ? "soft" : "gpu",
        gpuPreference: gpuPreferenceRecord,
      }),
    };
  } catch (error) {
    await attachGpuFailureContext(error, runPath, projectRoot);
    throw error;
  } finally {
    await rm(videoOnlyPath, { force: true }).catch(() => {});
  }
}

export async function captureFramesWithGpu({
  projectRoot,
  editPath = null,
  outputDirectory,
  frameNumbers,
  fps,
  width,
  height,
  duration,
  frames = Math.round(duration * fps),
  eligibility,
  soft = false,
  gpuPreference = undefined,
  env = process.env,
  io = console,
  launcher: suppliedLauncher = null,
  launcherResolver = resolveGpuLauncher,
  launcherRunner = launchGpuExport,
} = {}) {
  if (eligibility?.eligible !== true) {
    throw new Error(`GPU eligibility failed: ${formatEligibilityFailures(eligibility)}`);
  }
  const requestedFrames = normalizeCaptureFrames(frameNumbers, frames);
  if (!projectRoot || !outputDirectory) {
    throw new Error("GPU capture requires projectRoot and outputDirectory");
  }
  const launcher = suppliedLauncher ?? await launcherResolver({ env });
  if (launcher?.tier === 3) {
    throw new Error(`GPU capture unavailable: ${launcher.reason ?? "Electron unavailable"}`);
  }
  await mkdir(outputDirectory, { recursive: true });
  const runPath = join(outputDirectory, "capture-run.json");
  let launched;
  try {
    launched = await launcherRunner(launcher, {
      projectRoot,
      editPath,
      out: runPath,
      fps,
      width,
      height,
      duration,
      frames,
      soft,
      quality: "high",
      captureFrames: requestedFrames,
      captureOutputDirectory: outputDirectory,
      gpuPreference,
      onStdout: (text) => io.log?.(text.trimEnd()),
      onStderr: (text) => io.error?.(text.trimEnd()),
    });
  } catch (error) {
    await attachGpuFailureContext(error, runPath, projectRoot);
    throw error;
  }
  const run = JSON.parse(await readFile(runPath, "utf8"));
  if (run.status !== "completed" || run.operation !== "capture" || run.verify?.matched !== true) {
    throw new Error(`GPU capture failed verification: ${run.status ?? "unknown"}`);
  }
  return {
    launcher,
    run,
    receipt: {
      launcherTier: launcher.tier,
      operation: "capture",
      verify: run.verify,
      gpu: run.gpu,
      viewport: run.viewport ?? null,
      eligibility: run.eligibility,
      elapsedMs: run.elapsedMs,
      gpu_preference: normalizeGpuPreferenceRecord(launched?.gpuPreference),
    },
  };
}

export function resolveGpuRuntimeOptions({ env = process.env, soft = false, queueDepth = 4, quality = "high", bitrate = undefined, width = undefined, height = undefined, trapReadback = false, verifyFrames = false } = {}) {
  const encoding = resolveGpuEncoding({
    quality,
    bitrate: bitrate ?? env.AKARI_GPU_BITRATE,
    width,
    height,
  });
  const resolved = {
    soft: soft || env.AKARI_GPU_SOFT === "1",
    queueDepth: env.AKARI_GPU_QUEUE_DEPTH === undefined ? positiveInteger(queueDepth, "queueDepth") : positiveInteger(env.AKARI_GPU_QUEUE_DEPTH, "AKARI_GPU_QUEUE_DEPTH"),
    quality: encoding.quality,
    bitrate: encoding.bitrate,
    trapReadback: trapReadback || env.AKARI_GPU_TRAP_READBACK === "1",
    verifyFrames: verifyFrames || env.AKARI_GPU_VERIFY_FRAMES === "1",
  };
  if (resolved.trapReadback && resolved.verifyFrames) throw new Error("GPU readback trap and frame verification are mutually exclusive");
  return resolved;
}

function formatEligibilityFailures(eligibility) {
  if (!eligibility?.entries) return "eligibility result is missing";
  return eligibility.entries.filter((entry) => ["degraded", "unsupported"].includes(entry.classification))
    .map((entry) => `${entry.kind}:${entry.id}:${entry.reason}`).join("; ") || "unknown reason";
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function normalizeCaptureFrames(frameNumbers, totalFrames) {
  if (!Array.isArray(frameNumbers) || frameNumbers.length === 0) {
    throw new Error("GPU capture requires at least one frame number");
  }
  return [...new Set(frameNumbers.map((frame) => {
    const parsed = Number(frame);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= totalFrames) {
      throw new Error(`GPU capture frame ${frame} is outside 0..${totalFrames - 1}`);
    }
    return parsed;
  }))].sort((left, right) => left - right);
}

function measureAvTermination(finalVerify, fps) {
  const streams = finalVerify?.measured?.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const videoDuration = Number(video?.duration ?? finalVerify?.measured?.format?.duration);
  const audioDuration = Number(audio?.duration);
  const deltaSeconds = Number.isFinite(videoDuration) && Number.isFinite(audioDuration)
    ? Math.abs(videoDuration - audioDuration)
    : Number.POSITIVE_INFINITY;
  const toleranceSeconds = 1 / fps;
  return { matched: deltaSeconds <= toleranceSeconds, deltaSeconds, toleranceSeconds, videoDuration, audioDuration };
}

export async function attachGpuFailureContext(error, runPath, projectRoot) {
  const run = await readFile(runPath, "utf8").then(JSON.parse).catch(() => null);
  if (run?.status !== "failed") return;
  const persistentRunPath = join(projectRoot, ".akari", "gpu-run-failed.json");
  await mkdir(dirname(persistentRunPath), { recursive: true });
  await copyFile(runPath, persistentRunPath);
  error.reasonCode = run.reasonCode ?? gpuRuntimeFallbackReason(error);
  error.gpuFailureRunPath = relative(projectRoot, persistentRunPath).split("\\").join("/");
  error.gpuFailureRun = run;
  // ハードウェア H.264 エンコーダが使えなかったときだけ、message を「どの GPU に載ったか・なぜ切り替えなかったか・次に何をするか」の
  // 日本語 1 行に置き換える（元の message は originalMessage に保持）。render-cut はこれを stderr の最終行に出す。
  if (typeof run.error === "string" && run.error.includes(HARDWARE_ENCODER_UNSUPPORTED_MARKER)) {
    error.originalMessage = error.message;
    error.message = describeHardwareEncoderFailure({
      adapters: summarizeGpuAdapters(run.gpu?.devices ?? null),
      renderer: run.gpu?.renderer ?? null,
      gpuPreference: error.gpuPreference ?? null,
      cause: firstLine(run.error),
    });
  }
}
