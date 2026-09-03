#!/usr/bin/env node

// raw BGRA filter: stdin and stdout have exactly one frame for each frame.
// Only the alpha byte is replaced with RVM's pha; decoding and encoding belong to the caller.

import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const RUNTIME_UNAVAILABLE_REASON =
  "RVM の実行環境が入っていないため、この品質では人物マットを生成できません。直すには cd packages/matte-rvm && npm install を実行してください";

async function loadRuntime(importRuntime = (specifier) => import(specifier)) {
  try {
    const loaded = await importRuntime("onnxruntime-node");
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

function parseArguments(argv) {
  const options = {
    width: 0,
    height: 0,
    model: null,
    metrics: null,
    downsampleRatio: null,
    totalFrames: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    index += 1;
    switch (argument) {
      case "--width": options.width = Number(value); break;
      case "--height": options.height = Number(value); break;
      case "--model": options.model = path.resolve(value); break;
      case "--metrics": options.metrics = path.resolve(value); break;
      case "--downsample-ratio": options.downsampleRatio = Number(value); break;
      case "--total-frames": options.totalFrames = Number(value); break;
      default: throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.width) || options.width <= 0) throw new Error("--width is required and must be positive");
  if (!Number.isInteger(options.height) || options.height <= 0) throw new Error("--height is required and must be positive");
  if (!options.model) throw new Error("--model is required");
  if (!fs.existsSync(options.model)) throw new Error(`model file does not exist: ${options.model}`);
  if (options.downsampleRatio !== null &&
      (!Number.isFinite(options.downsampleRatio) || options.downsampleRatio <= 0 || options.downsampleRatio > 1)) {
    throw new Error("--downsample-ratio must be greater than 0 and at most 1");
  }
  if (!Number.isInteger(options.totalFrames) || options.totalFrames < 0) {
    throw new Error("--total-frames must be a non-negative integer");
  }
  return options;
}

export function recommendedRatio({ width, height }) {
  const longSide = Math.max(width, height);
  if (longSide <= 512) return 1.0;
  if (longSide <= 1280) return 0.375;
  if (longSide <= 1920) return 0.25;
  return 0.125;
}

async function* framesFrom(stream, frameBytes) {
  let frame = Buffer.allocUnsafe(frameBytes);
  let filled = 0;
  for await (const chunk of stream) {
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(frameBytes - filled, chunk.length - offset);
      chunk.copy(frame, filled, offset, offset + count);
      filled += count;
      offset += count;
      if (filled === frameBytes) {
        yield frame;
        frame = Buffer.allocUnsafe(frameBytes);
        filled = 0;
      }
    }
  }
  if (filled !== 0) throw new Error(`stdin ended mid-frame (${filled}/${frameBytes} bytes)`);
}

async function writeFrame(frame) {
  if (!process.stdout.write(frame)) await once(process.stdout, "drain");
}

async function run(options, ort) {
  const pixels = options.width * options.height;
  const frameBytes = pixels * 4;
  const ratio = options.downsampleRatio ?? recommendedRatio(options);
  // CPU is the sole accepted provider. Other acceleration providers require a separate output-equivalence calibration.
  const session = await ort.InferenceSession.create(options.model, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  let recurrence = [
    new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]),
    new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]),
    new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]),
    new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]),
  ];
  const ratioTensor = new ort.Tensor("float32", Float32Array.from([ratio]), [1]);
  const sourceData = new Float32Array(3 * pixels);
  const outputFrame = Buffer.allocUnsafe(frameBytes);
  let frames = 0;
  let inferenceMilliseconds = 0;
  let transparentPixels = 0;
  let partialPixels = 0;
  let lastProgressAt = 0;
  let lastProgressFrame = -1;
  const startedAt = performance.now();

  for await (const frame of framesFrom(process.stdin, frameBytes)) {
    const redOffset = 0;
    const greenOffset = pixels;
    const blueOffset = pixels * 2;
    for (let pixel = 0, index = 0; pixel < pixels; pixel += 1, index += 4) {
      sourceData[redOffset + pixel] = frame[index + 2] / 255;
      sourceData[greenOffset + pixel] = frame[index + 1] / 255;
      sourceData[blueOffset + pixel] = frame[index] / 255;
    }
    const source = new ort.Tensor(
      "float32",
      sourceData,
      [1, 3, options.height, options.width],
    );
    const inferenceStartedAt = performance.now();
    const result = await session.run({
      src: source,
      r1i: recurrence[0],
      r2i: recurrence[1],
      r3i: recurrence[2],
      r4i: recurrence[3],
      downsample_ratio: ratioTensor,
    });
    inferenceMilliseconds += performance.now() - inferenceStartedAt;
    recurrence = [result.r1o, result.r2o, result.r3o, result.r4o];
    const alpha = result.pha.data;

    frame.copy(outputFrame);
    for (let pixel = 0, index = 3; pixel < pixels; pixel += 1, index += 4) {
      let value = Math.round(alpha[pixel] * 255);
      if (value < 0) value = 0;
      else if (value > 255) value = 255;
      outputFrame[index] = value;
      if (value < 8) transparentPixels += 1;
      else if (value < 248) partialPixels += 1;
    }
    await writeFrame(outputFrame);
    frames += 1;
    const now = performance.now();
    if (lastProgressFrame < 0 || now - lastProgressAt >= 1000) {
      process.stderr.write(`progress ${frames}/${Math.max(options.totalFrames, frames)}\n`);
      lastProgressAt = now;
      lastProgressFrame = frames;
    }
  }
  if (frames !== lastProgressFrame || options.totalFrames !== frames) {
    process.stderr.write(`progress ${frames}/${frames}\n`);
  }
  const totalMilliseconds = performance.now() - startedAt;
  const pixelCount = Math.max(frames * pixels, 1);
  const metrics = {
    frames,
    width: options.width,
    height: options.height,
    mask_width: options.width,
    mask_height: options.height,
    downsample_ratio: ratio,
    inference_seconds: inferenceMilliseconds / 1000,
    total_seconds: totalMilliseconds / 1000,
    ms_per_frame: frames > 0 ? inferenceMilliseconds / frames : 0,
    alpha_transparent_ratio: transparentPixels / pixelCount,
    alpha_partial_ratio: partialPixels / pixelCount,
  };
  if (options.metrics) fs.writeFileSync(options.metrics, `${JSON.stringify(metrics, null, 2)}\n`);
  try { await session.release?.(); } catch { /* best effort */ }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const ort = await loadRuntime();
  if (!ort) {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: RUNTIME_UNAVAILABLE_REASON })}\n`);
  } else {
    run(parseArguments(process.argv.slice(2)), ort).catch((error) => {
      process.stderr.write(`${JSON.stringify({ error: String(error?.message ?? error) })}\n`);
      process.exitCode = 1;
    });
  }
}
