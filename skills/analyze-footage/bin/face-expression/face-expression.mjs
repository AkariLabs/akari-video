#!/usr/bin/env node

// MediaPipe Face Landmarker を既存の headless Chromium 流儀で実行し、face-expression
// track 1 ファイルと analysis.json の optional pointer を原子的に更新する。
// 入力フレームは ffmpeg で一定 fps / 幅の PNG に決定論的にデコードし、ブラウザページ内の
// @mediapipe/tasks-vision (CPU/WASM) へ渡す。Python/Swift の追加ランタイムは持たない。

import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  FACE_LANDMARKER_MODEL,
  TASKS_VISION_VERSION,
  VENDORED_RUNTIME_FILES,
} from "./artifacts.mjs";
import { findChrome, launchBrowser } from "./browser.mjs";
import { ensureFaceLandmarkerModel, faceLandmarkerModelPath, sha256File } from "./model-resolver.mjs";
import { startStaticServer } from "./static-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FPS = 24;
const DEFAULT_DECODE_WIDTH = 1280;
const TOOL_ID = "face-expression.mjs v0";
const PROVIDER_NAME = "mediapipe-face-landmarker";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 1000) : fallback;
}

function parseArguments(argv) {
  const result = {
    check: false,
    input: null,
    analysis: null,
    fps: DEFAULT_FPS,
    decodeWidth: DEFAULT_DECODE_WIDTH,
    metricsOut: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      result.check = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
    index += 1;
    switch (argument) {
      case "--input": result.input = path.resolve(value); break;
      case "--analysis": result.analysis = path.resolve(value); break;
      case "--fps": result.fps = Number(value); break;
      case "--decode-width": result.decodeWidth = Number(value); break;
      case "--metrics": result.metricsOut = path.resolve(value); break;
      default: throw new Error(`不明な引数です: ${argument}`);
    }
  }
  if (!Number.isFinite(result.fps) || result.fps <= 0 || result.fps > 240) {
    throw new Error("--fps は 0 より大きく 240 以下の数値です");
  }
  if (!Number.isFinite(result.decodeWidth) || result.decodeWidth < 16) {
    throw new Error("--decode-width は 16 以上の数値です");
  }
  return result;
}

function run(command, args) {
  try {
    return spawnSync(command, args, { encoding: "utf8" });
  } catch (error) {
    return { error };
  }
}

function commandAvailable(command) {
  const result = run(command, ["-version"]);
  return !result.error && result.status === 0;
}

async function checkAvailability(env = process.env) {
  const reasons = [];
  for (const command of ["ffmpeg", "ffprobe"]) {
    if (!commandAvailable(command)) reasons.push(`${command} が利用できません`);
  }
  const chrome = findChrome(env);
  if (!chrome) reasons.push("Chrome for Testing / Chrome / Chromium が見つかりません");
  try {
    import.meta.resolve("puppeteer-core");
  } catch {
    reasons.push("puppeteer-core が解決できません（既存 workspace 依存を install してください）");
  }
  for (const [relativePath, expected] of Object.entries(VENDORED_RUNTIME_FILES)) {
    const absolute = path.join(here, relativePath);
    if (!fs.existsSync(absolute)) {
      reasons.push(`vendored runtime がありません: ${relativePath}`);
      continue;
    }
    const actual = await sha256File(absolute);
    if (actual !== expected) reasons.push(`vendored runtime SHA-256 不一致: ${relativePath}`);
  }
  const modelPath = faceLandmarkerModelPath(env);
  let modelCached = false;
  if (fs.existsSync(modelPath)) {
    const actual = await sha256File(modelPath);
    if (actual !== FACE_LANDMARKER_MODEL.sha256) reasons.push(`model SHA-256 不一致: ${modelPath}`);
    else modelCached = true;
  }
  return {
    available: reasons.length === 0,
    ...(reasons.length > 0 ? { reason: reasons.join(" / ") } : {}),
    runtime: `@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`,
    chrome,
    model_cached: modelCached,
    model_path: modelPath,
    model_url: FACE_LANDMARKER_MODEL.url,
    model_sha256: FACE_LANDMARKER_MODEL.sha256,
  };
}

function ffprobeJson(input) {
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,duration:stream_side_data=rotation:format=duration",
    "-of", "json", input,
  ]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr, "ffprobe に失敗しました"));
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("ffprobe の出力が JSON ではありません");
  }
}

function probeSource(input) {
  const result = ffprobeJson(input);
  const stream = result.streams?.[0];
  if (!stream) throw new Error("映像ストリームが見つかりません");
  const rawWidth = Number(stream.width);
  const rawHeight = Number(stream.height);
  if (!(rawWidth > 0) || !(rawHeight > 0)) throw new Error("映像寸法を取得できません");
  const rotation = Number(
    (stream.side_data_list ?? []).find((entry) => Number.isFinite(Number(entry.rotation)))?.rotation ?? 0,
  );
  const rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const duration = Number(stream.duration ?? result.format?.duration ?? Number.NaN);
  return {
    width: rotated ? rawHeight : rawWidth,
    height: rotated ? rawWidth : rawHeight,
    duration: Number.isFinite(duration) ? duration : null,
  };
}

function outputSize(source, decodeWidth) {
  const width = Math.max(16, Math.floor(Math.min(decodeWidth, source.width) / 2) * 2);
  const height = Math.max(16, Math.floor((source.height / source.width) * width / 2) * 2);
  return { width, height };
}

function decodeFrames(input, frameDir, fps, size) {
  const pattern = path.join(frameDir, "frame-%08d.png");
  const result = run("ffmpeg", [
    "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
    "-i", input, "-map", "0:v:0",
    "-vf", `fps=${fps},scale=${size.width}:${size.height}:flags=bicubic`,
    "-start_number", "0", pattern,
  ]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr, "ffmpeg frame decode に失敗しました"));
  }
  const frames = fs.readdirSync(frameDir)
    .filter((name) => /^frame-\d{8}\.png$/.test(name))
    .sort()
    .map((name) => path.join(frameDir, name));
  if (frames.length === 0) throw new Error("デコードされたフレームがありません");
  return frames;
}

function slashRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function detectFrames({ frames, fps, modelPath }) {
  // file:// origin では Emscripten glue 内の fetch(wasm) が Chrome に拒否される。
  // render page と不変の vendored runtime だけを ephemeral loopback HTTP で同一 origin 配信する。
  const staticServer = await startStaticServer({ root: here });
  let browser;
  let page;
  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto(`${staticServer.origin}/render.html`, {
      waitUntil: "load",
      timeout: 180_000,
    });
    await page.waitForFunction(() => document.body.dataset.ready === "true", { timeout: 180_000 });
    const modelBase64 = fs.readFileSync(modelPath).toString("base64");
    await page.evaluate((encoded) => window.faceExpressionRuntime.initialize(encoded), modelBase64);

    const samples = [];
    for (let index = 0; index < frames.length; index += 1) {
      const t = index / fps;
      // HTTP page から file:// frame は読めないため、モデルと同じく page.evaluate の値として渡す。
      // base64 は transport 表現だけで、MediaPipe へ入る decoded PNG bytes と sample 時刻は不変。
      const imageBase64 = fs.readFileSync(frames[index]).toString("base64");
      const detections = await page.evaluate(
        ({ encoded, timestampMs }) => window.faceExpressionRuntime.detect(encoded, timestampMs),
        { encoded: imageBase64, timestampMs: t * 1000 },
      );
      samples.push({ t, detections });
    }
    await page.evaluate(() => window.faceExpressionRuntime.close());
    if (pageErrors.length > 0) throw new Error(`detector page error: ${pageErrors.join(" | ")}`);
    return samples;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await staticServer.close();
  }
}

async function generate(options) {
  if (!fs.existsSync(options.input)) throw new Error(`input が見つかりません: ${options.input}`);
  if (!fs.existsSync(options.analysis)) throw new Error(`analysis.json が見つかりません: ${options.analysis}`);
  const analysis = JSON.parse(fs.readFileSync(options.analysis, "utf8"));
  if (!analysis || typeof analysis !== "object" || !analysis.tracks || typeof analysis.tracks !== "object") {
    throw new Error("analysis.json の tracks が object ではありません");
  }

  const started = process.hrtime.bigint();
  const source = probeSource(options.input);
  const size = outputSize(source, options.decodeWidth);
  const model = await ensureFaceLandmarkerModel({
    log: (message) => process.stderr.write(`${message}\n`),
  });
  const frameDir = await mkdtemp(path.join(os.tmpdir(), "akari-face-expression-frames-"));
  let samples;
  try {
    const frames = decodeFrames(options.input, frameDir, options.fps, size);
    samples = await detectFrames({ frames, fps: options.fps, modelPath: model.path });
  } finally {
    await rm(frameDir, { recursive: true, force: true });
  }

  const analysisDir = path.dirname(options.analysis);
  const trackPath = path.join(analysisDir, "vision", "face-expression.json");
  const track = {
    version: 0,
    kind: "face-expression",
    source: {
      path: slashRelative(path.dirname(trackPath), options.input),
      duration: source.duration,
    },
    sample_fps: options.fps,
    provider: {
      name: PROVIDER_NAME,
      runtime: `@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`,
      model_url: FACE_LANDMARKER_MODEL.url,
      model_sha256: FACE_LANDMARKER_MODEL.sha256,
    },
    samples,
  };
  atomicJson(trackPath, track);

  const pointer = {
    path: "vision/face-expression.json",
    sample_fps: options.fps,
    provider: PROVIDER_NAME,
    tool: TOOL_ID,
    generated_at: new Date().toISOString(),
    features: ["head-pose-ypr-radians", "mediapipe-blendshapes-52"],
  };
  analysis.tracks.face_expression = pointer;
  atomicJson(options.analysis, analysis);

  const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  const metrics = {
    ok: true,
    analysis: options.analysis,
    track: pointer,
    frames: samples.length,
    detections: samples.reduce((sum, sample) => sum + sample.detections.length, 0),
    detected_frames: samples.filter((sample) => sample.detections.length > 0).length,
    width: size.width,
    height: size.height,
    fps: options.fps,
    elapsed_seconds: elapsedSeconds,
    realtime_ratio: source.duration ? elapsedSeconds / source.duration : null,
    model_downloaded: model.downloaded,
  };
  if (options.metricsOut) atomicJson(options.metricsOut, metrics);
  return metrics;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error.message, "引数が不正です") });
    process.exitCode = 2;
    return;
  }
  if (options.check) {
    const availability = await checkAvailability();
    printJson(availability);
    if (!availability.available) process.exitCode = 1;
    return;
  }
  if (!options.input || !options.analysis) {
    printJson({ ok: false, reason: "--input と --analysis が必要です" });
    process.exitCode = 2;
    return;
  }
  try {
    printJson(await generate(options));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error.message, "face-expression 生成に失敗しました") });
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) await main();

export { checkAvailability, generate, parseArguments };
