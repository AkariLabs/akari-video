import { existsSync, realpathSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import electron from "electron";

import { verifyEncodedVideo } from "../../osr-export/src/ffprobe.mjs";
import { createMemorySampler, resolveMemoryBudget } from "../../osr-export/src/memory.mjs";
import { encodeRgbaPng } from "../../osr-export/src/png.mjs";
import { startStaticServer } from "../../osr-export/src/static-server.mjs";
import { loadAndBuildGpuPage } from "./page-builder.mjs";
import { muxMp4boxDirect } from "./mp4-mux.mjs";
import { resolveGpuEncoding } from "./bitrate.mjs";
import { CAPTION_MEASURE_UNSTABLE_REASON } from "./eligibility.mjs";

const { app, BrowserWindow, ipcMain } = electron;
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const VERIFY_READBACK_PATH = join(SOURCE_DIRECTORY, "verify-readback.js");
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
    duration,
    frames = Math.round(duration * fps),
    queueDepth = 4,
    quality = "high",
    bitrate = undefined,
    soft = false,
    trapReadback = false,
    verifyFrames = false,
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
  if (captureMode && !captureOutputDirectory) {
    throw new Error("GPU capture requires captureOutputDirectory");
  }
  if (trapReadback && verifyFrames) throw new Error("--trap-readback and --verify-frames are mutually exclusive");
  const encoding = resolveGpuEncoding({ quality, bitrate });
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
  const memoryBudget = resolveMemoryBudget({ soft, env: process.env });
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
  const annexBPath = join(dirname(out), "encoded.h264");
  const runtimeConfig = {
    frames,
    queueDepth,
    quality: encoding.quality,
    bitrate: encoding.bitrate,
    soft,
    trapReadback,
    verifyFrames,
    captureFrames: requestedCaptureFrames,
    domLayerFlags,
    ...(verifyFrames || captureMode ? { verifyReadbackModule: await readFile(VERIFY_READBACK_PATH, "utf8") } : {}),
  };
  let windowRef = null;
  let chunkState = null;
  let rendererFailure = null;
  const channels = [
    "gpu:config", "gpu:log", "gpu:checkpoint", "gpu:chunks-start", "gpu:chunk", "gpu:chunks-finish",
    "gpu:capture-frame",
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
      },
      memory: memorySampler.snapshot(),
      eligibility: built.eligibility,
    };
    await writeFile(runPath, `${JSON.stringify(running, null, 2)}\n`);
    if (Number.isInteger(value?.framesCompleted)) {
      const total = captureMode ? requestedCaptureFrames.length : frames;
      process.stdout.write(`PROGRESS frame=${value.framesCompleted} total=${total}\n`);
    }
    return true;
  });
  register("gpu:chunks-start", async () => {
    if (chunkState) throw new Error("chunk sink is already running");
    await mkdir(dirname(annexBPath), { recursive: true });
    await writeFile(annexBPath, Buffer.alloc(0));
    chunkState = { samples: [], offset: 0, writeChain: Promise.resolve() };
    return true;
  });
  register("gpu:chunk", async (_event, value) => {
    if (!chunkState) throw new Error("chunk sink is not running");
    const bytes = Buffer.from(value.bytes);
    const sample = {
      offset: chunkState.offset,
      length: bytes.length,
      type: value.type,
      timestamp: value.timestamp,
      duration: value.duration,
    };
    chunkState.offset += bytes.length;
    chunkState.samples.push(sample);
    chunkState.writeChain = chunkState.writeChain.then(() => appendFile(annexBPath, bytes));
    await chunkState.writeChain;
    return chunkState.samples.length;
  });
  register("gpu:chunks-finish", async () => {
    if (!chunkState) throw new Error("chunk sink is not running");
    const state = chunkState;
    chunkState = null;
    await state.writeChain;
    const mux = await muxMp4boxDirect({
      samples: state.samples,
      annexBPath,
      outputPath: out,
      width,
      height,
      fps,
      frames,
    });
    const ffprobe = await verifyEncodedVideo({ command: ffprobeCommand, path: out, frames, fps, width, height });
    if (!ffprobe.matched) throw new Error(`GPU ffprobe verification failed: ${JSON.stringify(ffprobe.checks)}`);
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
      fps,
      duration,
      gpu: {
        ...result?.gpu,
        platform: process.platform,
        chromium: process.versions.chrome,
      },
      memory: { ...memory, warnings: memoryWarnings },
      eligibility: built.eligibility,
      ffprobe: result?.mux?.ffprobe ?? null,
    };
    await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
    return run;
  } catch (error) {
    const reasonCode = gpuFailureReasonCode(error);
    const failed = {
      version: 1,
      status: "failed",
      error: String(error?.stack ?? error),
      ...(reasonCode ? { reasonCode, warnings: [`${reasonCode}: GPU export failed closed`] } : {}),
      framesRequested: frames,
      gpu: {
        platform: process.platform,
        chromium: process.versions.chrome,
        renderer: null,
        encoder_support: null,
      },
      memory: memorySampler.stop("failed"),
      eligibility: built.eligibility,
    };
    await writeFile(runPath, `${JSON.stringify(failed, null, 2)}\n`).catch(() => {});
    throw error;
  } finally {
    for (const channel of channels) ipcMain.removeHandler(channel);
    if (windowRef && !windowRef.isDestroyed()) await destroyWindow(windowRef);
    await server.close().catch(() => {});
  }
}

export function gpuFailureReasonCode(error) {
  const message = String(error?.stack ?? error);
  return message.includes(CAPTION_MEASURE_UNSTABLE_REASON) ? CAPTION_MEASURE_UNSTABLE_REASON : null;
}

export function parseElectronArguments(argv) {
  const options = {
    projectRoot: null,
    editPath: null,
    out: null,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: null,
    frames: null,
    queueDepth: 4,
    quality: "high",
    bitrate: undefined,
    soft: false,
    trapReadback: false,
    verifyFrames: false,
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
    else if (argument === "--duration") options.duration = positiveNumber(required(argv, ++index, "--duration"), "--duration");
    else if (argument === "--frames") options.frames = positiveInteger(required(argv, ++index, "--frames"), "--frames");
    else if (argument === "--queue-depth") options.queueDepth = positiveInteger(required(argv, ++index, "--queue-depth"), "--queue-depth");
    else if (argument === "--quality") options.quality = required(argv, ++index, "--quality");
    else if (argument === "--bitrate") options.bitrate = positiveInteger(required(argv, ++index, "--bitrate"), "--bitrate");
    else if (argument === "--soft") options.soft = true;
    else if (argument === "--trap-readback") options.trapReadback = true;
    else if (argument === "--verify-frames") options.verifyFrames = true;
    else if (argument === "--capture-frames") options.captureFrames = parseFrameList(required(argv, ++index, "--capture-frames"));
    else if (argument === "--capture-output-dir") options.captureOutputDirectory = required(argv, ++index, "--capture-output-dir");
  }
  if (!options.projectRoot || !options.out) throw new Error("--render and --out are required");
  if (options.duration === null && options.frames !== null) options.duration = options.frames / options.fps;
  if (options.frames === null && options.duration !== null) options.frames = Math.round(options.duration * options.fps);
  if (options.trapReadback && options.verifyFrames) throw new Error("--trap-readback and --verify-frames are mutually exclusive");
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

function parseFrameList(value) {
  if (value === "") return [];
  return [...new Set(value.split(",").map((entry) => {
    const frame = Number(entry);
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error(`--capture-frames requires non-negative integers, got: ${entry}`);
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
