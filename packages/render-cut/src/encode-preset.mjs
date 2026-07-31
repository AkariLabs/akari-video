import { spawnSync } from "node:child_process";

import { resolveFfmpeg } from "../../media-bin/src/index.mjs";

// Ported from akari-video-tauri/src-tauri/src/export/ffmpeg.rs (videotoolbox_available /
// append_encode_args) — read-only reference, task 2026-07-25-export-options. This render-cut
// (Node) pipeline does not split intermediate/final into two differently-tuned stages the way the
// legacy Rust one did; instead the same resolved preset is applied to every video-encoding ffmpeg
// call a given render performs, so an overlay-composited intermediate is never coarser than the
// final output ("中間生成物は最終より劣化させない").
export const QUALITY_LEVELS = ["high", "standard", "light"];
export const ENCODER_CHOICES = ["auto", "videotoolbox", "x264"];

export const QUALITY_PRESETS = {
  high: { crf: 18, preset: "slow", videotoolboxBitrate: "12M" },
  standard: { crf: 23, preset: "medium", videotoolboxBitrate: "8M" },
  light: { crf: 26, preset: "fast", videotoolboxBitrate: "5M" },
};

// Process-wide cache keyed by the ffmpeg binary path (mirrors the legacy OnceLock: detection runs
// at most once per ffmpeg binary for the lifetime of the process).
const videotoolboxCache = new Map();

export function resetVideotoolboxCacheForTests() {
  videotoolboxCache.clear();
}

/**
 * `h264_videotoolbox` の可否判定。`AKARI_EXPORT_FORCE_X264=1` は無条件で false。
 * それ以外は `-encoders` 一覧に存在するか確認したうえで、実際に 1 フレームだけ
 * エンコードしてみるスモークテストが通るかまで確かめる（一覧にあっても実行時に
 * 失敗する環境があり得るため — legacy videotoolbox_available の移植）。
 */
export function isVideotoolboxAvailable({
  ffmpegCommand,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (env.AKARI_EXPORT_FORCE_X264 === "1") return false;
  // Resolved lazily (only once the FORCE_X264 short-circuit above is ruled out) so a forced x264
  // choice never touches media-bin's resolveFfmpeg(), matching the pre-existing
  // "must not probe" contract this function has always had.
  const resolvedFfmpegCommand = ffmpegCommand ?? resolveFfmpeg();
  if (videotoolboxCache.has(resolvedFfmpegCommand)) return videotoolboxCache.get(resolvedFfmpegCommand);
  const available = hasVideotoolboxEncoder(resolvedFfmpegCommand, spawnSyncImpl) && videotoolboxSmokeTest(resolvedFfmpegCommand, spawnSyncImpl);
  videotoolboxCache.set(resolvedFfmpegCommand, available);
  return available;
}

function hasVideotoolboxEncoder(ffmpegCommand, spawnSyncImpl) {
  const result = spawnSyncImpl(ffmpegCommand, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return false;
  return result.stdout
    .split(/\r?\n/u)
    .some((line) => line.trim().split(/\s+/u)[1] === "h264_videotoolbox");
}

// Encodes a single lavfi-generated 64x64 frame straight to /dev/null: no intermediate file, done
// in tens of milliseconds (legacy videotoolbox_smoke_test).
function videotoolboxSmokeTest(ffmpegCommand, spawnSyncImpl) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:r=24",
      "-frames:v",
      "1",
      "-c:v",
      "h264_videotoolbox",
      "-allow_sw",
      "1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  return !result.error && result.status === 0;
}

/**
 * `requested` が未指定（undefined/null）なら null を返す — 呼び出し側はこれを
 * 「エンコーダ引数に一切触れない（既存の libx264 決め打ち引数列を保つ）」の合図として扱う。
 * これにより --encoder を渡さない既存呼び出しは videotoolbox 判定すら一切実行しない
 * （後方互換の絶対条件: 無引数のとき ffmpeg コマンド列は変更前と deepEqual）。
 */
export function resolveEncoderChoice({
  requested,
  ffmpegCommand,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (requested === undefined || requested === null) return null;
  if (requested === "x264") return { engine: "x264" };
  if (requested === "videotoolbox") return { engine: "videotoolbox" };
  if (requested === "auto") {
    // Resolved lazily (only for "auto") so an explicit x264/videotoolbox choice never touches
    // media-bin's resolveFfmpeg(), matching the docstring's "無引数のとき... 一切実行しない".
    const resolvedFfmpegCommand = ffmpegCommand ?? resolveFfmpeg();
    const useVideotoolbox = isVideotoolboxAvailable({ ffmpegCommand: resolvedFfmpegCommand, env, spawnSyncImpl });
    return { engine: useVideotoolbox ? "videotoolbox" : "x264" };
  }
  throw new RangeError(`Unknown --encoder value: ${requested}`);
}

/**
 * `-c:v ...` 系の引数列を組み立てる。`quality`/`encoderChoice` が両方未指定なら null を返す
 * — 呼び出し側はこれを「既存の `-c:v libx264 -profile:v <profile>` 決め打ち引数を保つ」の
 * 合図として扱う（無引数時の後方互換）。どちらか一方でも明示指定されたら、既定 quality は
 * standard（crf 23 / preset medium。これは libx264 自体の既定と同値）、既定 encoder は x264
 * として解決する。
 */
export function buildVideoEncodeArgs({ quality, encoderChoice, profile = "high" } = {}) {
  if (!quality && !encoderChoice) return null;
  const resolvedPreset = QUALITY_PRESETS[quality ?? "standard"];
  if (!resolvedPreset) throw new RangeError(`Unknown --quality value: ${quality}`);
  const engine = encoderChoice?.engine ?? "x264";
  if (engine === "videotoolbox") {
    return [
      "-c:v",
      "h264_videotoolbox",
      "-allow_sw",
      "1",
      "-b:v",
      resolvedPreset.videotoolboxBitrate,
      ...(profile ? ["-profile:v", profile] : []),
    ];
  }
  return [
    "-c:v",
    "libx264",
    ...(profile ? ["-profile:v", profile] : []),
    "-preset",
    resolvedPreset.preset,
    "-crf",
    String(resolvedPreset.crf),
  ];
}
