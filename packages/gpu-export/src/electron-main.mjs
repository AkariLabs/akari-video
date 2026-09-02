import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import electron from "electron";

import { verifyEncodedVideo } from "../../osr-export/src/ffprobe.mjs";
import { collectGpuDevices } from "../../osr-export/src/gpu-adapters.mjs";
import { createMemorySampler, resolveMemoryBudget } from "../../osr-export/src/memory.mjs";
import { encodeRgbaPng } from "../../osr-export/src/png.mjs";
import { startStaticServer } from "../../osr-export/src/static-server.mjs";
import { loadAndBuildGpuPage } from "./page-builder.mjs";
import { createIncrementalMp4Writer } from "./mp4-mux.mjs";
import { resolveGpuEncoding } from "./bitrate.mjs";
import { CAPTION_MEASURE_UNSTABLE_REASON } from "./eligibility.mjs";
import { extractGpuDiagnostics, stripGpuDiagnosticsMarker } from "./gpu-diagnostics.mjs";

const { app, BrowserWindow, ipcMain } = electron;
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const VERIFY_READBACK_PATH = join(SOURCE_DIRECTORY, "verify-readback.js");
const CAPTION_MEASURE_DIFF_MARKER = "AKARI_CAPTION_MEASURE_DIFFS:";
const HEVC_UNSUPPORTED_REASON = "hevc-unsupported";
const DOM_LAYER_SWITCHES = Object.freeze([
  ["enable-features", "CanvasDrawElement"],
  ["disable-gpu-vsync", null],
  ["disable-frame-rate-limit", null],
]);

export async function runGpuExport(options) {
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
    queueDepth = 4,
    quality = "high",
    bitrate = undefined,
    codec = "h264",
    soft = false,
    trapReadback = false,
    verifyFrames = false,
    dumpFrames = [],
    captureFrames = null,
    captureOutputDirectory = null,
    processTimeoutMs = Math.max(300_000, frames * 1_000),
    ffprobeCommand = process.env.FFPROBE ?? process.env.AKARI_FFPROBE_BIN ?? "ffprobe",
  } = options;
  const captureMode = captureFrames !== null;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(frames) || frames <= 0) {
    throw new Error("GPU duration and frame count must be positive");
  }
  const requestedCaptureFrames = captureMode ? normalizeCaptureFrames(captureFrames, frames) : null;
  const requestedDumpFrames = normalizeOptionalFrameList(dumpFrames, frames, "GPU dump");
  if (captureMode && !captureOutputDirectory) {
    throw new Error("GPU capture requires captureOutputDirectory");
  }
  if (trapReadback && (verifyFrames || requestedDumpFrames.length > 0)) {
    throw new Error("--trap-readback cannot be combined with --verify-frames or --dump-frames");
  }
  if (!["h264", "hevc"].includes(codec)) throw new Error(`GPU codec must be h264|hevc, got: ${codec}`);
  const encoding = resolveGpuEncoding({ quality, bitrate, width: outputWidth, height: outputHeight, codec });
  const outputScale = {
    from: [width, height],
    to: [outputWidth, outputHeight],
    mode: outputWidth * outputHeight > width * height
      ? "up"
      : outputWidth * outputHeight < width * height ? "down" : "none",
  };
  if (soft && !app.isReady()) app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("force-color-profile", "srgb");
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  const domLayerFlags = DOM_LAYER_SWITCHES.map(([name, value]) => {
    if (value === null) app.commandLine.appendSwitch(name);
    else app.commandLine.appendSwitch(name, value);
    return `--${name}${value === null ? "" : `=${value}`}`;
  });
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.on("window-all-closed", () => {});
  if (!app.isReady()) await app.whenReady();
  // どの GPU に載ったか（Windows ハイブリッド機の診断・gpu 契約 §8.1）。3 秒で打ち切り、completed / failed の両方の run.json に残す。
  const gpuDevices = await collectGpuDevices(app);

  const built = await loadAndBuildGpuPage({
    projectRoot,
    editPath: editPath ?? join(projectRoot, "edit.json"),
    fps,
    width,
    height,
    duration,
  });
  if (!built.eligibility.eligible) {
    throw new Error(`GPU eligibility failed: ${formatEligibilityFailures(built.eligibility)}`);
  }
  const server = await startStaticServer({
    pageHtml: built.html,
    overlaySheetHtml: built.overlaySheetHtml,
    projectRoot,
    captionFontPath: findCaptionFontPath(),
  });
  const memoryBudget = resolveMemoryBudget({ soft, env: process.env, width, height });
  let fatalMemoryError = null;
  const memoryWarnings = [];
  const memorySampler = createMemorySampler({
    budget: memoryBudget,
    sample: () => {
      const total = app.getAppMetrics().reduce((sum, metric) => sum + Number(metric.memory?.workingSetSize ?? 0) * 1024, 0);
      return total > 0 ? total : process.memoryUsage().rss;
    },
    onWarning: (bytes) => memoryWarnings.push(`RSS warning: ${bytes} bytes`),
    onHardStop: (bytes) => { fatalMemoryError = new Error(`RSS hard stop: ${bytes} bytes`); },
  });
  const runPath = captureMode ? out : join(dirname(out), "run.json");
  const runtimeConfig = {
    frames,
    queueDepth,
    quality: encoding.quality,
    bitrate: encoding.bitrate,
    codec,
    outputWidth,
    outputHeight,
    soft,
    trapReadback,
    verifyFrames,
    dumpFrames: requestedDumpFrames,
    captureFrames: requestedCaptureFrames,
    domLayerFlags,
    ...(process.env.AKARI_GPU_CAPTION_MEASURE_FAULT
      ? { captionMeasureFault: process.env.AKARI_GPU_CAPTION_MEASURE_FAULT }
      : {}),
    ...(verifyFrames || captureMode || requestedDumpFrames.length > 0
      ? { verifyReadbackModule: await readFile(VERIFY_READBACK_PATH, "utf8") }
      : {}),
  };
  let windowRef = null;
  let chunkState = null;
  let rendererFailure = null;
  let viewport = null;
  const channels = [
    "gpu:config", "gpu:log", "gpu:checkpoint", "gpu:chunks-start", "gpu:chunk", "gpu:chunks-finish",
    "gpu:capture-frame",
    "gpu:dump-frame",
  ];

  const register = (channel, handler) => ipcMain.handle(channel, handler);
  register("gpu:config", () => runtimeConfig);
  register("gpu:log", (_event, message) => { process.stdout.write(`[gpu-renderer] ${message}\n`); return true; });
  register("gpu:checkpoint", async (_event, value) => {
    if (fatalMemoryError) throw fatalMemoryError;
    const running = {
      ...value,
      gpu: {
        ...value?.gpu,
        platform: process.platform,
        chromium: process.versions.chrome,
        devices: gpuDevices,
      },
      memory: memorySampler.snapshot(),
      eligibility: built.eligibility,
      viewport,
      output_scale: outputScale,
    };
    await writeFile(runPath, `${JSON.stringify(running, null, 2)}\n`);
    if (Number.isInteger(value?.framesCompleted)) {
      const total = captureMode ? requestedCaptureFrames.length : frames;
      process.stdout.write(`PROGRESS frame=${value.framesCompleted} total=${total}\n`);
    }
    return true;
  });
  register("gpu:chunks-start", async (_event, value) => {
    if (chunkState) throw new Error("chunk sink is already running");
    if ((value?.codec ?? "h264") !== codec) throw new Error(`renderer codec ${value?.codec} does not match main codec ${codec}`);
    await mkdir(dirname(out), { recursive: true });
    const writer = await createIncrementalMp4Writer({
      outputPath: out, width: outputWidth, height: outputHeight, fps, frames, codec,
    });
    chunkState = { writer };
    return true;
  });
  register("gpu:chunk", async (_event, value) => {
    if (!chunkState) throw new Error("chunk sink is not running");
    if (value?.description?.length > 0) chunkState.writer.setDecoderConfig(value.description, codec);
    return chunkState.writer.write(value);
  });
  register("gpu:chunks-finish", async () => {
    if (!chunkState) throw new Error("chunk sink is not running");
    const state = chunkState;
    const mux = await state.writer.finish();
    const ffprobe = normalizeCodecVerification(await verifyEncodedVideo({
      command: ffprobeCommand, path: out, frames, fps, width: outputWidth, height: outputHeight,
    }), codec);
    if (!ffprobe.matched) throw new Error(`GPU ffprobe verification failed: ${JSON.stringify(ffprobe.checks)}`);
    chunkState = null;
    return { ...mux, ffprobe };
  });
  register("gpu:capture-frame", async (_event, value) => {
    if (!captureMode) throw new Error("GPU capture frame received during export");
    const frameNumber = Number(value?.frameNumber);
    if (!requestedCaptureFrames.includes(frameNumber)) {
      throw new Error(`unexpected GPU capture frame: ${value?.frameNumber}`);
    }
    const rgba = Buffer.from(value.rgba);
    const outputPath = join(captureOutputDirectory, `frame-${frameNumber}.png`);
    await mkdir(captureOutputDirectory, { recursive: true });
    await writeFile(outputPath, encodeRgbaPng(rgba, width, height));
    return { frameNumber, path: outputPath, bytes: rgba.length };
  });
  register("gpu:dump-frame", async (_event, value) => {
    const frameNumber = Number(value?.frameNumber);
    if (!requestedDumpFrames.includes(frameNumber)) {
      throw new Error(`unexpected GPU dump frame: ${value?.frameNumber}`);
    }
    const rgba = Buffer.from(value.rgba);
    const outputPath = gpuRawFramePath(out, frameNumber);
    await mkdir(dirname(outputPath), { recursive: true });
    // Raw bytes are top-to-bottom rows, with RGBA channel order and 8 bits per channel.
    await writeFile(outputPath, rgba);
    return { frameNumber, path: outputPath, bytes: rgba.length };
  });

  try {
    windowRef = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        backgroundThrottling: false,
        preload: join(SOURCE_DIRECTORY, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    windowRef.webContents.on("render-process-gone", (_event, details) => {
      rendererFailure = new Error(`GPU renderer process gone: ${details.reason}`);
    });
    await windowRef.loadURL(server.url);
    if (rendererFailure) throw rendererFailure;
    // Windows clamps a BrowserWindow to the physical display, so an output larger than the screen
    // (issue #40 §1: 3840x2160 on a 1920x1080 display) resolves vw / vh against the clamped
    // window. Measure the page viewport, pin it to the output size with device emulation when it
    // differs, and fail closed when the page still disagrees with the requested output.
    viewport = await settleWindowViewport(windowRef.webContents, { width, height });
    if (rendererFailure) throw rendererFailure;
    const result = await executeWithTimeout(
      windowRef.webContents.executeJavaScript("window.__akariGpuRun()"),
      processTimeoutMs,
      `GPU renderer exceeded ${processTimeoutMs}ms`,
    );
    if (rendererFailure) throw rendererFailure;
    await destroyWindow(windowRef);
    windowRef = null;
    const memory = memorySampler.stop("afterDestroy");
    const run = {
      version: 1,
      ...result,
      mode: soft ? "soft" : "gpu",
      width,
      height,
      output_scale: outputScale,
      codec,
      fps,
      duration,
      gpu: {
        ...result?.gpu,
        platform: process.platform,
        chromium: process.versions.chrome,
        devices: gpuDevices,
      },
      memory: { ...memory, warnings: memoryWarnings },
      eligibility: built.eligibility,
      viewport,
      ffprobe: result?.mux?.ffprobe ?? null,
    };
    await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
    return run;
  } catch (error) {
    const reasonCode = gpuFailureReasonCode(error);
    const captionMeasureDiffs = extractCaptionMeasureDiffs(error);
    // page-runtime の unsupported throw が添えた renderer / encoder_support（プロパティ、または message 末尾の marker）を
    // 失敗の run.json に残し、記録と再 throw する error からは marker を外す。
    const gpuDiagnostics = extractGpuDiagnostics(error);
    if (error instanceof Error) {
      error.message = stripGpuDiagnosticsMarker(error.message);
      if (typeof error.stack === "string") error.stack = stripGpuDiagnosticsMarker(error.stack);
    }
    const failed = {
      version: 1,
      status: "failed",
      error: stripGpuDiagnosticsMarker(String(error?.stack ?? error)),
      codec,
      ...(reasonCode ? { reasonCode, warnings: [`${reasonCode}: GPU export failed closed`] } : {}),
      framesRequested: frames,
      gpu: {
        platform: process.platform,
        chromium: process.versions.chrome,
        renderer: gpuDiagnostics?.renderer ?? null,
        encoder_support: gpuDiagnostics?.encoder_support ?? null,
        devices: gpuDevices,
        ...(captionMeasureDiffs ? { captionMeasureDiffs } : {}),
      },
      memory: memorySampler.stop("failed"),
      eligibility: built.eligibility,
      viewport: viewport ?? error?.viewport ?? null,
      output_scale: outputScale,
    };
    await writeFile(runPath, `${JSON.stringify(failed, null, 2)}\n`).catch(() => {});
    throw error;
  } finally {
    for (const channel of channels) ipcMain.removeHandler(channel);
    if (chunkState) {
      await chunkState.writer.abort().catch(() => {});
      chunkState = null;
    }
    if (windowRef && !windowRef.isDestroyed()) await destroyWindow(windowRef);
    await server.close().catch(() => {});
  }
}

export function gpuFailureReasonCode(error) {
  const message = String(error?.stack ?? error);
  if (message.includes(HEVC_UNSUPPORTED_REASON)) return HEVC_UNSUPPORTED_REASON;
  return message.includes(CAPTION_MEASURE_UNSTABLE_REASON) ? CAPTION_MEASURE_UNSTABLE_REASON : null;
}

export function normalizeCodecVerification(verification, codec = "h264") {
  if (codec === "h264") return verification;
  const video = verification?.measured?.streams?.find((stream) => stream.codec_type === "video");
  const checks = { ...(verification?.checks ?? {}), codec: video?.codec_name === "hevc" };
  return { ...verification, checks, matched: Object.values(checks).every(Boolean) };
}

export function extractCaptionMeasureDiffs(error) {
  if (error?.captionMeasureDiffs && typeof error.captionMeasureDiffs === "object") {
    return error.captionMeasureDiffs;
  }
  const message = String(error?.stack ?? error);
  const start = message.indexOf(CAPTION_MEASURE_DIFF_MARKER);
  if (start < 0) return null;
  const encoded = message.slice(start + CAPTION_MEASURE_DIFF_MARKER.length).split(/\s/u, 1)[0];
  try { return JSON.parse(decodeURIComponent(encoded)); }
  catch { return null; }
}

/**
 * Viewport pinning for outputs larger than the physical display (issue #40 §1).
 *
 * The pure helpers below take plain numbers so they can be unit-tested without Electron:
 * - `viewportMatches` compares the measured page viewport with the requested output.
 * - `deviceEmulationParameters` builds the `webContents.enableDeviceEmulation` argument.
 * - `planViewport` decides whether emulation is needed.
 * - `verifyViewport` builds the run.json / receipt `viewport` record and throws (fail closed)
 *   when the page still does not match the requested output.
 */
export function viewportMatches(requested, measured) {
  return Number(measured?.width) === Number(requested?.width)
    && Number(measured?.height) === Number(requested?.height)
    && Number(measured?.devicePixelRatio ?? 1) === 1;
}

export function deviceEmulationParameters({ width, height }) {
  return {
    screenPosition: "desktop",
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width, height },
    deviceScaleFactor: 1,
    scale: 1,
  };
}

export function planViewport({ requested, measured }) {
  return viewportMatches(requested, measured)
    ? { emulate: false, parameters: null }
    : { emulate: true, parameters: deviceEmulationParameters(requested) };
}

export function viewportRecord({ requested, measured, emulated, display }) {
  return {
    requested: { width: Number(requested?.width), height: Number(requested?.height) },
    measured: { width: Number(measured?.width), height: Number(measured?.height) },
    emulated: Boolean(emulated),
    display: { width: Number(display?.width), height: Number(display?.height) },
  };
}

export function verifyViewport({ requested, measured, emulated = false, display = {} }) {
  const record = viewportRecord({ requested, measured, emulated, display });
  if (viewportMatches(requested, measured)) return record;
  const error = new Error(
    `GPU viewport mismatch${emulated ? " after device emulation" : ""}: `
    + `requested ${record.requested.width}x${record.requested.height} (devicePixelRatio 1), `
    + `measured ${record.measured.width}x${record.measured.height} `
    + `(devicePixelRatio ${Number(measured?.devicePixelRatio ?? 1)}), `
    + `primary display ${record.display.width}x${record.display.height}; `
    + "vw / vh in the DOM layer would resolve against the wrong size, so the export fails closed",
  );
  error.viewport = record;
  throw error;
}

const VIEWPORT_SETTLE_TIMEOUT_MS = 2_000;

// Runs inside the page. Device emulation reaches the renderer asynchronously, so the re-measurement
// waits for the viewport to reach the expected size (or for the timeout) before reporting.
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

async function measurePageViewport(webContents, { expected = null, timeoutMs = 0 } = {}) {
  const [width, height, devicePixelRatio] = await webContents.executeJavaScript(
    `(${PAGE_VIEWPORT_PROBE})(${JSON.stringify(expected)}, ${Number(timeoutMs)})`,
  );
  return { width, height, devicePixelRatio };
}

async function settleWindowViewport(webContents, requested) {
  const display = electron.screen.getPrimaryDisplay().size;
  let measured = await measurePageViewport(webContents);
  const plan = planViewport({ requested, measured });
  if (plan.emulate) {
    webContents.enableDeviceEmulation(plan.parameters);
    measured = await measurePageViewport(webContents, { expected: requested, timeoutMs: VIEWPORT_SETTLE_TIMEOUT_MS });
  }
  return verifyViewport({ requested, measured, emulated: plan.emulate, display });
}

export function gpuRawFramePath(out, frameNumber) {
  return join(dirname(out), "raw", `frame-${frameNumber}.rgba`);
}

export function parseElectronArguments(argv) {
  const options = {
    projectRoot: null,
    editPath: null,
    out: null,
    fps: 30,
    width: 1920,
    height: 1080,
    outputWidth: null,
    outputHeight: null,
    duration: null,
    frames: null,
    queueDepth: 4,
    quality: "high",
    bitrate: undefined,
    codec: "h264",
    soft: false,
    trapReadback: false,
    verifyFrames: false,
    dumpFrames: [],
    captureFrames: null,
    captureOutputDirectory: null,
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
    else if (argument === "--queue-depth") options.queueDepth = positiveInteger(required(argv, ++index, "--queue-depth"), "--queue-depth");
    else if (argument === "--quality") options.quality = required(argv, ++index, "--quality");
    else if (argument === "--bitrate") options.bitrate = positiveInteger(required(argv, ++index, "--bitrate"), "--bitrate");
    else if (argument === "--codec") options.codec = codecValue(required(argv, ++index, "--codec"));
    else if (argument === "--soft") options.soft = true;
    else if (argument === "--trap-readback") options.trapReadback = true;
    else if (argument === "--verify-frames") options.verifyFrames = true;
    else if (argument === "--dump-frames") options.dumpFrames = parseFrameList(required(argv, ++index, "--dump-frames"), "--dump-frames");
    else if (argument === "--capture-frames") options.captureFrames = parseFrameList(required(argv, ++index, "--capture-frames"));
    else if (argument === "--capture-output-dir") options.captureOutputDirectory = required(argv, ++index, "--capture-output-dir");
  }
  if (!options.projectRoot || !options.out) throw new Error("--render and --out are required");
  options.outputWidth ??= options.width;
  options.outputHeight ??= options.height;
  if (options.duration === null && options.frames !== null) options.duration = options.frames / options.fps;
  if (options.frames === null && options.duration !== null) options.frames = Math.round(options.duration * options.fps);
  if (options.trapReadback && (options.verifyFrames || options.dumpFrames.length > 0)) {
    throw new Error("--trap-readback cannot be combined with --verify-frames or --dump-frames");
  }
  if (options.captureFrames !== null && (options.captureFrames.length === 0 || !options.captureOutputDirectory)) {
    throw new Error("--capture-frames requires at least one frame and --capture-output-dir");
  }
  return options;
}

function formatEligibilityFailures(eligibility) {
  return eligibility.entries.filter((entry) => ["degraded", "unsupported"].includes(entry.classification))
    .map((entry) => `${entry.kind}:${entry.id}:${entry.reason}`).join("; ");
}

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

function executeWithTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function required(argv, index, option) {
  if (index >= argv.length) throw new Error(`${option} requires a value`);
  return argv[index];
}
function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} requires a positive number`);
  return number;
}
function positiveInteger(value, label) {
  const number = positiveNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} requires an integer`);
  return number;
}
function codecValue(value) {
  if (!["h264", "hevc"].includes(value)) throw new Error(`--codec must be h264|hevc, got: ${value}`);
  return value;
}

function parseFrameList(value, label = "--capture-frames") {
  if (value === "") return [];
  return [...new Set(value.split(",").map((entry) => {
    const frame = Number(entry);
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error(`${label} requires non-negative integers, got: ${entry}`);
    }
    return frame;
  }))].sort((left, right) => left - right);
}

function normalizeOptionalFrameList(frameNumbers, totalFrames, label) {
  if (!Array.isArray(frameNumbers) || frameNumbers.length === 0) return [];
  return [...new Set(frameNumbers.map((frame) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= totalFrames) {
      throw new Error(`${label} frame ${frame} is outside 0..${totalFrames - 1}`);
    }
    return frame;
  }))].sort((left, right) => left - right);
}

function normalizeCaptureFrames(frameNumbers, totalFrames) {
  if (!Array.isArray(frameNumbers) || frameNumbers.length === 0) {
    throw new Error("GPU capture requires at least one frame number");
  }
  return [...new Set(frameNumbers.map((frame) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= totalFrames) {
      throw new Error(`GPU capture frame ${frame} is outside 0..${totalFrames - 1}`);
    }
    return frame;
  }))].sort((left, right) => left - right);
}

async function runCli() {
  let code = 0;
  try { await runGpuExport(parseElectronArguments(process.argv.slice(2))); }
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
  process.stderr.write("GPU Electron main の直接起動を判定できませんでした\n");
  app.exit(2);
}
