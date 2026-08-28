import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { muxSourceAudio } from "../../osr-export/src/index.mjs";
import { verifyFinalVideo } from "../../osr-export/src/ffprobe.mjs";
import { resolveGpuEncoding } from "./bitrate.mjs";
import { buildGpuReceipt } from "./receipt.mjs";
import { launchGpuExport, resolveGpuLauncher } from "./runner.mjs";

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
  });
  const launcher = suppliedLauncher ?? await launcherResolver({ env });
  if (launcher?.tier === 3) throw new Error(`GPU export unavailable: ${launcher.reason ?? "Electron unavailable"}`);
  const videoOnlyPath = `${out}.gpu-video.mp4`;
  try {
    await launcherRunner(launcher, {
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
      onStdout: (text) => io.log?.(text.trimEnd()),
      onStderr: (text) => io.error?.(text.trimEnd()),
    });
    const runPath = join(dirname(videoOnlyPath), "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8"));
    if (run.status === "unsupported" && verifyFrames) {
      const persistentRunPath = join(projectRoot, ".akari", "gpu-run.json");
      await mkdir(dirname(persistentRunPath), { recursive: true });
      await copyFile(runPath, persistentRunPath);
      run.persistentPath = relative(projectRoot, persistentRunPath).split("\\").join("/");
      return {
        launcher,
        run,
        receipt: buildGpuReceipt({ tier: launcher.tier, launcher, run, eligibility, finalVerify: null, profile: soft ? "soft" : "gpu" }),
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
      }),
    };
  } finally {
    await rm(videoOnlyPath, { force: true }).catch(() => {});
  }
}

export function resolveGpuRuntimeOptions({ env = process.env, soft = false, queueDepth = 4, quality = "high", bitrate = undefined, trapReadback = false, verifyFrames = false } = {}) {
  const encoding = resolveGpuEncoding({
    quality,
    bitrate: bitrate ?? env.AKARI_GPU_BITRATE,
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
