#!/usr/bin/env node

// Usage: node mask-roundtrip.mjs --alpha <matte.webm> --mask <mask.mp4> [--frames N]
// The pass threshold (mean abs <= 1.0 and p99.9 <= 3) treats the alpha WebM as truth and measures
// the roundtrip accuracy of an import conversion made from that WebM. Comparing a concurrently
// produced mask with its sibling alpha WebM instead measures the sum of two independent encoding
// losses, so that cross-format comparison can legitimately return ok:false under this threshold.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { probeAlphaSource } from "./mask-from-alpha.mjs";
import { importPackage } from "./resolve-packages.mjs";

let dependencyError = null;
let resolveFfmpeg;
let resolveFfprobe;
try {
  ({ resolveFfmpeg, resolveFfprobe } = await importPackage("media-bin/src/index.mjs", { from: import.meta.url }));
} catch (error) {
  dependencyError = error;
}

const scriptPath = fileURLToPath(import.meta.url);

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 1000) : fallback;
}

function percentile(histogram, count, fraction) {
  if (count === 0) return null;
  const target = Math.ceil(count * fraction);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return histogram.length - 1;
}

async function* fixedFrames(stream, frameBytes) {
  let buffered = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, chunk]);
    while (buffered.length >= frameBytes) {
      yield buffered.subarray(0, frameBytes);
      buffered = buffered.subarray(frameBytes);
    }
  }
  if (buffered.length !== 0) throw new Error(`raw frame is truncated (${buffered.length}/${frameBytes} bytes)`);
}

function decoder(command, args, name) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("close", (code) => resolve({ code, error: null }));
  });
  return { child, name, exited, stderr: () => Buffer.concat(stderr).toString("utf8") };
}

function probeMask(maskPath, ffprobe) {
  const result = spawnSync(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", maskPath,
  ], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, "マスクの ffprobe に失敗しました"));
  }
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!stream) throw new Error("マスクに映像ストリームがありません");
  return { width: Number(stream.width), height: Number(stream.height), r_frame_rate: stream.r_frame_rate };
}

function stats(histogram, count, total, maximum) {
  return {
    pixels: count,
    mean_abs: count > 0 ? total / count : null,
    p99_9: percentile(histogram, count, 0.999),
    p99_99: percentile(histogram, count, 0.9999),
    max: count > 0 ? maximum : null,
  };
}

export async function compareRoundtrip(alphaPath, maskPath, options = {}) {
  if (dependencyError && (!options.ffmpeg || !options.ffprobe)) throw dependencyError;
  const ffmpeg = options.ffmpeg ?? resolveFfmpeg();
  const ffprobe = options.ffprobe ?? resolveFfprobe();
  const alphaProbe = probeAlphaSource(alphaPath, { ffprobe });
  const maskProbe = probeMask(maskPath, ffprobe);
  if (alphaProbe.width !== maskProbe.width || alphaProbe.height !== maskProbe.height) {
    throw new Error("アルファとマスクの解像度が一致しません");
  }
  if (alphaProbe.r_frame_rate !== maskProbe.r_frame_rate) {
    throw new Error("アルファとマスクの fps が一致しません");
  }
  const limitArgs = Number.isInteger(options.frames) && options.frames > 0
    ? ["-frames:v", String(options.frames)]
    : [];
  const alpha = decoder(ffmpeg, [
    "-hide_banner", "-nostdin", "-loglevel", "error",
    "-c:v", "libvpx-vp9", "-i", alphaPath,
    "-vf", "alphaextract,format=gray", ...limitArgs,
    "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
  ], "alpha");
  const mask = decoder(ffmpeg, [
    "-hide_banner", "-nostdin", "-loglevel", "error",
    "-i", maskPath, ...limitArgs,
    "-f", "rawvideo", "-pix_fmt", "yuv420p", "pipe:1",
  ], "mask");
  const yBytes = alphaProbe.width * alphaProbe.height;
  const chromaBytes = Math.ceil(alphaProbe.width / 2) * Math.ceil(alphaProbe.height / 2);
  const alphaFrames = fixedFrames(alpha.child.stdout, yBytes)[Symbol.asyncIterator]();
  const maskFrames = fixedFrames(mask.child.stdout, yBytes + chromaBytes * 2)[Symbol.asyncIterator]();
  const histogram = new Uint32Array(256);
  const edgeHistogram = new Uint32Array(256);
  let frames = 0;
  let count = 0;
  let total = 0;
  let maximum = 0;
  let edgeCount = 0;
  let edgeTotal = 0;
  let edgeMaximum = 0;
  let chromaMin = 255;
  let chromaMax = 0;
  while (true) {
    const [alphaFrame, maskFrame] = await Promise.all([alphaFrames.next(), maskFrames.next()]);
    if (alphaFrame.done || maskFrame.done) {
      if (alphaFrame.done !== maskFrame.done) throw new Error("アルファとマスクのフレーム数が一致しません");
      break;
    }
    const alphaY = alphaFrame.value;
    const maskYuv = maskFrame.value;
    for (let offset = 0; offset < yBytes; offset += 1) {
      const original = alphaY[offset];
      const delta = Math.abs(original - maskYuv[offset]);
      histogram[delta] += 1;
      total += delta;
      count += 1;
      maximum = Math.max(maximum, delta);
      if (original >= 16 && original <= 240) {
        edgeHistogram[delta] += 1;
        edgeTotal += delta;
        edgeCount += 1;
        edgeMaximum = Math.max(edgeMaximum, delta);
      }
    }
    for (let offset = yBytes; offset < maskYuv.length; offset += 1) {
      chromaMin = Math.min(chromaMin, maskYuv[offset]);
      chromaMax = Math.max(chromaMax, maskYuv[offset]);
    }
    frames += 1;
  }
  for (const processResult of [alpha, mask]) {
    const exited = await processResult.exited;
    if (exited.error || exited.code !== 0) {
      throw new Error(`${processResult.name} decode failed: ${summarize(processResult.stderr(), `exit ${exited.code}`)}`);
    }
  }
  const overall = stats(histogram, count, total, maximum);
  return {
    ok: overall.mean_abs <= 1 && overall.p99_9 <= 3,
    frames,
    mean_abs: overall.mean_abs,
    p99_9: overall.p99_9,
    p99_99: overall.p99_99,
    max: overall.max,
    edge_band: stats(edgeHistogram, edgeCount, edgeTotal, edgeMaximum),
    chroma: { min: frames > 0 ? chromaMin : null, max: frames > 0 ? chromaMax : null },
  };
}

function parseArguments(argv) {
  const options = { alpha: null, mask: null, frames: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
    index += 1;
    if (argument === "--alpha") options.alpha = path.resolve(value);
    else if (argument === "--mask") options.mask = path.resolve(value);
    else if (argument === "--frames") options.frames = Number(value);
    else throw new Error(`不明な引数です: ${argument}`);
  }
  if (!options.alpha || !options.mask) throw new Error("--alpha と --mask が必要です");
  if (options.frames != null && (!Number.isInteger(options.frames) || options.frames <= 0)) {
    throw new Error("--frames は 1 以上の整数です");
  }
  return options;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(scriptPath) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  if (dependencyError) {
    console.error(dependencyError.message);
    process.exit(1);
  }
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await compareRoundtrip(options.alpha, options.mask, options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: summarize(error?.message, "比較に失敗しました") })}\n`);
    process.exitCode = 1;
  }
}
