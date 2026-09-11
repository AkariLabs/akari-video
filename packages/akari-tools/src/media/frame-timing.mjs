import { runChecked } from "./common.mjs";

export const FRAME_TIMING_HEAD_SECONDS = 60;
export const FRAME_TIMING_WINDOW_SECONDS = 10;
export const FRAME_TIMING_EXTRA_WINDOWS = 5;
export const FRAME_TIMING_IRREGULAR_TOLERANCE_RATIO = 0.04;
export const FRAME_TIMING_MIN_TOLERANCE_MS = 1;

export function resolveNominalFrameRate({ rFrameRate, avgFrameRate }) {
  return parseRate(rFrameRate) || parseRate(avgFrameRate) || 0;
}

export function frameTimingIntervals(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const intervals = [{ start: 0, duration: Math.min(FRAME_TIMING_HEAD_SECONDS, durationSeconds) }];
  const remaining = durationSeconds - FRAME_TIMING_HEAD_SECONDS;
  const count = Math.min(
    FRAME_TIMING_EXTRA_WINDOWS,
    Math.floor(remaining / FRAME_TIMING_WINDOW_SECONDS),
  );
  if (count <= 0) return intervals;
  const lastStart = durationSeconds - FRAME_TIMING_WINDOW_SECONDS;
  for (let index = 0; index < count; index += 1) {
    const start = count === 1
      ? lastStart
      : FRAME_TIMING_HEAD_SECONDS
        + ((lastStart - FRAME_TIMING_HEAD_SECONDS) * index) / (count - 1);
    intervals.push({ start, duration: FRAME_TIMING_WINDOW_SECONDS });
  }
  return intervals;
}

export function analyzeFrameTiming(packetWindows, fps) {
  if (!Number.isFinite(fps) || fps <= 0) return null;
  const nominalFrameMs = 1000 / fps;
  const toleranceMs = Math.max(
    nominalFrameMs * FRAME_TIMING_IRREGULAR_TOLERANCE_RATIO,
    FRAME_TIMING_MIN_TOLERANCE_MS,
  );
  let sampledFrames = 0;
  let irregularDeltas = 0;
  let maxDeviationMs = 0;
  let cumulativeDriftMs = 0;

  for (const packets of packetWindows) {
    const timestampsMs = packets
      .map((packet) => Number(packet?.pts_time) * 1000)
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    sampledFrames += timestampsMs.length;
    if (timestampsMs.length === 0) continue;
    const first = timestampsMs[0];
    for (let index = 0; index < timestampsMs.length; index += 1) {
      const deviation = timestampsMs[index] - (first + index * nominalFrameMs);
      maxDeviationMs = Math.max(maxDeviationMs, Math.abs(deviation));
      if (index > 0) {
        const delta = timestampsMs[index] - timestampsMs[index - 1];
        if (Math.abs(delta - nominalFrameMs) > toleranceMs) irregularDeltas += 1;
      }
    }
    const drift = timestampsMs.at(-1) - (first + (timestampsMs.length - 1) * nominalFrameMs);
    if (Math.abs(drift) > Math.abs(cumulativeDriftMs)) cumulativeDriftMs = drift;
  }

  return {
    sampled_frames: sampledFrames,
    mode: irregularDeltas > 0 ? "vfr" : "cfr",
    irregular_deltas: irregularDeltas,
    max_deviation_ms: roundMilliseconds(maxDeviationMs),
    cumulative_drift_ms: roundMilliseconds(cumulativeDriftMs),
    nominal_frame_ms: roundMilliseconds(nominalFrameMs),
  };
}

export function probeFrameTiming(inputPath, {
  ffprobe,
  durationSeconds,
  nominalFps,
  rFrameRate,
  avgFrameRate,
  ...options
}) {
  const intervals = frameTimingIntervals(durationSeconds);
  if (intervals.length === 0) return null;
  const readIntervals = intervals
    .map(({ start, duration }) => `${formatSeconds(start)}%+${formatSeconds(duration)}`)
    .join(",");
  const result = runChecked(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_packets",
    "-show_entries", "packet=pts_time,dts_time,duration_time",
    "-read_intervals", readIntervals,
    "-of", "json",
    inputPath,
  ], options);
  const value = JSON.parse(result.stdout);
  const packets = Array.isArray(value?.packets) ? value.packets : [];
  const packetWindows = intervals.map(({ start, duration }) => packets.filter((packet) => {
    const timestamp = Number(packet?.pts_time);
    return Number.isFinite(timestamp) && timestamp >= start && timestamp < start + duration;
  }));
  const fps = nominalFps ?? resolveNominalFrameRate({ rFrameRate, avgFrameRate });
  return analyzeFrameTiming(packetWindows, fps);
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value ?? "0").split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function formatSeconds(value) {
  return Number(value.toFixed(6)).toString();
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}
