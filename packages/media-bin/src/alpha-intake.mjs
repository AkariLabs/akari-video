import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ensureMask, probeAlphaSource } from "../../../skills/analyze-footage/bin/person-matte/mask-from-alpha.mjs";
import { MASK_CRF, MASK_FORMAT } from "../../../skills/analyze-footage/bin/person-matte/mask-format.mjs";
import { resolveFfmpeg, resolveFfprobe } from "./index.mjs";

const inFlight = new Map();
const ALPHA_CONTAINER_PATTERN = /\.(?:webm|mov)$/iu;
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOCK_WAIT_MS = 10 * 60 * 1000;

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

function frameCount(stream) {
  for (const value of [stream?.nb_frames, stream?.nb_read_frames]) {
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return null;
}

function outputPathFor(input, suffix) {
  const parsed = path.parse(path.resolve(input));
  return path.join(parsed.dir, `${parsed.name}.${suffix}.mp4`);
}

export function colorPathFor(input) {
  return outputPathFor(input, "color");
}

export function alphaMaskPathFor(input) {
  return outputPathFor(input, "mask");
}

function inputDecoderArguments(source) {
  if (!source.alpha_mode) return [];
  if (source.codec_name === "vp9") return ["-c:v", "libvpx-vp9"];
  if (source.codec_name === "vp8") return ["-c:v", "libvpx"];
  return [];
}

function probeVideo(filePath, ffprobe) {
  const result = run(ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames,nb_read_frames,start_pts,duration",
    "-of", "json", filePath,
  ]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, `ffprobe に失敗しました: ${filePath}`));
  }
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!stream) throw new Error(`映像ストリームが見つかりません: ${filePath}`);
  return {
    codec_name: String(stream.codec_name ?? ""),
    pix_fmt: String(stream.pix_fmt ?? ""),
    width: Number(stream.width),
    height: Number(stream.height),
    r_frame_rate: String(stream.r_frame_rate ?? ""),
    nb_frames: frameCount(stream),
    start_pts: Number(stream.start_pts ?? 0),
    duration: Number(stream.duration),
  };
}

function verifyPair(source, colorPath, maskPath, ffprobe) {
  const color = probeVideo(colorPath, ffprobe);
  const mask = probeVideo(maskPath, ffprobe);
  const failures = [];
  if (color.codec_name !== "h264") failures.push(`color codec=${color.codec_name}`);
  if (color.pix_fmt !== "yuv420p") failures.push(`color pix_fmt=${color.pix_fmt}`);
  if (mask.codec_name !== "h264") failures.push(`mask codec=${mask.codec_name}`);
  for (const [label, probe] of [["color", color], ["mask", mask]]) {
    if (probe.width !== source.width || probe.height !== source.height) failures.push(`${label} size mismatch`);
    if (probe.r_frame_rate !== source.r_frame_rate) failures.push(`${label} fps mismatch`);
    if (probe.nb_frames !== source.nb_frames) failures.push(`${label} frame count mismatch`);
    if (probe.start_pts !== 0) failures.push(`${label} start_pts=${probe.start_pts}`);
    if (Number.isFinite(source.duration) && Number.isFinite(probe.duration)
      && Math.abs(probe.duration - source.duration) > 1 / source.fps + 1e-9) {
      failures.push(`${label} duration mismatch`);
    }
  }
  if (color.nb_frames !== mask.nb_frames || color.r_frame_rate !== mask.r_frame_rate) {
    failures.push("color/mask timeline mismatch");
  }
  if (failures.length > 0) throw new Error(`alpha 取り込み結果の検証に失敗しました: ${failures.join(", ")}`);
  return { color, mask };
}

function acquireFileLock(lockPath) {
  const startedAt = Date.now();
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  let waited = false;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return waited;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      waited = true;
    }
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        waited = false;
        continue;
      }
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (Date.now() - startedAt >= LOCK_WAIT_MS) throw new Error(`alpha 取り込み lock の待機がタイムアウトしました: ${lockPath}`);
    Atomics.wait(waitArray, 0, 0, 100);
  }
}

function ensureColor(input, source, { output, ffmpeg, force }) {
  const inputStat = fs.statSync(input);
  if (!force) {
    try {
      if (fs.statSync(output).mtimeMs >= inputStat.mtimeMs) return { skipped: true };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const gop = Math.max(1, Math.floor(source.fps));
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${Date.now()}.tmp.mp4`);
  try {
    const converted = run(ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      ...inputDecoderArguments(source), "-i", input,
      "-map", "0:v:0", "-an", "-vf", "setpts=PTS-STARTPTS,format=yuv420p",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", String(MASK_CRF),
      "-threads", "1",
      "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0", "-bf", "0",
      "-movflags", "+faststart", "-y", temporary,
    ]);
    if (converted.error || converted.status !== 0) {
      throw new Error(summarize(converted.stderr || converted.error?.message, "色動画の ffmpeg 変換に失敗しました"));
    }
    fs.renameSync(temporary, output);
    return { skipped: false };
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function ensureAlphaIntakeSync(inputPath, options) {
  const startedAt = performance.now();
  const input = path.resolve(inputPath);
  const colorPath = path.resolve(options.colorOut ?? colorPathFor(input));
  const maskPath = path.resolve(options.maskOut ?? alphaMaskPathFor(input));
  try {
    const stat = fs.statSync(input);
    if (!stat.isFile()) throw new Error(`入力が通常ファイルではありません: ${input}`);
    fs.mkdirSync(path.dirname(colorPath), { recursive: true });
    const lockPath = `${colorPath}.intake.lock`;
    const joinedAnotherProcess = acquireFileLock(lockPath);
    try {
      const outputsFresh = [colorPath, maskPath].every((output) => {
        try { return fs.statSync(output).mtimeMs >= stat.mtimeMs; } catch { return false; }
      });
      if (!options.force && outputsFresh) {
        return {
          ok: true, alpha: true, skipped: true, input, colorPath, maskPath,
          maskFormat: MASK_FORMAT, reason: null, elapsedMs: performance.now() - startedAt,
        };
      }
      const ffmpeg = options.ffmpeg ?? resolveFfmpeg();
      const ffprobe = options.ffprobe ?? resolveFfprobe();
      const source = (options.probe ?? probeAlphaSource)(input, { ffprobe });
      if (!source.has_alpha) {
        return { ok: true, alpha: false, skipped: true, input, colorPath: input, maskPath: null, reason: null, elapsedMs: performance.now() - startedAt };
      }
      const force = options.force === true && !joinedAnotherProcess;
      const mask = (options.ensureMask ?? ensureMask)(input, {
        out: maskPath, force, ffmpeg, ffprobe,
      });
      if (!mask.ok) throw new Error(mask.reason);
      const color = ensureColor(input, source, {
        output: colorPath, ffmpeg, force,
      });
      const probe = verifyPair(source, colorPath, maskPath, ffprobe);
      return {
        ok: true,
        alpha: true,
        skipped: Boolean(mask.skipped && color.skipped),
        input,
        colorPath,
        maskPath,
        maskFormat: MASK_FORMAT,
        reason: null,
        elapsedMs: performance.now() - startedAt,
        probe,
      };
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      ok: false,
      alpha: null,
      skipped: false,
      input,
      colorPath,
      maskPath,
      reason: summarize(error?.message, "alpha 素材の取り込みに失敗しました"),
      elapsedMs: performance.now() - startedAt,
    };
  }
}

export function ensureAlphaIntake(inputPath, options = {}) {
  const key = `${path.resolve(inputPath)}\0force=${options.force === true}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = Promise.resolve().then(() => ensureAlphaIntakeSync(inputPath, options));
  inFlight.set(key, pending);
  void pending.finally(() => inFlight.delete(key));
  return pending;
}

function resolveLayerPath(projectRoot, value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function projectPath(projectRoot, value) {
  const relative = path.relative(projectRoot, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : value;
}

export async function prepareAlphaLayers(edit, { projectRoot, ensure = ensureAlphaIntake } = {}) {
  const layers = Array.isArray(edit?.layers) ? edit.layers : [];
  const layerResults = await Promise.all(layers.map(async (layer, index) => {
    if (!layer || typeof layer.src !== "string" || !ALPHA_CONTAINER_PATTERN.test(layer.src)) {
      return { index, layer, candidate: false, ok: true };
    }
    const sourcePath = resolveLayerPath(projectRoot, layer.src);
    const intake = await ensure(sourcePath);
    if (!intake.ok) {
      const warning = `layer ${layer.id ?? index}: alpha 取り込みに失敗したためスキップしました: ${intake.reason}`;
      return { index, layer, candidate: true, ok: false, warning, intake };
    }
    if (!intake.alpha) return { index, layer, candidate: true, ok: true, intake };
    const prepared = {
      ...layer,
      src: projectPath(projectRoot, intake.colorPath),
      mask: layer.mask ?? projectPath(projectRoot, intake.maskPath),
    };
    return { index, layer: prepared, originalLayer: layer, candidate: true, ok: true, intake };
  }));
  const warnings = layerResults.flatMap(result => result.warning ? [result.warning] : []);
  return {
    edit: { ...edit, layers: layerResults.filter(result => result.ok).map(result => result.layer) },
    warnings,
    layerResults,
  };
}
