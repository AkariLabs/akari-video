import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { verifyFinalVideo } from "./ffprobe.mjs";
import { buildOsrReceipt } from "./receipt.mjs";
import { launchElectronExport, resolveElectronLauncher } from "./runner.mjs";

export async function exportWithOsr({
  projectRoot,
  out,
  audioSourcePath = null,
  fps,
  width,
  height,
  duration,
  frames = Math.round(duration * fps),
  quality,
  encoder,
  soft = false,
  verify = "stamp",
  // Windows のアプリ別 GPU 設定の一時上書き方針（auto | off | force）。undefined なら env AKARI_EXPORT_GPU_PREFERENCE → auto。
  gpuPreference = undefined,
  ffmpegCommand = null,
  ffprobeCommand = null,
  env = process.env,
  io = console,
  launcherResolver = resolveElectronLauncher,
  launcherRunner = launchElectronExport,
  launcher: suppliedLauncher = null,
} = {}) {
  const runtime = resolveOsrRuntimeOptions({ env, soft, verify });
  const launcher = suppliedLauncher ?? await launcherResolver({ env });
  if (launcher.tier === 3) {
    throw new Error(`OSR export unavailable: ${launcher.reason ?? "Electron unavailable"}`);
  }
  const videoOnlyPath = `${out}.osr-video.mp4`;
  try {
    const launched = await launcherRunner(launcher, {
      projectRoot, out: videoOnlyPath, fps, width, height, duration, frames, quality, encoder,
      soft: runtime.soft,
      verify: runtime.verify,
      queueDepth: runtime.queueDepth,
      dumpFrames: runtime.dumpFrames,
      gpuPreference,
      onStdout: (text) => io.log?.(text.trimEnd()),
      onStderr: (text) => io.error?.(text.trimEnd()),
    });
    const ffprobeCommandResolved = ffprobeCommand ?? resolveFfprobe({ env });
    let sourceHasAudio = false;
    if (audioSourcePath) {
      sourceHasAudio = await muxSourceAudio({
        ffmpegCommand: ffmpegCommand ?? resolveFfmpeg({ env }),
        ffprobeCommand: ffprobeCommandResolved,
        videoPath: videoOnlyPath,
        audioPath: audioSourcePath,
        outputPath: out,
        frames,
        fps,
      });
    } else {
      await copyFile(videoOnlyPath, out);
    }
    const finalVerify = await verifyFinalVideo({
      command: ffprobeCommandResolved,
      path: out,
      frames,
      fps,
      width,
      height,
      requireAudio: sourceHasAudio,
    });
    const runPath = join(dirname(videoOnlyPath), "run.json");
    const run = { ...JSON.parse(await readFile(runPath, "utf8")), finalVerify };
    await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
    const persistentRunPath = join(projectRoot, ".akari", "osr-run.json");
    await mkdir(dirname(persistentRunPath), { recursive: true });
    await copyFile(runPath, persistentRunPath);
    if (!finalVerify.matched) {
      throw new Error(`final ffprobe verification failed: ${JSON.stringify(finalVerify.checks)}`);
    }
    const receiptRunPath = relative(projectRoot, persistentRunPath).split("\\").join("/");
    return {
      launcher,
      run,
      receipt: buildOsrReceipt({
        tier: launcher.tier, verify: runtime.verify, memory: run?.memory, viewport: run?.viewport ?? null, run: receiptRunPath, finalVerify,
        profile: runtime.soft ? "soft" : "gpu",
        gpuPreference: launched?.gpuPreference ?? null,
      }),
    };
  } finally {
    await rm(videoOnlyPath, { force: true }).catch(() => {});
  }
}

export async function captureFramesWithOsr({
  projectRoot,
  editPath = null,
  outputDirectory,
  frameNumbers,
  fps,
  width,
  height,
  duration,
  frames = Math.round(duration * fps),
  soft = false,
  gpuPreference = undefined,
  env = process.env,
  io = console,
  launcherResolver = resolveElectronLauncher,
  launcherRunner = launchElectronExport,
  launcher: suppliedLauncher = null,
} = {}) {
  const requestedFrames = normalizeCaptureFrames(frameNumbers, frames);
  if (!projectRoot || !outputDirectory) {
    throw new Error("OSR capture requires projectRoot and outputDirectory");
  }
  const runtime = resolveOsrRuntimeOptions({ env, soft, verify: "stamp" });
  const launcher = suppliedLauncher ?? await launcherResolver({ env });
  if (launcher.tier === 3) {
    throw new Error(`OSR capture unavailable: ${launcher.reason ?? "Electron unavailable"}`);
  }
  await mkdir(outputDirectory, { recursive: true });
  const runPath = join(outputDirectory, "capture-run.json");
  await launcherRunner(launcher, {
    projectRoot,
    out: runPath,
    fps,
    width,
    height,
    duration,
    frames,
    quality: "high",
    encoder: "auto",
    soft: runtime.soft,
    verify: "stamp",
    queueDepth: runtime.queueDepth,
    gpuPreference,
    extraArgs: [
      ...(editPath ? ["--edit", editPath] : []),
      "--capture-frames", requestedFrames.join(","),
      "--capture-output-dir", outputDirectory,
    ],
    onStdout: (text) => io.log?.(text.trimEnd()),
    onStderr: (text) => io.error?.(text.trimEnd()),
  });
  const run = JSON.parse(await readFile(runPath, "utf8"));
  if (run.status !== "completed" || run.operation !== "capture" || run.verify?.matched !== true) {
    throw new Error(`OSR capture failed verification: ${run.status ?? "unknown"}`);
  }
  return {
    launcher,
    run,
    receipt: {
      launcherTier: launcher.tier,
      operation: "capture",
      page: run.page,
      verify: run.verify,
      viewport: run.viewport ?? null,
      elapsedMs: run.elapsedMs,
    },
  };
}

// 製品入口。インストール済みデスクトップアプリ（tier 1）は shell の electron-entry.js が --render を Theia より前に
// 捕捉するようになった（2026-08-29 osr-headless-entry 合流・契約 §6 / §11.4 / §11.5）ため既定で候補に戻す。
// v0.1.27 の間だけ allowInstalledDesktop 既定 false で外していた。明示の allowInstalledDesktop: false は今も使える。
export function resolveOsrLauncher(options = {}) {
  return resolveElectronLauncher(options);
}

export function resolveOsrRuntimeOptions({ env = process.env, soft = false, verify = "stamp" } = {}) {
  const resolvedVerify = env.AKARI_OSR_VERIFY ?? verify;
  if (!["stamp", "hash", "off"].includes(resolvedVerify)) {
    throw new Error(`AKARI_OSR_VERIFY must be stamp|hash|off, got: ${resolvedVerify}`);
  }
  const queueDepth = env.AKARI_OSR_QUEUE_DEPTH === undefined
    ? 3
    : positiveInteger(env.AKARI_OSR_QUEUE_DEPTH, "AKARI_OSR_QUEUE_DEPTH");
  const dumpFrames = env.AKARI_OSR_DUMP_FRAMES === undefined || env.AKARI_OSR_DUMP_FRAMES === ""
    ? []
    : [...new Set(env.AKARI_OSR_DUMP_FRAMES.split(",").map((entry) => nonNegativeInteger(entry, "AKARI_OSR_DUMP_FRAMES")))].sort((left, right) => left - right);
  return {
    soft: soft || env.AKARI_OSR_SOFT === "1",
    verify: resolvedVerify,
    queueDepth,
    dumpFrames,
  };
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer, got: ${value}`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must contain non-negative integers, got: ${value}`);
  return number;
}

function normalizeCaptureFrames(frameNumbers, totalFrames) {
  if (!Array.isArray(frameNumbers) || frameNumbers.length === 0) {
    throw new Error("OSR capture requires at least one frame number");
  }
  return [...new Set(frameNumbers.map((frame) => {
    const parsed = Number(frame);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= totalFrames) {
      throw new Error(`OSR capture frame ${frame} is outside 0..${totalFrames - 1}`);
    }
    return parsed;
  }))].sort((left, right) => left - right);
}

export async function muxSourceAudio({ ffmpegCommand, ffprobeCommand, videoPath, audioPath, outputPath, frames, fps }) {
  const sourceHasAudio = (await capture(ffprobeCommand, [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", audioPath,
  ])).trim() !== "";
  const duration = frames / fps;
  const args = sourceHasAudio
    ? ["-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-t", String(duration), outputPath]
    : ["-i", videoPath, "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-t", String(duration), outputPath];
  await spawnAndWait(ffmpegCommand, ["-hide_banner", "-loglevel", "warning", "-y", ...args]);
  return sourceHasAudio;
}

function spawnAndWait(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`ffmpeg mux exited ${code}: ${stderr.trim()}`)));
  });
}

function capture(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise(stdout) : rejectPromise(new Error(`ffprobe exited ${code}: ${stderr.trim()}`)));
  });
}
