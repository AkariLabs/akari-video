import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { launchBrowser } from "./browser-launch.mjs";
import { buildAnimatedCompositeArgs } from "./plan.mjs";
import { captureWithPuppeteer, renderOverlaySheet, runChecked } from "./rasterize.mjs";

const require = createRequire(import.meta.url);

/**
 * render-cut の command plan を先頭から対象フレームまでだけ評価し、完成フレームを PNG にする。
 * enable 窓・キーフレーム・FX の式は plan.commands にだけ存在し、この関数では組み直さない。
 */
export async function renderFrameAt({
  plan,
  timeS,
  outputPath,
  edit,
  projectRoot,
  overlays = [],
  captions = [],
  chromePath,
  ffmpegCommand,
  temporaryDirectory,
}) {
  if (!plan || !edit || !projectRoot || !temporaryDirectory) {
    throw new TypeError("renderFrameAt requires plan, edit, projectRoot, and temporaryDirectory");
  }
  const fps = Number(plan.preset?.fps);
  const duration = Number(plan.predicted_duration_seconds);
  if (!(fps > 0) || !(duration > 0) || !Number.isFinite(Number(timeS))) {
    throw new TypeError("renderFrameAt requires a positive fps/duration and a finite timeS");
  }
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const frameIndex = Math.min(totalFrames - 1, Math.max(0, Math.round(Number(timeS) * fps)));
  const frameCount = frameIndex + 1;
  const command = ffmpegCommand ?? plan.commands?.cut?.command;
  if (!command) throw new TypeError("renderFrameAt could not resolve ffmpeg command");

  const root = resolve(projectRoot);
  const work = resolve(temporaryDirectory);
  await mkdir(work, { recursive: true });
  await mkdir(dirname(resolve(commandOutput(plan.commands.cut))), { recursive: true });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });

  for (const telop of plan.commands.telops ?? []) runChecked(telop.command, telop.args, { cwd: root });
  runLimited(plan.commands.cut, frameCount, root);
  if (plan.commands.tail_pad) runLimited(plan.commands.tail_pad, frameCount, root);

  const trackStack = plan.commands.track_stack;
  if (trackStack) {
    runLimited(trackStack.base, frameCount, root);
    for (const track of trackStack.cutTracks ?? []) runLimited(track.command, frameCount, root);
    for (const stage of trackStack.stages ?? []) {
      if (stage.command) {
        runLimited(stage.command, frameCount, root);
        continue;
      }
      const ids = new Set(stage.overlayIds ?? []);
      const candidates = stage.kind === "captions" ? captions : overlays;
      const stageOverlays = candidates.filter((overlay) => ids.has(String(overlay.id)));
      if (stageOverlays.length === 0) {
        await copyFile(stage.inputPath, stage.outputPath);
        continue;
      }
      await compositeOverlayPrefix({
        overlays: stageOverlays,
        edit,
        projectRoot: root,
        directory: join(work, `track-overlay-${stage.orderIndex}-${stage.stageIndex}`),
        inputPath: stage.inputPath,
        outputPath: stage.outputPath,
        chromePath,
        ffmpegCommand: command,
        fps,
        frameCount,
        videoEncodeArgs: plan.encoding?.video_encode_args ?? null,
      });
    }
  }

  if (plan.commands.layers) runLimited(plan.commands.layers, frameCount, root);
  let basePath = trackStack?.outputPath
    ?? commandOutput(plan.commands.layers)
    ?? commandOutput(plan.commands.tail_pad)
    ?? commandOutput(plan.commands.cut);

  const allOverlays = trackStack ? [] : [...overlays, ...captions];
  const selectedBase = join(work, "selected-base.mkv");
  extractFrame(command, basePath, frameIndex, selectedBase, root);
  basePath = selectedBase;

  if (allOverlays.length > 0) {
    const overlayPath = join(work, "overlay-frame.png");
    await captureOverlayFrame({
      overlays: allOverlays,
      edit,
      projectRoot: root,
      directory: work,
      outputPath: overlayPath,
      seconds: frameIndex / fps,
      duration,
      chromePath,
    });
    const composited = join(work, "composited-frame.nut");
    runChecked(command, buildAnimatedCompositeArgs({
      cutPath: basePath,
      overlayPath,
      outputPath: composited,
      hasAudio: false,
      videoEncodeArgs: ["-c:v", "rawvideo", "-color_range", "tv"],
    }), { cwd: root });
    basePath = composited;
  }

  // 書き出しと同じ yuv420p/tv の色経路を通った画を、最後に PNG 用 RGB へ戻す。
  runChecked(command, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", basePath,
    "-vf", "scale=in_range=tv:out_range=pc,format=rgb24",
    "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24",
    resolve(outputPath),
  ], { cwd: root });
  return { outputPath: resolve(outputPath), frameIndex, timeS: frameIndex / fps };
}

function runLimited(command, frameCount, cwd) {
  if (!command?.command || !Array.isArray(command.args)) return;
  runChecked(command.command, insertFrameLimit(command.args, frameCount), { cwd });
}

export function insertFrameLimit(args, frameCount) {
  if (!Array.isArray(args) || args.length === 0) throw new TypeError("ffmpeg args are required");
  return [...args.slice(0, -1), "-frames:v", String(frameCount), args.at(-1)];
}

function commandOutput(command) {
  return Array.isArray(command?.args) ? command.args.at(-1) : null;
}

function extractFrame(ffmpegCommand, inputPath, frameIndex, outputPath, cwd) {
  runChecked(ffmpegCommand, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", inputPath,
    "-vf", `select=eq(n\\,${frameIndex}),setpts=N/FRAME_RATE/TB`,
    "-frames:v", "1", "-an", "-c:v", "ffv1", "-pix_fmt", "yuv420p", "-color_range", "tv",
    outputPath,
  ], { cwd });
}

async function captureOverlayFrame({
  overlays,
  edit,
  projectRoot,
  directory,
  outputPath,
  seconds,
  duration,
  chromePath,
}) {
  if (!chromePath) throw new Error("Chrome path is required to capture overlays");
  const sheetPath = join(directory, "overlay-sheet.html");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays, edit, projectRoot, duration }),
    "utf8",
  );
  const imported = require("puppeteer-core");
  const puppeteer = imported.default ?? imported;
  const session = await launchBrowser({
    puppeteer,
    chromePath,
    profileParent: directory,
    profilePrefix: "capture-chrome-profile-",
    failureMarkerPath: join(directory, ".browser-launch-failed"),
    timeoutMs: 600_000,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  try {
    const page = await session.browser.newPage();
    try {
      await page.setViewport({ width: edit.output.width, height: edit.output.height, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "networkidle0", timeout: 180_000 });
      await page.evaluate(() => window.__akariReady);
      await page.evaluate((value) => window.__akariSeek(value), seconds);
      await page.screenshot({ path: outputPath, omitBackground: true, optimizeForSpeed: true, timeout: 600_000 });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await session.close();
  }
}

async function compositeOverlayPrefix({
  overlays,
  edit,
  projectRoot,
  directory,
  inputPath,
  outputPath,
  chromePath,
  ffmpegCommand,
  fps,
  frameCount,
  videoEncodeArgs,
}) {
  await mkdir(directory, { recursive: true });
  const sheetPath = join(directory, "overlay-sheet.html");
  const overlayMovPath = join(directory, "overlay.mov");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays, edit, projectRoot, duration: frameCount / fps }),
    "utf8",
  );
  await captureWithPuppeteer({
    sheetPath,
    chromePath,
    framesDirectory: join(directory, "frames"),
    overlayMovPath,
    width: edit.output.width,
    height: edit.output.height,
    fps,
    duration: frameCount / fps,
    ffmpegCommand,
  });
  runChecked(ffmpegCommand, insertFrameLimit(buildAnimatedCompositeArgs({
    cutPath: inputPath,
    overlayPath: overlayMovPath,
    outputPath,
    hasAudio: true,
    videoEncodeArgs,
  }), frameCount), { cwd: projectRoot });
}
