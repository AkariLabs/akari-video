import { QUALITY_LEVELS, QUALITY_PRESETS } from "../../render-cut/src/encode-preset.mjs";

export function resolveGpuEncoding({ quality = "high", bitrate = undefined } = {}) {
  if (!QUALITY_LEVELS.includes(quality)) {
    throw new Error(`GPU quality must be one of ${QUALITY_LEVELS.join("|")}, got: ${quality}`);
  }
  if (bitrate !== undefined && bitrate !== null) {
    return { quality, bitrate: positiveBitrate(bitrate, "--bitrate"), bitrateSource: "explicit" };
  }
  const preset = QUALITY_PRESETS[quality]?.videotoolboxBitrate ?? null;
  if (preset === null) {
    throw new Error("master は GPU 出口では --bitrate の明示が必要です");
  }
  return { quality, bitrate: parsePresetBitrate(preset), bitrateSource: "quality-preset" };
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
