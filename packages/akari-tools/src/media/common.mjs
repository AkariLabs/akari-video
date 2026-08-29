import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";

export const MEDIA_VERSION = "0.1.0";

export function runChecked(command, args, options = {}) {
  const result = (options.spawn ?? spawnSync)(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options.spawnOptions,
  });
  if (result?.error || result?.status !== 0) {
    const detail = String(result?.stderr || result?.stdout || result?.error?.message || "").trim();
    throw new Error(detail || `${path.basename(command)} が終了コード ${result?.status ?? 1} で失敗しました`);
  }
  return result;
}

export function resolveTools(options = {}) {
  return {
    ffmpeg: options.ffmpegCommand ?? process.env.FFMPEG ?? resolveFfmpeg(),
    ffprobe: options.ffprobeCommand ?? process.env.FFPROBE ?? resolveFfprobe(),
  };
}

export function findProjectRoot(startPath) {
  let current = path.resolve(startPath);
  try {
    if (statSync(current).isFile()) current = path.dirname(current);
  } catch {
    // 存在しない target は呼び出し側で診断する。cwd 由来の探索は続ける。
  }
  while (true) {
    if (existsSync(path.join(current, ".akari"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readEditSources(projectRoot) {
  const editPath = path.join(projectRoot, "edit.json");
  if (!existsSync(editPath)) return [];
  try {
    const edit = JSON.parse(readFileSync(editPath, "utf8"));
    if (Array.isArray(edit.sources)) return edit.sources;
    if (typeof edit.source === "string") return [{ id: null, path: edit.source }];
    if (edit.source?.path) return [{ id: null, path: edit.source.path }];
    return [];
  } catch {
    return [];
  }
}

export function resolveTarget(target, options = {}) {
  if (!target) throw new Error("target が必要です");
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const cwdProject = findProjectRoot(cwd);
  let inputPath = path.resolve(cwd, target);
  let projectRoot = cwdProject;
  let sourceId = null;

  if (!existsSync(inputPath) && cwdProject) {
    const source = readEditSources(cwdProject).find((entry) => entry?.id === target);
    if (source?.path) {
      inputPath = path.resolve(cwdProject, source.path);
      sourceId = source.id;
    }
  }
  if (!existsSync(inputPath)) throw new Error(`素材ファイルが見つかりません: ${target}`);
  if (!statSync(inputPath).isFile()) throw new Error(`通常ファイルではありません: ${target}`);

  projectRoot = projectRoot ?? findProjectRoot(inputPath);
  if (projectRoot) {
    const relative = path.relative(projectRoot, inputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) projectRoot = null;
  }
  const projectRelative = projectRoot ? toPosix(path.relative(projectRoot, inputPath)) : null;
  const declaredSource = projectRoot
    ? readEditSources(projectRoot).find((entry) => entry?.id === sourceId || normalizeRelative(entry?.path) === projectRelative)
    : null;

  return {
    inputPath,
    projectRoot,
    projectRelative,
    sourceId: declaredSource?.id ?? sourceId,
    isProjectSource: !!declaredSource,
    displayPath: projectRelative ?? target,
  };
}

function normalizeRelative(value) {
  return typeof value === "string" ? toPosix(path.normalize(value)).replace(/^\.\//, "") : null;
}

export function parseTime(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const match = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(text);
  if (!match) throw new Error(`時刻が不正です: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function validateTime(time, duration, label = "時刻") {
  if (!Number.isFinite(time) || time < 0 || time > duration) {
    throw new Error(`${label} は 0〜${formatNumber(duration)} 秒で指定してください`);
  }
  return time;
}

export function formatNumber(value) {
  return Number(Number(value).toFixed(6));
}

export function formatTimecode(seconds) {
  let frames = Math.max(0, Math.round(Number(seconds) * 30));
  const minutes = Math.floor(frames / (30 * 60));
  frames -= minutes * 30 * 60;
  const wholeSeconds = Math.floor(frames / 30);
  const remainingFrames = frames % 30;
  const parts = [];
  if (minutes) parts.push(`${String(minutes).padStart(2, "0")}m`);
  if (wholeSeconds || minutes) parts.push(`${String(wholeSeconds).padStart(2, "0")}s`);
  if (remainingFrames || parts.length === 0) parts.push(`${parts.length ? String(remainingFrames).padStart(2, "0") : remainingFrames}f`);
  return parts.join("");
}

export function sheetTimecode(times) {
  return `${formatTimecode(times[0])}-${formatTimecode(times[times.length - 1])}`;
}

export function probeRaw(inputPath, ffprobeCommand, options = {}) {
  const result = runChecked(ffprobeCommand, [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", inputPath,
  ], options);
  const value = JSON.parse(result.stdout);
  const duration = Number(value.format?.duration ?? value.streams?.find((stream) => stream.duration)?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("素材の duration を確定できません");
  return { value, duration };
}

export function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export async function createOutputDirectory({ target, kind, out, now = new Date() }) {
  if (out) {
    const output = path.resolve(out);
    await mkdir(output, { recursive: true });
    return output;
  }
  const stem = path.basename(target.inputPath, path.extname(target.inputPath));
  if (target.projectRoot) {
    const stamp = now.toISOString().replace(/[-:.]/g, "");
    const parent = path.join(target.projectRoot, ".akari", "reports", "media", stem);
    await mkdir(parent, { recursive: true });
    let suffix = 1;
    while (true) {
      const output = path.join(parent, `${kind}-${stamp}${suffix === 1 ? "" : `-${suffix}`}`);
      try {
        await mkdir(output);
        return output;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        suffix += 1;
      }
    }
  }
  return mkdtemp(path.join(os.tmpdir(), `akari-${kind}-`));
}

export function outputPathForJson(absolutePath, target) {
  return target.projectRoot ? toPosix(path.relative(target.projectRoot, absolutePath)) : absolutePath;
}

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function relativeFrom(fromDirectory, absolutePath) {
  return toPosix(path.relative(fromDirectory, absolutePath));
}

export function generatedAt(options = {}) {
  return (options.now ?? new Date()).toISOString();
}
