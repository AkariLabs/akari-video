/**
 * 素材の画素数プローブ — ffprobe の `-show_streams` から映像ストリームの寸法と表示回転を読む。
 *
 * 幾何の統一（`output.geometry`）の移行は `fit = min(outputW / srcW, outputH / srcH)` を掛けるが、
 * srcW / srcH は**表示回転を適用した後**の画素数でなければならない（回転メタデータ付きの縦撮り
 * 素材は width/height が横のまま格納されている）。そのため生の width/height と、表示回転を
 * 適用した displayWidth / displayHeight の両方を返す。静止画も同じ経路で読む。
 *
 * 同一パスへの同時要求は 1 回のプローブへ合流する（alpha-intake.mjs と同じ流儀）。
 */

import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfprobe } from "./index.mjs";

const inFlight = new Map();

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 1000) : fallback;
}

/** 表示回転を 0 / 90 / 180 / 270 へ正規化する（ffprobe の Display Matrix は時計回りを負で報告する）。 */
function normalizeRotation(value) {
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) return null;
  const rounded = Math.round(degrees / 90) * 90;
  return ((rounded % 360) + 360) % 360;
}

function readRotation(stream) {
  for (const sideData of Array.isArray(stream?.side_data_list) ? stream.side_data_list : []) {
    const rotation = normalizeRotation(sideData?.rotation);
    if (rotation !== null) return rotation;
  }
  // 旧コンテナは container tag（`rotate`）でしか回転を持たない。tag は時計回りの正値。
  const tagged = normalizeRotation(stream?.tags?.rotate);
  return tagged === null ? 0 : tagged;
}

/**
 * 同期版。
 * @param {string} filePath
 * @param {{ env?: NodeJS.ProcessEnv, ffprobe?: string }} [options]
 * @returns {{ width: number, height: number, rotation: number, displayWidth: number, displayHeight: number }}
 */
export function probeMediaDimensionsSync(filePath, { env = process.env, ffprobe } = {}) {
  const resolved = path.resolve(filePath);
  const binary = ffprobe ?? resolveFfprobe({ env });
  const result = spawnSync(binary, [
    "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", resolved,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(summarize(
      result.stderr || result.error?.message,
      `ffprobe に失敗しました: ${resolved}`,
    ));
  }
  let stream;
  try {
    stream = JSON.parse(result.stdout)?.streams?.[0];
  } catch (error) {
    throw new Error(`ffprobe の出力を読めません: ${resolved} (${summarize(error?.message, "JSON parse error")})`);
  }
  if (!stream) throw new Error(`映像ストリームが見つかりません: ${resolved}`);
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`映像ストリームの寸法を読めません: ${resolved}`);
  }
  const rotation = readRotation(stream);
  const swapped = rotation % 180 === 90;
  return {
    width,
    height,
    rotation,
    displayWidth: swapped ? height : width,
    displayHeight: swapped ? width : height,
  };
}

/**
 * 非同期版。同一パスへの同時呼び出しは 1 回のプローブへ合流する。
 * @param {string} filePath
 * @param {{ env?: NodeJS.ProcessEnv, ffprobe?: string }} [options]
 * @returns {Promise<{ width: number, height: number, rotation: number, displayWidth: number, displayHeight: number }>}
 */
export function probeMediaDimensions(filePath, options = {}) {
  const key = path.resolve(filePath);
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = Promise.resolve().then(() => probeMediaDimensionsSync(filePath, options));
  inFlight.set(key, pending);
  pending.finally(() => inFlight.delete(key)).catch(() => undefined);
  return pending;
}
