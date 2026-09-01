import { spawnSync } from "node:child_process";

export const AUDIO_LEVEL_THRESHOLD_DB = -80;
export const MOTION_STATIC_NCC = 0.98;
export const MOTION_UNIFORM_STDDEV = 2;

const GRAY_FRAME_WIDTH = 160;
const GRAY_FRAME_HEIGHT = 90;
const GRAY_FRAME_BYTES = GRAY_FRAME_WIDTH * GRAY_FRAME_HEIGHT;
const CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024;

export function planVolumeIntervals(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.min(6, Math.max(1, Math.ceil(duration / 300)));
  const intervalDuration = Math.min(30, duration);
  const latestStart = Math.max(0, duration - intervalDuration);
  return Array.from({ length: count }, (_, index) => {
    const centeredStart = ((index + 0.5) * duration) / count - intervalDuration / 2;
    const start = roundToMilliseconds(clamp(centeredStart, 0, latestStart));
    return { start: clamp(start, 0, latestStart), duration: intervalDuration };
  });
}

export function parseVolumeLevels(stderr) {
  const text = textOf(stderr);
  const mean = text.match(/mean_volume:\s*(-inf|[+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*dB/iu);
  const max = text.match(/max_volume:\s*(-inf|[+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*dB/iu);
  if (!mean || !max) return null;
  return { mean_db: parseDb(mean[1]), max_db: parseDb(max[1]) };
}

export function measureAudioLevel({
  outputPath,
  durationSeconds,
  ffmpegCommand = "ffmpeg",
  spawnSyncImpl = spawnSync,
}) {
  const planned = planVolumeIntervals(durationSeconds);
  if (planned.length === 0) {
    return { ok: false, intervals: [], max_db: null, error: "出力尺が正の有限値ではありません" };
  }

  const intervals = [];
  for (const interval of planned) {
    const result = spawnSyncImpl(
      ffmpegCommand,
      [
        "-hide_banner",
        "-nostats",
        "-ss",
        formatNumber(interval.start),
        "-i",
        outputPath,
        "-t",
        formatNumber(interval.duration),
        "-vn",
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8", maxBuffer: CAPTURE_LIMIT_BYTES },
    );
    const stderr = textOf(result?.stderr);
    if (result?.error || result?.status !== 0) {
      return {
        ok: false,
        intervals,
        max_db: null,
        error: lastMeaningfulLine(stderr) || messageOf(result?.error) || `ffmpeg exited ${result?.status ?? "unknown"}`,
      };
    }
    const levels = parseVolumeLevels(stderr);
    if (!levels) {
      return {
        ok: false,
        intervals,
        max_db: null,
        error: lastMeaningfulLine(stderr) || "volumedetect did not report mean_volume / max_volume",
      };
    }
    intervals.push({ ...interval, ...levels });
  }

  return {
    ok: true,
    intervals,
    max_db: Math.max(...intervals.map((interval) => interval.max_db)),
    error: null,
  };
}

export function judgeAudioLevel({ declared, reasons = [], hasAudioStream, measurement }) {
  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : []).map(String))];
  const base = {
    declared: declared === true,
    reasons: normalizedReasons,
    threshold_db: AUDIO_LEVEL_THRESHOLD_DB,
  };

  if (!hasAudioStream) {
    return {
      finding: null,
      record: { ...base, intervals: [], max_db: null, verdict: "skipped" },
    };
  }

  if (!measurement || measurement.ok === false || !isDb(measurement.max_db)) {
    const error = measurement?.error || "volumedetect の結果を解釈できません";
    const intervalCount = measurement?.intervals?.length ?? 0;
    return {
      finding: {
        severity: "error",
        check: "verify.audio-level",
        message: `音量を測定できません（閾値 ${AUDIO_LEVEL_THRESHOLD_DB} dB・${intervalCount} 区間）: ${error}`,
      },
      record: {
        ...base,
        intervals: measurement?.intervals ?? [],
        max_db: null,
        verdict: "fail",
      },
    };
  }

  const intervals = measurement.intervals ?? [];
  const maxDb = measurement.max_db;
  const maxText = formatDb(maxDb);
  const countText = `${intervals.length} 区間`;
  if (declared === true && maxDb < AUDIO_LEVEL_THRESHOLD_DB) {
    const reasonText = normalizedReasons.length > 0 ? normalizedReasons.join("/") : "音声";
    return {
      finding: {
        severity: "error",
        check: "verify.audio-level",
        message: `宣言された音声（${reasonText}）に対し、出力の最大音量が ${maxText} dB（閾値 ${AUDIO_LEVEL_THRESHOLD_DB} dB・${countText}）— デジタル無音`,
      },
      record: { ...base, intervals, max_db: maxDb, verdict: "fail" },
    };
  }
  if (declared === true) {
    return {
      finding: {
        severity: "info",
        check: "verify.audio-level",
        message: `最大音量 ${maxText} dB（${countText}）`,
      },
      record: { ...base, intervals, max_db: maxDb, verdict: "pass" },
    };
  }

  const silent = maxDb < AUDIO_LEVEL_THRESHOLD_DB;
  return {
    finding: {
      severity: "warning",
      check: "verify.audio-level",
      message: silent
        ? `音声の宣言が無い無音トラック（${maxText} dB）`
        : `音声の宣言が無いのに可聴音声（${maxText} dB）`,
    },
    record: { ...base, intervals, max_db: maxDb, verdict: "warning" },
  };
}

export function selectMotionProbes(cuts, { fps, durationSeconds }) {
  if (!Array.isArray(cuts) || !Number.isFinite(fps) || fps <= 0) return [];
  const outputDuration = Number(durationSeconds);
  if (!Number.isFinite(outputDuration) || outputDuration <= 0) return [];
  const latestOutputTime = Math.max(0, outputDuration - 1 / fps);
  const cursors = new Map();
  const probes = [];

  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index] ?? {};
    const track = Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
    const cursor = cursors.get(track) ?? 0;
    const outputStart = isNonNegativeFinite(cut.at) ? cut.at : cursor;
    const outputDurationSeconds = cutOutputDuration(cut);
    cursors.set(track, outputStart + outputDurationSeconds);

    if (probes.length >= 8 || !Array.isArray(cut.keyframes) || cut.keyframes.length < 2) continue;
    const points = cut.keyframes.filter((point) => point && isNonNegativeFinite(point.t));
    if (points.length < 2) continue;
    const pair = maximumChangedPair(points, "crop", ["x", "y", "w", "h"])
      ?? maximumChangedPair(points, "transform", ["x", "y", "scale", "rotate"]);
    if (!pair) continue;

    const framesUnit = shouldConvertFrames(points, outputDurationSeconds, fps);
    const localTime = (point) => framesUnit ? point.t / fps : point.t;
    const t1 = clamp(outputStart + localTime(pair[0]), 0, latestOutputTime);
    const t2 = clamp(outputStart + localTime(pair[1]), 0, latestOutputTime);
    if (Math.abs(t1 - t2) <= Number.EPSILON) continue;
    probes.push({ cut: String(cut.id ?? `cut-${index}`), t1, t2 });
  }
  return probes;
}

export function extractGrayFrame({
  outputPath,
  seconds,
  ffmpegCommand = "ffmpeg",
  spawnSyncImpl = spawnSync,
}) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner",
      "-nostats",
      "-ss",
      formatNumber(Math.max(0, seconds)),
      "-i",
      outputPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${GRAY_FRAME_WIDTH}:${GRAY_FRAME_HEIGHT},format=gray`,
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { maxBuffer: CAPTURE_LIMIT_BYTES },
  );
  const stderr = textOf(result?.stderr);
  if (result?.error || result?.status !== 0) {
    return {
      ok: false,
      pixels: null,
      error: lastMeaningfulLine(stderr) || messageOf(result?.error) || `ffmpeg exited ${result?.status ?? "unknown"}`,
    };
  }
  const pixels = bytesOf(result?.stdout);
  if (pixels.length !== GRAY_FRAME_BYTES) {
    return { ok: false, pixels: null, error: `gray frame was ${pixels.length} bytes; expected ${GRAY_FRAME_BYTES}` };
  }
  return { ok: true, pixels, error: null };
}

export function normalizedCrossCorrelation(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return Number.NaN;
  let sumA = 0;
  let sumB = 0;
  for (let index = 0; index < a.length; index += 1) {
    sumA += a[index];
    sumB += b[index];
  }
  const meanA = sumA / a.length;
  const meanB = sumB / b.length;
  let numerator = 0;
  let squareA = 0;
  let squareB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const deltaA = a[index] - meanA;
    const deltaB = b[index] - meanB;
    numerator += deltaA * deltaB;
    squareA += deltaA * deltaA;
    squareB += deltaB * deltaB;
  }
  const denominator = Math.sqrt(squareA * squareB);
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

export function judgeMotion({
  outputPath,
  cuts,
  fps,
  durationSeconds,
  ffmpegCommand = "ffmpeg",
  spawnSyncImpl = spawnSync,
}) {
  const findings = [];
  const records = [];
  const probes = selectMotionProbes(cuts, { fps, durationSeconds });
  for (const probe of probes) {
    const first = extractGrayFrame({ outputPath, seconds: probe.t1, ffmpegCommand, spawnSyncImpl });
    const second = extractGrayFrame({ outputPath, seconds: probe.t2, ffmpegCommand, spawnSyncImpl });
    if (!first.ok || !second.ok) {
      records.push({ ...probe, ncc: null, verdict: "skipped", skipped: "measurement" });
      continue;
    }
    if (standardDeviation(first.pixels) < MOTION_UNIFORM_STDDEV
      || standardDeviation(second.pixels) < MOTION_UNIFORM_STDDEV) {
      records.push({ ...probe, ncc: null, verdict: "skipped", skipped: "uniform" });
      continue;
    }

    const ncc = normalizedCrossCorrelation(first.pixels, second.pixels);
    if (!Number.isFinite(ncc)) {
      records.push({ ...probe, ncc: null, verdict: "skipped", skipped: "uniform" });
      continue;
    }
    const warning = ncc >= MOTION_STATIC_NCC;
    records.push({ ...probe, ncc, verdict: warning ? "warning" : "pass" });
    findings.push({
      severity: warning ? "warning" : "info",
      check: "verify.motion-static",
      message: warning
        ? `cut ${probe.cut}: keyframes が異なる画角を宣言する t=${formatSeconds(probe.t1)}s / t=${formatSeconds(probe.t2)}s の出力フレームが酷似（NCC ${formatNcc(ncc)}）— カメラワーク未反映の可能性`
        : `cut ${probe.cut}: NCC ${formatNcc(ncc)}`,
    });
  }
  return { findings, records };
}

function maximumChangedPair(points, property, leaves) {
  let best = null;
  let bestDistance = 0;
  for (let left = 0; left < points.length - 1; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const a = points[left]?.[property];
      const b = points[right]?.[property];
      if (!a || typeof a !== "object" || !b || typeof b !== "object") continue;
      let distance = 0;
      let compared = false;
      for (const leaf of leaves) {
        const av = a[leaf];
        const bv = b[leaf];
        if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
        distance += Math.abs(av - bv);
        compared = true;
      }
      if (compared && distance > bestDistance) {
        best = [points[left], points[right]];
        bestDistance = distance;
      }
    }
  }
  return best;
}

function shouldConvertFrames(points, durationSeconds, fps) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  const latest = Math.max(...points.map((point) => point.t));
  return latest > durationSeconds + 1 / fps && latest / fps <= durationSeconds + 1 / fps;
}

function cutOutputDuration(cut) {
  if (Number.isFinite(cut?.duration) && cut.duration >= 0) return cut.duration;
  if (!Number.isFinite(cut?.in) || !Number.isFinite(cut?.out) || cut.out < cut.in) return 0;
  const speed = Number.isFinite(cut.speed) && cut.speed > 0 ? cut.speed : 1;
  const freeze = Number.isFinite(cut?.freeze?.duration_sec) && cut.freeze.duration_sec > 0
    ? cut.freeze.duration_sec
    : 0;
  return (cut.out - cut.in) / speed + freeze;
}

function standardDeviation(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let square = 0;
  for (const value of values) square += (value - mean) ** 2;
  return Math.sqrt(square / values.length);
}

function parseDb(value) {
  return value.toLowerCase() === "-inf" ? Number.NEGATIVE_INFINITY : Number(value);
}

function isDb(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function isNonNegativeFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundToMilliseconds(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatNumber(value) {
  return Number(value.toFixed(6)).toString();
}

function formatDb(value) {
  return value === Number.NEGATIVE_INFINITY ? "-inf" : formatNumber(value);
}

function formatSeconds(value) {
  return Number(value.toFixed(3)).toString();
}

function formatNcc(value) {
  return value.toFixed(4);
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return Buffer.from(value).toString("utf8");
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Buffer.from(value, "binary");
  return Buffer.alloc(0);
}

function lastMeaningfulLine(value) {
  return textOf(value).trim().split(/\r?\n/u).filter(Boolean).at(-1) ?? "";
}

function messageOf(error) {
  return error instanceof Error ? error.message : error ? String(error) : "";
}
