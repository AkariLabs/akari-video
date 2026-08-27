import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";

import electron from "electron";

import { startRawVideoEncoder } from "./encode.mjs";
import { verifyEncodedVideo } from "./ffprobe.mjs";
import { createMemorySampler, resolveMemoryBudget } from "./memory.mjs";
import { captureNonEmptyBitmap } from "./paint-bitmap.mjs";
import { loadAndBuildOsrPage } from "./page-builder.mjs";
import { startStaticServer } from "./static-server.mjs";
import { stripStampRow, verifyStamp } from "./stamp.mjs";

const { app, BrowserWindow } = electron;
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export async function runOsrExport(options) {
  const {
    projectRoot,
    out,
    fps = 30,
    width = 1920,
    height = 1080,
    duration,
    frames = Math.round(duration * fps),
    quality = "high",
    encoder = "auto",
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
  const memoryBudget = resolveMemoryBudget({ soft, env: process.env });

  if (soft && !app.isReady()) app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("force-color-profile", "srgb");
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.on("window-all-closed", () => {});
  if (!app.isReady()) await app.whenReady();

  const built = await loadAndBuildOsrPage({ projectRoot, fps, width, height, duration, stampRow: true });
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
  const memorySampler = createMemorySampler({
    budget: memoryBudget,
    sample: () => {
      const total = app.getAppMetrics().reduce((sum, metric) => sum + Number(metric.memory?.workingSetSize ?? 0) * 1024, 0);
      return total > 0 ? total : process.memoryUsage().rss;
    },
    onWarning: (bytes) => memoryWarnings.push(`RSS warning: ${bytes} bytes`),
    onHardStop: (bytes) => { fatalMemoryError = new Error(`RSS hard stop: ${bytes} bytes`); },
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
    await windowRef.webContents.executeJavaScript("window.__akariReady");
    encoderSession = startRawVideoEncoder({ ffmpegCommand, outputPath: out, width, height, fps, quality, encoder, edit: built.edit, queueDepth });

    for (let frame = 0; frame < frames; frame += 1) {
      if (fatalMemoryError) throw fatalMemoryError;
      if (rendererFailure) throw rendererFailure;
      const seconds = frame / fps;
      const seekStarted = performance.now();
      await windowRef.webContents.executeJavaScript(`window.__akariSeek(${JSON.stringify(seconds)},${frame})`);
      stages.seek.push(performance.now() - seekStarted);

      let captured = await captureNonEmptyBitmap({
        frame, width, height,
        capture: () => capturePaint(windowRef.webContents, paintTimeoutMs, frame, paintTimeouts),
        settle: () => settle(windowRef),
        onEmpty: () => recordEmptyPaints(emptyPaints, frame, 1),
      });
      stages.paint.push(captured.paintMs);
      let bitmap = captured.bitmap;
      stages.toBitmap.push(captured.toBitmapMs);

      const verifyStarted = performance.now();
      const preCheck = verifyStamp(bitmap, width, height, frame);
      const delta = signedDelta(preCheck.frameNumber, preCheck.expectedFrameNumber, 65_536);
      preVerifyDeltaHistogram[String(delta)] = (preVerifyDeltaHistogram[String(delta)] ?? 0) + 1;
      let retries = 0;
      if (verify === "stamp") {
        while (!verifyStamp(bitmap, width, height, frame).exact && retries < 8) {
          await settle(windowRef);
          captured = await captureNonEmptyBitmap({
            frame, width, height,
            capture: () => capturePaint(windowRef.webContents, paintTimeoutMs, frame, paintTimeouts),
            settle: () => settle(windowRef),
            onEmpty: () => recordEmptyPaints(emptyPaints, frame, 1),
          });
          bitmap = captured.bitmap;
          retries += 1;
        }
        if (!verifyStamp(bitmap, width, height, frame).exact) throw new Error(`frame ${frame} stamp verify failed after ${retries} retries`);
      } else if (verify === "hash") {
        let hash = sha256(stripStampRow(bitmap, width, height));
        while (lastAcceptedHash !== null && hash === lastAcceptedHash && retries < 8) {
          await settle(windowRef);
          captured = await captureNonEmptyBitmap({
            frame, width, height,
            capture: () => capturePaint(windowRef.webContents, paintTimeoutMs, frame, paintTimeouts),
            settle: () => settle(windowRef),
            onEmpty: () => recordEmptyPaints(emptyPaints, frame, 1),
          });
          bitmap = captured.bitmap;
          hash = sha256(stripStampRow(bitmap, width, height));
          retries += 1;
        }
        if (lastAcceptedHash !== null && hash === lastAcceptedHash) hashPolicyAmbiguous += 1;
        lastAcceptedHash = hash;
      }
      retriesTotal += retries;
      retryHistogram[String(retries)] = (retryHistogram[String(retries)] ?? 0) + 1;
      stages.verify.push(performance.now() - verifyStarted);

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
    const ffprobe = await verifyEncodedVideo({ command: ffprobeCommand, path: out, frames, fps, width, height });
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
      width, height, fps, duration,
      verify: { mode: verify, retriesTotal, retryHistogram, hashPolicyAmbiguous, preVerifyDeltaHistogram },
      frameHashes,
      stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, summarize(values)])),
      bucketMedians: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, bucketMedians(values)])),
      driftRatio: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, driftRatio(values)])),
      captureLoopMs: performance.now() - captureStarted,
      backpressure: encoded.backpressure,
      paintTimeouts,
      emptyPaints,
      memory: { ...memory, afterDestroyBytes: afterDestroyMemory, warnings: memoryWarnings },
      ffprobe,
    };
    await writeFile(join(dirname(out), "run.json"), `${JSON.stringify(run, null, 2)}\n`);
    return run;
  } catch (error) {
    encoderSession?.abort(error);
    const failed = {
      version: 1,
      status: "failed",
      error: String(error?.stack ?? error),
      framesRequested: frames,
      verify: { mode: verify, retriesTotal, retryHistogram, hashPolicyAmbiguous, preVerifyDeltaHistogram },
      frameHashes,
      paintTimeouts,
      emptyPaints,
      memory: memorySampler.stop("failed"),
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

export function parseElectronArguments(argv) {
  const options = { projectRoot: null, out: null, fps: 30, width: 1920, height: 1080, duration: null, frames: null, quality: "high", encoder: "auto", verify: "stamp", soft: false, queueDepth: 3, dumpFrames: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--render") options.projectRoot = required(argv, ++index, "--render");
    else if (argument === "--out") options.out = required(argv, ++index, "--out");
    else if (argument === "--fps") options.fps = positiveNumber(required(argv, ++index, "--fps"), "--fps");
    else if (argument === "--width") options.width = positiveInteger(required(argv, ++index, "--width"), "--width");
    else if (argument === "--height") options.height = positiveInteger(required(argv, ++index, "--height"), "--height");
    else if (argument === "--duration") options.duration = positiveNumber(required(argv, ++index, "--duration"), "--duration");
    else if (argument === "--frames") options.frames = positiveInteger(required(argv, ++index, "--frames"), "--frames");
    else if (argument === "--quality") options.quality = required(argv, ++index, "--quality");
    else if (argument === "--encoder") options.encoder = required(argv, ++index, "--encoder");
    else if (argument === "--verify") options.verify = required(argv, ++index, "--verify");
    else if (argument === "--queue-depth") options.queueDepth = positiveInteger(required(argv, ++index, "--queue-depth"), "--queue-depth");
    else if (argument === "--dump-frames") options.dumpFrames = parseFrameList(required(argv, ++index, "--dump-frames"));
    else if (argument === "--soft") options.soft = true;
  }
  if (!options.projectRoot || !options.out) throw new Error("--render and --out are required");
  if (options.duration === null && options.frames !== null) options.duration = options.frames / options.fps;
  if (options.frames === null && options.duration !== null) options.frames = Math.round(options.duration * options.fps);
  return options;
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

function recordEmptyPaints(records, frame, attempts) {
  if (attempts === 0) return;
  const existing = records.find((record) => record.frame === frame);
  if (existing) existing.attempts += attempts;
  else records.push({ frame, attempts });
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
function parseFrameList(value) {
  if (value === "") return [];
  return [...new Set(value.split(",").map((entry) => {
    const frame = Number(entry);
    if (!Number.isInteger(frame) || frame < 0) throw new Error(`--dump-frames requires non-negative integers, got: ${entry}`);
    return frame;
  }))].sort((left, right) => left - right);
}

async function runCli() {
  let code = 0;
  try { await runOsrExport(parseElectronArguments(process.argv.slice(2))); }
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
