import { QUALITY_LEVELS, QUALITY_PRESETS } from "../../render-cut/src/encode-preset.mjs";

// quality プリセットのビットレートは 1080p（1920×1080 = 2,073,600 px）を基準に決めた値。
// 出力ピクセル数が基準を超えるぶんだけ比例で増やす（4K = 4 倍: high 12 → 48 Mbps、1440p ≈ 1.78 倍）。
// 基準未満は 1 倍に留めて既存出力（720p / 縦型 1080p 等）を変えない。--bitrate 明示は無変換。
export const GPU_BITRATE_REFERENCE_PIXELS = 1920 * 1080;
export const GPU_BITRATE_ROUNDING_BPS = 100_000;
export const CODEC_FACTORS = Object.freeze({ h264: 1, hevc: 0.6 });

export function gpuBitrateScale({ width = undefined, height = undefined } = {}) {
  if (!(Number(width) > 0) || !(Number(height) > 0)) return 1;
  return Math.max(1, (Number(width) * Number(height)) / GPU_BITRATE_REFERENCE_PIXELS);
}

export function resolveGpuEncoding({ quality = "high", bitrate = undefined, width = undefined, height = undefined, codec = "h264" } = {}) {
  if (!QUALITY_LEVELS.includes(quality)) {
    throw new Error(`GPU quality must be one of ${QUALITY_LEVELS.join("|")}, got: ${quality}`);
  }
  if (bitrate !== undefined && bitrate !== null) {
    return { quality, bitrate: positiveBitrate(bitrate, "--bitrate"), bitrateSource: "explicit" };
  }
  const codecFactor = CODEC_FACTORS[codec];
  if (codecFactor === undefined) throw new Error(`GPU codec must be h264|hevc, got: ${codec}`);
  const preset = QUALITY_PRESETS[quality]?.videotoolboxBitrate ?? null;
  if (preset === null) {
    throw new Error("master は GPU 出口では --bitrate の明示が必要です");
  }
  const baseBitrate = parsePresetBitrate(preset);
  const scale = gpuBitrateScale({ width, height });
  if (scale === 1 && codecFactor === 1) return { quality, bitrate: baseBitrate, bitrateSource: "quality-preset" };
  const scaled = Math.round((baseBitrate * scale * codecFactor) / GPU_BITRATE_ROUNDING_BPS) * GPU_BITRATE_ROUNDING_BPS;
  if (scale === 1) {
    return {
      quality,
      bitrate: positiveBitrate(scaled, "GPU codec-scaled bitrate"),
      bitrateSource: "quality-preset-codec-scaled",
      baseBitrate,
      codecFactor,
    };
  }
  return {
    quality,
    bitrate: positiveBitrate(scaled, "GPU scaled bitrate"),
    bitrateSource: "quality-preset-scaled",
    baseBitrate,
    bitrateScale: Number(scale.toFixed(4)),
    ...(codecFactor === 1 ? {} : { codecFactor }),
  };
}

export function parsePresetBitrate(value) {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/u.exec(String(value).trim());
  if (!match) throw new Error(`invalid GPU bitrate preset: ${value}`);
  const unit = match[2].toUpperCase();
  const multiplier = unit === "M" ? 1_000_000 : unit === "K" ? 1_000 : 1;
  return positiveBitrate(Number(match[1]) * multiplier, "GPU bitrate preset");
}

function positiveBitrate(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}
