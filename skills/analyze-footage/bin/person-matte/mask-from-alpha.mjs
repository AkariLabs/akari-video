#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findAlphaModeTag } from "./alpha-tag.mjs";
import { MASK_FORMAT, maskOutputArguments } from "./mask-format.mjs";
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

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function rateValue(value) {
  const [numerator, denominator = "1"] = String(value ?? "0/1").split("/");
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function frameCount(stream) {
  for (const value of [stream?.nb_frames, stream?.nb_read_frames]) {
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return null;
}

function alphaPixelFormat(pixelFormat) {
  return /^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya)/u.test(String(pixelFormat ?? ""));
}

function alphaInputDecoderArguments(source) {
  if (!source.alpha_mode) return [];
  if (source.codec_name === "vp9") return ["-c:v", "libvpx-vp9"];
  if (source.codec_name === "vp8") return ["-c:v", "libvpx"];
  return [];
}

export function maskPathFor(webmPath) {
  const parsed = path.parse(path.resolve(webmPath));
  return path.join(parsed.dir, `${parsed.name}.mask.mp4`);
}

export function probeAlphaSource(webmPath, { ffprobe = resolveFfprobe() } = {}) {
  const result = run(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-count_frames",
    "-show_entries",
    "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames,nb_read_frames,start_pts,duration:stream_tags=alpha_mode",
    "-of", "json",
    webmPath,
  ]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, "ffprobe に失敗しました"));
  }
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!stream) throw new Error("映像ストリームが見つかりません");
  const alphaMode = String(findAlphaModeTag(stream.tags) ?? "");
  const hasAlpha = alphaMode === "1" || alphaPixelFormat(stream.pix_fmt);
  const fps = rateValue(stream.r_frame_rate);
  if (!fps) throw new Error("入力の fps を取得できません");
  return {
    codec_name: String(stream.codec_name ?? ""),
    pix_fmt: String(stream.pix_fmt ?? ""),
    alpha_mode: alphaMode || null,
    has_alpha: hasAlpha,
    width: Number(stream.width),
    height: Number(stream.height),
    r_frame_rate: String(stream.r_frame_rate),
    nb_frames: frameCount(stream),
    start_pts: Number(stream.start_pts ?? 0),
    duration: Number(stream.duration),
    fps,
  };
}

function probeMask(maskPath, ffprobe) {
  const result = run(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-count_frames",
    "-show_entries",
    "stream=codec_name,profile,pix_fmt,color_range,width,height,r_frame_rate,nb_frames,nb_read_frames,start_pts,duration",
    "-of", "json",
    maskPath,
  ]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, "マスクの ffprobe に失敗しました"));
  }
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!stream) throw new Error("マスクに映像ストリームがありません");
  return {
    codec_name: stream.codec_name,
    profile: stream.profile,
    pix_fmt: stream.pix_fmt,
    color_range: stream.color_range,
    width: Number(stream.width),
    height: Number(stream.height),
    r_frame_rate: stream.r_frame_rate,
    nb_frames: frameCount(stream),
    start_pts: Number(stream.start_pts ?? 0),
    duration: Number(stream.duration),
  };
}

function verifyMask(maskPath, source, ffprobe) {
  const probe = probeMask(maskPath, ffprobe);
  const failures = [];
  if (probe.codec_name !== "h264") failures.push(`codec=${probe.codec_name}`);
  if (probe.profile !== "High") failures.push(`profile=${probe.profile}`);
  if (probe.color_range !== "pc") failures.push(`color_range=${probe.color_range}`);
  if (probe.width !== source.width || probe.height !== source.height) failures.push("size mismatch");
  if (probe.r_frame_rate !== source.r_frame_rate) failures.push("fps mismatch");
  if (probe.nb_frames !== source.nb_frames) failures.push("frame count mismatch");
  if (probe.start_pts !== 0) failures.push(`start_pts=${probe.start_pts}`);
  if (failures.length > 0) throw new Error(`マスクの規格検証に失敗しました: ${failures.join(", ")}`);
  return probe;
}

export function ensureMask(webmPath, options = {}) {
  const startedAt = performance.now();
  const input = path.resolve(webmPath);
  const output = path.resolve(options.out ?? maskPathFor(input));
  const result = { ok: false, path: output, skipped: false, reason: null, elapsedMs: 0 };
  try {
    if (dependencyError && (!options.ffmpeg || !options.ffprobe)) throw dependencyError;
    const inputStat = fs.statSync(input);
    if (!inputStat.isFile()) throw new Error(`入力が通常ファイルではありません: ${input}`);
    if (!options.force) {
      try {
        if (fs.statSync(output).mtimeMs >= inputStat.mtimeMs) {
          return { ...result, ok: true, skipped: true, reason: null, elapsedMs: performance.now() - startedAt };
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    const ffmpeg = options.ffmpeg ?? resolveFfmpeg();
    const ffprobe = options.ffprobe ?? resolveFfprobe();
    const source = probeAlphaSource(input, { ffprobe });
    if (!source.has_alpha) {
      throw new Error(`入力にアルファがありません（alpha_mode=${source.alpha_mode ?? "none"}, pix_fmt=${source.pix_fmt}）`);
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${Date.now()}.tmp.mp4`);
    try {
      const converted = run(ffmpeg, [
        "-hide_banner", "-nostdin", "-loglevel", "error",
        ...alphaInputDecoderArguments(source),
        "-i", input,
        ...maskOutputArguments({ fps: source.fps, output: temporary }),
      ]);
      if (converted.error || converted.status !== 0) {
        throw new Error(summarize(converted.stderr || converted.error?.message, "ffmpeg 変換に失敗しました"));
      }
      const probe = verifyMask(temporary, source, ffprobe);
      fs.renameSync(temporary, output);
      return {
        ok: true,
        path: output,
        skipped: false,
        reason: null,
        elapsedMs: performance.now() - startedAt,
        mask_format: MASK_FORMAT,
        probe,
      };
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  } catch (error) {
    return {
      ...result,
      reason: summarize(error?.message, "マスク変換に失敗しました"),
      elapsedMs: performance.now() - startedAt,
    };
  }
}

export function createMaskResolver({ resolvePath, onWarning = () => {}, ensure = ensureMask } = {}) {
  if (typeof resolvePath !== "function") throw new Error("createMaskResolver には resolvePath が必要です");
  const cache = new Map();
  return (colorSrc) => {
    if (cache.has(colorSrc)) return cache.get(colorSrc);
    let mask = null;
    try {
      const alphaPath = resolvePath(colorSrc);
      if (!alphaPath) {
        cache.set(colorSrc, null);
        return null;
      }
      const converted = ensure(alphaPath);
      if (converted.ok) mask = converted.path;
      else onWarning(`人物マスクを用意できません: ${converted.reason}`);
    } catch (error) {
      onWarning(`人物マスクを用意できません: ${summarize(error?.message, "unknown error")}`);
    }
    cache.set(colorSrc, mask);
    return mask;
  };
}

function parseArguments(argv) {
  const options = { input: null, out: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
    index += 1;
    if (argument === "--input") options.input = value;
    else if (argument === "--out") options.out = value;
    else throw new Error(`不明な引数です: ${argument}`);
  }
  if (!options.input) throw new Error("--input <matte.webm> が必要です");
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
  let response;
  try {
    const options = parseArguments(process.argv.slice(2));
    response = ensureMask(options.input, options);
  } catch (error) {
    response = { ok: false, reason: summarize(error?.message, "引数が不正です") };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
  if (!response.ok) process.exitCode = 1;
}
