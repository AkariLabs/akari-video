import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";

import electron from "electron";

import { startRawVideoEncoder } from "./encode.mjs";
import { verifyEncodedVideo } from "./ffprobe.mjs";
import { collectGpuDevices, summarizeGpuAdapters } from "./gpu-adapters.mjs";
import { createMemorySampler, resolveMemoryBudget, memoryHardStopError } from "./memory.mjs";
import {
  OSR_WARM_UP_BUDGET_MS,
  captureNonEmptyBitmap,
  createEmptyPaintRecorder,
  deviceEmulationParameters,
  osrPageSize,
  readPaintBitmap,
  viewportMatches,
  viewportRecord,
  warmUpFailureMessage,
  warmUpOffscreenPaint,
} from "./paint-bitmap.mjs";
import { loadAndBuildOsrPage } from "./page-builder.mjs";
import { encodeBgraPng } from "./png.mjs";
import { startStaticServer } from "./static-server.mjs";
import { stripStampRow, verifyStamp } from "./stamp.mjs";

const { app, BrowserWindow, screen } = electron;
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export async function runOsrExport(options) {
  const {
    projectRoot,
    editPath = null,
    out,
    fps = 30,
    width = 1920,
    height = 1080,
    outputWidth = width,
    outputHeight = height,
    duration,
    frames = Math.round(duration * fps),
    quality = "high",
    encoder = "auto",
    codec = "h264",
    verify = "stamp",
    soft = false,
    paintTimeoutMs = 10_000,
    ffmpegCommand = process.env.FFMPEG ?? process.env.AKARI_FFMPEG_BIN ?? "ffmpeg",
    ffprobeCommand = process.env.FFPROBE ?? process.env.AKARI_FFPROBE_BIN ?? "ffprobe",
    queueDepth = 3,
    dumpFrames = [],
  } = options;
  if (!["stamp", "hash", "off"].includes(verify)) throw new Error(`unknown verify mode: ${verify}`);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(frames) || frames <= 0) {
    throw new Error("OSR duration and frame count must be positive");
  }
  const fromPixels = width * height;
  const toPixels = outputWidth * outputHeight;
  const outputScale = {
    from: [width, height],
    to: [outputWidth, outputHeight],
    mode: toPixels > fromPixels ? "up" : toPixels < fromPixels ? "down" : "none",
  };
  const memoryBudget = resolveMemoryBudget({ soft, env: process.env, width, height });

  if (soft && !app.isReady()) app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("force-color-profile", "srgb");
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.on("window-all-closed", () => {});
  if (!app.isReady()) await app.whenReady();
  // どの GPU に載ったか（Windows ハイブリッド機の診断・契約 §11.7）。3 秒で打ち切り、running / completed / failed の run.json に残す。
  const gpu = { platform: process.platform, chromium: process.versions.chrome, devices: await collectGpuDevices(app) };
  // 空 paint の失敗文に載せる「どの GPU に載ったか」（gpu.devices の active・無ければ unknown）。
  const activeDevice = summarizeGpuAdapters(gpu.devices)?.active_device ?? null;

  const built = await loadAndBuildOsrPage({
    projectRoot,
    editPath: editPath ?? join(projectRoot, "edit.json"),
    fps,
    width,
    height,
    duration,
    stampRow: true,
  });
  const rendererWarnings = new Set((built.warnings ?? []).map(String));
  const server = await startStaticServer({
    pageHtml: built.html,
    overlaySheetHtml: built.overlaySheetHtml,
    projectRoot,
    captionFontPath: findCaptionFontPath(),
  });
  let windowRef = null;
  let encoderSession = null;
  let fatalMemoryError = null;
  const memoryWarnings = [];
  const memoryTelemetry = { decoderSessions: null };
  const memorySampler = createMemorySampler({
    budget: memoryBudget,
    sample: () => {
      const total = app.getAppMetrics().reduce((sum, metric) => sum + Number(metric.memory?.workingSetSize ?? 0) * 1024, 0);
      return total > 0 ? total : process.memoryUsage().rss;
    },
    onWarning: (bytes) => memoryWarnings.push(`RSS warning: ${bytes} bytes`),
    onHardStop: (bytes) => { fatalMemoryError = memoryHardStopError(bytes); },
  });
  const stages = { seek: [], paint: [], toBitmap: [], verify: [], write: [] };
  const paintTimeouts = [];
  const emptyPaints = [];
  const retryHistogram = {};
  const preVerifyDeltaHistogram = {};
  const frameHashes = [];
  const dumpFrameNumbers = new Set(dumpFrames);
  let hashPolicyAmbiguous = 0;
  let retriesTotal = 0;
  let lastAcceptedHash = null;
  let viewport = null;
  let viewportContext = null;
  let warmUp = null;
  const captureStarted = performance.now();

  try {
    windowRef = new BrowserWindow({
      show: false,
      width,
      height: height + 1,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        preload: join(SOURCE_DIRECTORY, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    windowRef.webContents.setFrameRate(60);
    windowRef.webContents.startPainting();
    let rendererFailure = null;
    windowRef.webContents.on("render-process-gone", (_event, details) => {
      rendererFailure = new Error(`renderer process gone: ${details.reason}`);
    });
    await windowRef.loadURL(server.url);
    if (rendererFailure) throw rendererFailure;
    // Windows clamps the hidden window to the display work area when it is created (1920x1081 ->
    // 1920x1032 next to a 48 px taskbar) and the offscreen paint follows the content size. Pin the
    // window to the output size before the page renders; the frame loop fails closed if the paint
    // bitmap still disagrees (readPaintBitmap).
    ({ record: viewport, context: viewportContext } = await settleWindowViewport(windowRef, { width, height, paintTimeoutMs }));
    // Right after start-up the compositor answers paints with an empty bitmap (0x0 / 0 bytes) for a
    // while on Intel iGPU and RTX alike (contract §11.8). Wait for one non-empty paint before the
    // frame 0 seek (budget OSR_WARM_UP_BUDGET_MS) and discard it; fail closed past the budget.
    warmUp = await warmUpWindowPaint(windowRef, { width, height, paintTimeoutMs, paintTimeouts, viewport: viewportContext });
    if (!warmUp.satisfied) throw new Error(warmUpFailureMessage({ ...warmUp, activeDevice }));
    await writeFile(join(dirname(out), "run.json"), `${JSON.stringify({
      version: 1,
      status: "running",
      mode: soft ? "soft" : "gpu",
      framesRequested: frames,
      framesCompleted: 0,
      width, height, fps, duration, codec,
      output_scale: outputScale,
      gpu,
      viewport,
      warm_up: warmUp,
      warnings: [...rendererWarnings],
    }, null, 2)}\n`).catch(() => {});
    await windowRef.webContents.executeJavaScript("window.__akariReady");
    if (codec === "png") await mkdir(out, { recursive: true });
    encoderSession = startRawVideoEncoder({
      ffmpegCommand, outputPath: out, width, height, outputWidth, outputHeight, fps, quality, encoder, codec, edit: built.edit, queueDepth,
    });

    for (let frame = 0; frame < frames; frame += 1) {
      if (fatalMemoryError) throw fatalMemoryError;
      if (rendererFailure) throw rendererFailure;
      const capturedFrame = await captureFrameBitmap({
        windowRef,
        frame,
        fps,
        width,
        height,
        verify,
        paintTimeoutMs,
        paintTimeouts,
        emptyPaints,
        viewport: viewportContext,
        activeDevice,
        rendererWarnings,
        memoryTelemetry,
      });
      stages.seek.push(capturedFrame.seekMs);
      stages.paint.push(capturedFrame.paintMs);
      stages.toBitmap.push(capturedFrame.toBitmapMs);
      let bitmap = capturedFrame.bitmap;
      const preCheck = capturedFrame.preCheck;
      const delta = signedDelta(preCheck.frameNumber, preCheck.expectedFrameNumber, 65_536);
      preVerifyDeltaHistogram[String(delta)] = (preVerifyDeltaHistogram[String(delta)] ?? 0) + 1;
      let retries = capturedFrame.retries;
      const hashVerifyStarted = performance.now();
      if (verify === "hash") {
        let hash = sha256(stripStampRow(bitmap, width, height));
        while (lastAcceptedHash !== null && hash === lastAcceptedHash && retries < 8) {
          await settle(windowRef);
          const retryCapture = await captureFrameNonEmpty({
            windowRef, frame, width, height, paintTimeoutMs, paintTimeouts, emptyPaints, viewport: viewportContext, activeDevice,
          });
          bitmap = retryCapture.bitmap;
          hash = sha256(stripStampRow(bitmap, width, height));
          retries += 1;
        }
        if (lastAcceptedHash !== null && hash === lastAcceptedHash) hashPolicyAmbiguous += 1;
        lastAcceptedHash = hash;
      }
      stages.verify.push(capturedFrame.verifyMs + (verify === "hash" ? performance.now() - hashVerifyStarted : 0));
      retriesTotal += retries;
      retryHistogram[String(retries)] = (retryHistogram[String(retries)] ?? 0) + 1;

      const writeStarted = performance.now();
      const videoFrame = stripStampRow(bitmap, width, height);
      frameHashes.push(sha256(videoFrame));
      if (dumpFrameNumbers.has(frame)) {
        const rawDirectory = join(dirname(out), "raw");
        await mkdir(rawDirectory, { recursive: true });
        await writeFile(join(rawDirectory, `frame-${frame}.bgra`), videoFrame);
      }
      await encoderSession.write(videoFrame);
      stages.write.push(performance.now() - writeStarted);
      process.stdout.write(`PROGRESS frame=${frame + 1} total=${frames}\n`);
    }

    const encoded = await encoderSession.finish();
    encoderSession = null;
    const ffprobe = await verifyEncodedVideo({
      command: ffprobeCommand, path: out, frames, fps, width: outputWidth, height: outputHeight, codec,
    });
    if (!ffprobe.matched) throw new Error(`ffprobe verification failed: ${JSON.stringify(ffprobe.checks)}`);
    await destroyWindow(windowRef);
    windowRef = null;
    const memory = memorySampler.stop("afterDestroy");
    const afterDestroyMemory = memory.samples.at(-1)?.rssBytes ?? null;
    const run = {
      version: 1,
      status: "completed",
      mode: soft ? "soft" : "gpu",
      framesRequested: frames,
      framesCompleted: frames,
      width, height, fps, duration, codec,
      output_scale: outputScale,
      gpu,
      verify: { mode: verify, retriesTotal, retryHistogram, hashPolicyAmbiguous, preVerifyDeltaHistogram },
      frameHashes,
      stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, summarize(values)])),
      bucketMedians: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, bucketMedians(values)])),
      driftRatio: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, driftRatio(values)])),
      captureLoopMs: performance.now() - captureStarted,
      backpressure: encoded.backpressure,
      paintTimeouts,
      emptyPaints,
      memory: { ...memory, afterDestroyBytes: afterDestroyMemory, warnings: memoryWarnings, decoderSessions: memoryTelemetry.decoderSessions },
      viewport,
      warm_up: warmUp,
      ffprobe,
      warnings: [...rendererWarnings],
    };
    await writeFile(join(dirname(out), "run.json"), `${JSON.stringify(run, null, 2)}\n`);
    return run;
  } catch (error) {
    encoderSession?.abort(error);
    const failed = {
      version: 1,
      status: "failed",
      error: String(error?.stack ?? error),
      codec,
      framesRequested: frames,
      output_scale: outputScale,
      gpu,
      verify: { mode: verify, retriesTotal, retryHistogram, hashPolicyAmbiguous, preVerifyDeltaHistogram },
      frameHashes,
      paintTimeouts,
      emptyPaints,
      memory: { ...memorySampler.stop("failed"), decoderSessions: memoryTelemetry.decoderSessions },
      viewport,
      warm_up: warmUp,
      warnings: [...rendererWarnings],
    };
    await writeFile(join(dirname(out), "run.json"), `${JSON.stringify(failed, null, 2)}\n`).catch(() => {});
    throw error;
  } finally {
    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.destroy();
      windowRef.destroy();
    }
    await server.close().catch(() => {});
  }
}

export async function runOsrCapture(options) {
  const {
    projectRoot,
    editPath = null,
    out,
    outputDirectory,
    frameNumbers,
    fps = 30,
    width = 1920,
    height = 1080,
    duration,
    frames = Math.round(duration * fps),
    soft = false,
    paintTimeoutMs = 10_000,
  } = options;
  const requestedFrames = normalizeCaptureFrames(frameNumbers, frames);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(frames) || frames <= 0) {
    throw new Error("OSR capture duration and frame count must be positive");
  }
  if (!out || !outputDirectory) throw new Error("OSR capture requires out and outputDirectory");

  if (soft && !app.isReady()) app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("force-color-profile", "srgb");
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.on("window-all-closed", () => {});
  if (!app.isReady()) await app.whenReady();
  const gpu = { platform: process.platform, chromium: process.versions.chrome, devices: await collectGpuDevices(app) };
  const activeDevice = summarizeGpuAdapters(gpu.devices)?.active_device ?? null;

  await mkdir(outputDirectory, { recursive: true });
  await mkdir(dirname(out), { recursive: true });
  const built = await loadAndBuildOsrPage({
    projectRoot,
    editPath: editPath ?? join(projectRoot, "edit.json"),
    fps,
    width,
    height,
    duration,
    stampRow: true,
  });
  const rendererWarnings = new Set((built.warnings ?? []).map(String));
  const server = await startStaticServer({
    pageHtml: built.html,
    overlaySheetHtml: built.overlaySheetHtml,
    projectRoot,
    captionFontPath: findCaptionFontPath(),
  });
  const paintTimeouts = [];
  const emptyPaints = [];
  const verifyFrames = [];
  const outputs = [];
  let windowRef = null;
  let viewport = null;
  let viewportContext = null;
  let warmUp = null;
  const started = performance.now();
  try {
    windowRef = new BrowserWindow({
      show: false,
      width,
      height: height + 1,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        preload: join(SOURCE_DIRECTORY, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    windowRef.webContents.setFrameRate(60);
    windowRef.webContents.startPainting();
    let rendererFailure = null;
    windowRef.webContents.on("render-process-gone", (_event, details) => {
      rendererFailure = new Error(`renderer process gone: ${details.reason}`);
    });
    await windowRef.loadURL(server.url);
    if (rendererFailure) throw rendererFailure;
    ({ record: viewport, context: viewportContext } = await settleWindowViewport(windowRef, { width, height, paintTimeoutMs }));
    // Same start-up warm-up as the export path (contract §11.8): one non-empty paint before the first seek.
    warmUp = await warmUpWindowPaint(windowRef, { width, height, paintTimeoutMs, paintTimeouts, viewport: viewportContext });
    if (!warmUp.satisfied) throw new Error(warmUpFailureMessage({ ...warmUp, activeDevice }));
    await writeFile(out, `${JSON.stringify({
      version: 1,
      status: "running",
      operation: "capture",
      mode: soft ? "soft" : "gpu",
      framesRequested: requestedFrames,
      framesCompleted: 0,
      width, height, fps, duration,
      gpu,
      viewport,
      warm_up: warmUp,
      warnings: [...rendererWarnings],
    }, null, 2)}\n`, "utf8").catch(() => {});
    await windowRef.webContents.executeJavaScript("window.__akariReady");
    for (const [index, frame] of requestedFrames.entries()) {
      if (rendererFailure) throw rendererFailure;
      const captured = await captureFrameBitmap({
        windowRef,
        frame,
        fps,
        width,
        height,
        verify: "stamp",
        paintTimeoutMs,
        paintTimeouts,
        emptyPaints,
        viewport: viewportContext,
        activeDevice,
        rendererWarnings,
      });
      const pixels = stripStampRow(captured.bitmap, width, height);
      const outputPath = join(outputDirectory, `frame-${frame}.png`);
      await writeFile(outputPath, encodeBgraPng(pixels, width, height));
      const stamp = verifyStamp(captured.bitmap, width, height, frame);
      verifyFrames.push({
        frameNumber: frame,
        matched: stamp.exact,
        decodedFrameNumber: stamp.frameNumber,
        expectedFrameNumber: stamp.expectedFrameNumber,
        retries: captured.retries,
      });
      outputs.push({ frameNumber: frame, path: outputPath, sha256: sha256(pixels) });
      process.stdout.write(`PROGRESS frame=${index + 1} total=${requestedFrames.length}\n`);
    }
    await destroyWindow(windowRef);
    windowRef = null;
    const run = {
      version: 1,
      status: "completed",
      operation: "capture",
      mode: soft ? "soft" : "gpu",
      framesRequested: requestedFrames,
      framesCompleted: requestedFrames.length,
      width,
      height,
      fps,
      duration,
      gpu,
      verify: {
        mode: "stamp",
        matched: verifyFrames.every((entry) => entry.matched),
        frames: verifyFrames,
      },
      outputs,
      paintTimeouts,
      emptyPaints,
      page: built.manifest,
      viewport,
      warm_up: warmUp,
      elapsedMs: performance.now() - started,
      warnings: [...rendererWarnings],
    };
    await writeFile(out, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    return run;
  } catch (error) {
    await writeFile(out, `${JSON.stringify({
      version: 1,
      status: "failed",
      operation: "capture",
      error: String(error?.stack ?? error),
      framesRequested: requestedFrames,
      gpu,
      verify: { mode: "stamp", matched: false, frames: verifyFrames },
      paintTimeouts,
      emptyPaints,
      viewport,
      warm_up: warmUp,
      warnings: [...rendererWarnings],
    }, null, 2)}\n`, "utf8").catch(() => {});
    throw error;
  } finally {
    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.destroy();
      windowRef.destroy();
    }
    await server.close().catch(() => {});
  }
}

export function parseElectronArguments(argv) {
  const options = {
    projectRoot: null, editPath: null, out: null, fps: 30, width: 1920, height: 1080,
    duration: null, frames: null, quality: "high", encoder: "auto", codec: "h264", verify: "stamp", soft: false,
    queueDepth: 3, dumpFrames: [], captureFrames: null, captureOutputDirectory: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--render") options.projectRoot = required(argv, ++index, "--render");
    else if (argument === "--edit") options.editPath = required(argv, ++index, "--edit");
    else if (argument === "--out") options.out = required(argv, ++index, "--out");
    else if (argument === "--fps") options.fps = positiveNumber(required(argv, ++index, "--fps"), "--fps");
    else if (argument === "--width") options.width = positiveInteger(required(argv, ++index, "--width"), "--width");
    else if (argument === "--height") options.height = positiveInteger(required(argv, ++index, "--height"), "--height");
    else if (argument === "--output-width") options.outputWidth = positiveInteger(required(argv, ++index, "--output-width"), "--output-width");
    else if (argument === "--output-height") options.outputHeight = positiveInteger(required(argv, ++index, "--output-height"), "--output-height");
    else if (argument === "--duration") options.duration = positiveNumber(required(argv, ++index, "--duration"), "--duration");
    else if (argument === "--frames") options.frames = positiveInteger(required(argv, ++index, "--frames"), "--frames");
    else if (argument === "--quality") options.quality = required(argv, ++index, "--quality");
    else if (argument === "--encoder") options.encoder = required(argv, ++index, "--encoder");
    else if (argument === "--codec") options.codec = codecValue(required(argv, ++index, "--codec"));
    else if (argument === "--verify") options.verify = required(argv, ++index, "--verify");
    else if (argument === "--queue-depth") options.queueDepth = positiveInteger(required(argv, ++index, "--queue-depth"), "--queue-depth");
    else if (argument === "--dump-frames") options.dumpFrames = parseFrameList(required(argv, ++index, "--dump-frames"));
    else if (argument === "--capture-frames") options.captureFrames = parseFrameList(required(argv, ++index, "--capture-frames"));
    else if (argument === "--capture-output-dir") options.captureOutputDirectory = required(argv, ++index, "--capture-output-dir");
    else if (argument === "--soft") options.soft = true;
  }
  if (!options.projectRoot || !options.out) throw new Error("--render and --out are required");
  if (options.duration === null && options.frames !== null) options.duration = options.frames / options.fps;
  if (options.frames === null && options.duration !== null) options.frames = Math.round(options.duration * options.fps);
  if (options.captureFrames !== null && (options.captureFrames.length === 0 || !options.captureOutputDirectory)) {
    throw new Error("--capture-frames requires at least one frame and --capture-output-dir");
  }
  return options;
}

async function captureFrameBitmap({
  windowRef,
  frame,
  fps,
  width,
  height,
  verify,
  paintTimeoutMs,
  paintTimeouts,
  emptyPaints,
  viewport = null,
  activeDevice = null,
  rendererWarnings = null,
  memoryTelemetry = null,
}) {
  const seekStarted = performance.now();
  const seekResult = await windowRef.webContents.executeJavaScript(`window.__akariSeek(${JSON.stringify(frame / fps)},${frame})`);
  collectRendererWarnings(rendererWarnings, seekResult);
  if (memoryTelemetry && seekResult?.decoderSessions) memoryTelemetry.decoderSessions = seekResult.decoderSessions;
  const seekMs = performance.now() - seekStarted;
  const nonEmpty = { windowRef, frame, width, height, paintTimeoutMs, paintTimeouts, emptyPaints, viewport, activeDevice };
  let captured = await captureFrameNonEmpty(nonEmpty);
  let bitmap = captured.bitmap;
  const paintMs = captured.paintMs;
  const toBitmapMs = captured.toBitmapMs;
  const verifyStarted = performance.now();
  const preCheck = verifyStamp(bitmap, width, height, frame);
  let retries = 0;
  if (verify === "stamp") {
    while (!verifyStamp(bitmap, width, height, frame).exact && retries < 8) {
      await settle(windowRef);
      captured = await captureFrameNonEmpty(nonEmpty);
      bitmap = captured.bitmap;
      retries += 1;
    }
    if (!verifyStamp(bitmap, width, height, frame).exact) {
      throw new Error(`frame ${frame} stamp verify failed after ${retries} retries`);
    }
  }
  return {
    bitmap,
    preCheck,
    retries,
    seekMs,
    paintMs,
    toBitmapMs,
    verifyMs: performance.now() - verifyStarted,
  };
}

/** Adds renderer warnings in first-seen order; repeated seeks never duplicate run.json entries. */
export function collectRendererWarnings(target, seekResult) {
  if (!(target instanceof Set) || !Array.isArray(seekResult?.warnings)) return target;
  for (const warning of seekResult.warnings) target.add(String(warning));
  return target;
}

// One frame's non-empty bitmap. Empty paints go to run.json emptyPaints[] as { frame, attempts, elapsed_ms }
// (elapsed counted from the start of this call; repeated calls for the same frame add up). The time /
// count budget and the failure line (attempts, ms, active GPU) live in paint-bitmap.mjs (contract §11.8).
function captureFrameNonEmpty({ windowRef, frame, width, height, paintTimeoutMs, paintTimeouts, emptyPaints, viewport, activeDevice }) {
  return captureNonEmptyBitmap({
    frame,
    width,
    height,
    capture: () => capturePaint(windowRef.webContents, paintTimeoutMs, frame, paintTimeouts),
    settle: () => settle(windowRef),
    onEmpty: createEmptyPaintRecorder(emptyPaints, frame),
    viewport,
    activeDevice,
  });
}

// Start-up warm-up (contract §11.8 ruling 1): right after settleWindowViewport and before the frame 0 seek,
// keep requesting paints (settle in between) until one non-empty bitmap arrives or OSR_WARM_UP_BUDGET_MS
// passes. The bitmap is discarded; the caller fails closed on `satisfied: false` and records the result.
function warmUpWindowPaint(windowRef, { width, height, paintTimeoutMs, paintTimeouts, viewport }) {
  return warmUpOffscreenPaint({
    capture: () => capturePaint(windowRef.webContents, paintTimeoutMs, "warm-up", paintTimeouts),
    settle: () => settle(windowRef),
    readBitmap: (image) => readPaintBitmap(image, width, height, "warm-up", viewport),
    budgetMs: OSR_WARM_UP_BUDGET_MS,
  });
}

async function capturePaint(webContents, timeoutMs, frame, paintTimeouts) {
  return new Promise((resolvePromise, rejectPromise) => {
    const onPaint = (_event, _dirtyRect, image) => { cleanup(); resolvePromise(image); };
    const timer = setTimeout(() => {
      cleanup();
      paintTimeouts.push({ frame, timeoutMs });
      rejectPromise(new Error(`paint timeout for frame ${frame} after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); webContents.off("paint", onPaint); };
    webContents.once("paint", onPaint);
    webContents.invalidate();
  });
}

async function settle(windowRef) {
  await windowRef.webContents.executeJavaScript("window.__akariSettle()");
}

/**
 * Offscreen window viewport pinning (task 2026-09-01-osr-window-workarea-clamp).
 *
 * Measured on Windows 11 / Electron 39 (1920x1080 display, 1920x1032 work area):
 * - `new BrowserWindow({ show: false, width: 1920, height: 1081, useContentSize: true, offscreen })`
 *   already reports getContentSize() 1920x1032 before loadURL; the page viewport and the paint
 *   bitmap follow (1920x1032). 1280x721 is untouched.
 * - `setContentSize(1920, 1081)` fixes content size and page viewport synchronously, but the paint
 *   bitmap catches up a few frames later (~2 rAF at 1080p, ~400 ms at 3840x2161), so the
 *   re-measurement keeps requesting paints until one has the expected size or the timeout passes.
 * - `enableDeviceEmulation` alone changes innerWidth / innerHeight but not the paint size, so it is
 *   only the fallback after setContentSize; the frame loop (readPaintBitmap) is the final guard.
 */
const VIEWPORT_SETTLE_TIMEOUT_MS = 2_000;
const VIEWPORT_SETTLE_POLL_MS = 50;

// Runs inside the page. setContentSize / device emulation reach the renderer asynchronously, so the
// re-measurement waits for the viewport to reach the expected size (resize event + 50 ms polling,
// up to the timeout) before reporting.
const PAGE_VIEWPORT_PROBE = String((expected, timeoutMs) => new Promise((resolve) => {
  const read = () => [window.innerWidth, window.innerHeight, window.devicePixelRatio];
  const matches = () => expected !== null
    && window.innerWidth === expected.width && window.innerHeight === expected.height && window.devicePixelRatio === 1;
  if (expected === null || timeoutMs <= 0 || matches()) { resolve(read()); return; }
  const started = performance.now();
  let timer = null;
  const finish = () => { window.removeEventListener("resize", check); clearInterval(timer); resolve(read()); };
  const check = () => { if (matches() || performance.now() - started >= timeoutMs) finish(); };
  window.addEventListener("resize", check);
  timer = setInterval(check, 50);
}));
const PAGE_SETTLE_FRAMES = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))";

async function measurePageViewport(webContents, { expected = null, timeoutMs = 0 } = {}) {
  const [width, height, devicePixelRatio] = await webContents.executeJavaScript(
    `(${PAGE_VIEWPORT_PROBE})(${JSON.stringify(expected)}, ${Number(timeoutMs)})`,
  );
  return { width, height, devicePixelRatio };
}

function contentSizeOf(windowRef) {
  const [width, height] = windowRef.getContentSize();
  return { width, height };
}

// Keeps requesting paints (2 rAF + 50 ms between attempts) until one is non-empty and has the
// expected size, or the timeout passes. Returns the last non-empty paint size (null when none).
async function waitForPaintSize(windowRef, expected, { timeoutMs, paintTimeoutMs }) {
  const started = performance.now();
  let last = null;
  for (;;) {
    const image = await capturePaint(windowRef.webContents, paintTimeoutMs, "viewport", []).catch(() => null);
    const size = image?.getSize() ?? null;
    if (size && size.width > 0 && size.height > 0) last = size;
    if (last && last.width === expected.width && last.height === expected.height) return last;
    if (performance.now() - started >= timeoutMs) return last;
    await windowRef.webContents.executeJavaScript(PAGE_SETTLE_FRAMES).catch(() => {});
    await new Promise((resolvePromise) => setTimeout(resolvePromise, VIEWPORT_SETTLE_POLL_MS));
  }
}

async function measureSettledViewport(windowRef, requested, paintTimeoutMs) {
  const page = await measurePageViewport(windowRef.webContents, { expected: requested, timeoutMs: VIEWPORT_SETTLE_TIMEOUT_MS });
  const paint = await waitForPaintSize(windowRef, requested, { timeoutMs: VIEWPORT_SETTLE_TIMEOUT_MS, paintTimeoutMs });
  return { width: paint?.width ?? page.width, height: paint?.height ?? page.height, devicePixelRatio: page.devicePixelRatio };
}

async function settleWindowViewport(windowRef, { width, height, paintTimeoutMs }) {
  const requested = osrPageSize(width, height);
  const primary = screen.getPrimaryDisplay();
  const content = contentSizeOf(windowRef);
  let measured = await measurePageViewport(windowRef.webContents);
  let resized = false;
  let emulated = false;
  if (content.width !== requested.width || content.height !== requested.height || !viewportMatches(requested, measured)) {
    resized = true;
    windowRef.setContentSize(requested.width, requested.height);
    measured = await measureSettledViewport(windowRef, requested, paintTimeoutMs);
  }
  if (!viewportMatches(requested, measured)) {
    emulated = true;
    windowRef.webContents.enableDeviceEmulation(deviceEmulationParameters(requested));
    measured = await measureSettledViewport(windowRef, requested, paintTimeoutMs);
  }
  const record = viewportRecord({ requested, measured, emulated, display: primary.size, workArea: primary.workAreaSize });
  return { record, context: { ...record, devicePixelRatio: measured.devicePixelRatio, resized } };
}

function summarize(values) {
  return { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? ordered[lower] : ordered[lower] * (upper - index) + ordered[upper] * (index - lower);
}

function bucketMedians(values) {
  const result = [];
  for (let start = 0; start < values.length; start += 1000) result.push({ startFrame: start, endFrame: Math.min(values.length, start + 1000) - 1, median: percentile(values.slice(start, start + 1000), 0.5) });
  return result;
}

function driftRatio(values) {
  if (values.length < 2) return null;
  const size = Math.min(1000, Math.floor(values.length / 2));
  const first = percentile(values.slice(0, size), 0.5);
  const last = percentile(values.slice(-size), 0.5);
  return first > 0 ? last / first : null;
}

function signedDelta(decoded, expected, modulus) {
  const half = modulus / 2;
  return ((decoded - expected + half) % modulus) - half;
}

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

function findCaptionFontPath() {
  return [
    resolve(process.resourcesPath ?? "", "assets", "font", "noto-sans-jp", "NotoSansJP-Variable.ttf"),
    resolve(SOURCE_DIRECTORY, "../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"),
  ].find(existsSync) ?? null;
}

async function destroyWindow(windowRef) {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.destroy();
  windowRef.destroy();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function required(argv, index, option) { if (index >= argv.length) throw new Error(`${option} requires a value`); return argv[index]; }
function positiveNumber(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} requires a positive number`); return number; }
function positiveInteger(value, label) { const number = positiveNumber(value, label); if (!Number.isInteger(number)) throw new Error(`${label} requires an integer`); return number; }
function codecValue(value) { if (!["h264", "hevc", "prores422", "png"].includes(value)) throw new Error(`--codec must be h264|hevc|prores422|png, got: ${value}`); return value; }
function parseFrameList(value) {
  if (value === "") return [];
  return [...new Set(value.split(",").map((entry) => {
    const frame = Number(entry);
    if (!Number.isInteger(frame) || frame < 0) throw new Error(`--dump-frames requires non-negative integers, got: ${entry}`);
    return frame;
  }))].sort((left, right) => left - right);
}

function normalizeCaptureFrames(frameNumbers, totalFrames) {
  if (!Array.isArray(frameNumbers) || frameNumbers.length === 0) {
    throw new Error("OSR capture requires at least one frame number");
  }
  const result = [...new Set(frameNumbers.map((frame) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= totalFrames) {
      throw new Error(`OSR capture frame ${frame} is outside 0..${totalFrames - 1}`);
    }
    return frame;
  }))].sort((left, right) => left - right);
  return result;
}

async function runCli() {
  let code = 0;
  try {
    const options = parseElectronArguments(process.argv.slice(2));
    if (options.captureFrames !== null) {
      await runOsrCapture({
        ...options,
        frameNumbers: options.captureFrames,
        outputDirectory: options.captureOutputDirectory,
      });
    } else {
      await runOsrExport(options);
    }
  }
  catch (error) { code = 1; process.stderr.write(`${String(error?.stack ?? error)}\n`); }
  finally { app.exit(code); }
}

const modulePath = realpathSync(fileURLToPath(import.meta.url));
const invoked = process.argv.slice(1).some((argument) => {
  try { return realpathSync(argument) === modulePath; }
  catch { return false; }
});
if (invoked) void runCli();
else if (process.argv.slice(1).some((argument) => argument.endsWith("electron-main.mjs"))) {
  process.stderr.write("OSR Electron main の直接起動を判定できませんでした\n");
  app.exit(2);
}
