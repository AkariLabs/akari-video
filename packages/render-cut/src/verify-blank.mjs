import { spawnSync } from "node:child_process";

export const BLANK_FRAME_MIN_DURATION_SECONDS = 0.3;
export const BLANK_FRAME_YMAX_TOLERANCE = 8;
export const BLANK_FRAME_BACKGROUND_FRACTION = 0.05;

const CAPTURE_LIMIT_BYTES = 64 * 1024 * 1024;

export function parseSignalstatsMetadata(output) {
  const samples = [];
  let pending = null;
  for (const line of textOf(output).split(/\r?\n/u)) {
    const frame = /frame:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\s*([^\s]+)/u.exec(line);
    if (frame) {
      pending = {
        frame: Number(frame[1]),
        pts: Number(frame[2]),
        pts_time: Number(frame[3]),
      };
      continue;
    }
    const ymax = /lavfi\.signalstats\.YMAX=([+-]?(?:\d+(?:\.\d*)?|\.\d+))/u.exec(line);
    if (!ymax || !pending) continue;
    const value = Number(ymax[1]);
    if (Number.isFinite(pending.pts_time) && Number.isFinite(value)) {
      samples.push({ ...pending, ymax: value });
    }
    pending = null;
  }
  return samples;
}

// The contract defines the background as the median of the lowest five percent of all YMAX
// observations. This remains relative to the artifact rather than assuming limited-range black.
export function estimateBackgroundYmax(samplesOrValues) {
  const values = (Array.isArray(samplesOrValues) ? samplesOrValues : [])
    .map((sample) => typeof sample === "number" ? sample : sample?.ymax)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;
  const lowestCount = Math.max(1, Math.ceil(values.length * BLANK_FRAME_BACKGROUND_FRACTION));
  const lowest = values.slice(0, lowestCount);
  const middle = Math.floor(lowest.length / 2);
  return lowest.length % 2 === 1
    ? lowest[middle]
    : (lowest[middle - 1] + lowest[middle]) / 2;
}

export function detectBlankIntervals(
  samples,
  {
    fps,
    backgroundYmax = estimateBackgroundYmax(samples),
    tolerance = BLANK_FRAME_YMAX_TOLERANCE,
    minimumDurationSeconds = BLANK_FRAME_MIN_DURATION_SECONDS,
  } = {},
) {
  if (!Array.isArray(samples) || samples.length === 0
    || !Number.isFinite(fps) || fps <= 0
    || !Number.isFinite(backgroundYmax)) return [];
  const frameDuration = 1 / fps;
  const threshold = backgroundYmax + tolerance;
  const intervals = [];
  let run = null;

  const finish = () => {
    if (!run) return;
    const duration = run.frames * frameDuration;
    if (duration + Number.EPSILON >= minimumDurationSeconds) {
      intervals.push({
        start: roundSeconds(run.start),
        duration: roundSeconds(duration),
        ymax_max: run.ymaxMax,
      });
    }
    run = null;
  };

  for (const sample of samples) {
    if (!Number.isFinite(sample?.pts_time) || !Number.isFinite(sample?.ymax)) {
      finish();
      continue;
    }
    if (sample.ymax <= threshold) {
      if (!run) run = { start: sample.pts_time, frames: 0, ymaxMax: sample.ymax };
      run.frames += 1;
      run.ymaxMax = Math.max(run.ymaxMax, sample.ymax);
    } else {
      finish();
    }
  }
  finish();
  return intervals;
}

export function activeIdsForInterval(edit, interval) {
  const intervalStart = Number(interval?.start);
  const intervalEnd = intervalStart + Number(interval?.duration);
  if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd) || intervalEnd <= intervalStart) {
    return { active_overlays: [], active_cuts: [] };
  }

  const activeOverlays = [];
  for (const overlay of edit?.overlays ?? []) {
    const start = Number(overlay?.start);
    const duration = Number(overlay?.duration);
    if (typeof overlay?.id === "string" && overlaps(start, duration, intervalStart, intervalEnd)) {
      activeOverlays.push(overlay.id);
    }
  }

  const activeCuts = [];
  const cursors = new Map();
  for (const cut of edit?.cuts ?? []) {
    const track = Number.isInteger(cut?.track) && cut.track >= 0 ? cut.track : 0;
    const cursor = cursors.get(track) ?? 0;
    const start = isNonNegativeFinite(cut?.at) ? cut.at : cursor;
    const duration = cutOutputDuration(cut);
    cursors.set(track, start + duration);
    if (typeof cut?.id === "string" && overlaps(start, duration, intervalStart, intervalEnd)) {
      activeCuts.push(cut.id);
    }
  }

  return {
    active_overlays: [...new Set(activeOverlays)],
    active_cuts: [...new Set(activeCuts)],
  };
}

export function blankIntervalSeverity(interval) {
  return (interval?.active_overlays?.length ?? 0) > 0 || (interval?.active_cuts?.length ?? 0) > 0
    ? "warning"
    : "info";
}

export function annotateBlankIntervals(intervals, edit) {
  return (Array.isArray(intervals) ? intervals : []).map((interval) => {
    const active = activeIdsForInterval(edit, interval);
    const record = { ...interval, ...active };
    return { ...record, severity: blankIntervalSeverity(record) };
  });
}

export function blankFrameFindings(intervals) {
  return (Array.isArray(intervals) ? intervals : []).map((interval) => {
    const active = [
      ...(interval.active_overlays ?? []).map((id) => `overlay:${id}`),
      ...(interval.active_cuts ?? []).map((id) => `cut:${id}`),
    ];
    return {
      severity: interval.severity,
      check: "verify.blank-frames",
      message: `空フレーム候補 ${formatSeconds(interval.start)}s–${formatSeconds(interval.start + interval.duration)}s（${formatSeconds(interval.duration)} 秒、YMAX 最大 ${formatSeconds(interval.ymax_max)}）${active.length > 0 ? `; 活性 ${active.join(", ")}` : "; 活性 overlay/cut なし"}`,
    };
  });
}

export function scanBlankFrames({
  outputPath,
  fps,
  edit = null,
  ffmpegCommand = "ffmpeg",
  spawnSyncImpl = spawnSync,
}) {
  // No -skip_frame or scale is used: signalstats sees every decoded frame, so the minimum
  // detectable/reported run remains exactly BLANK_FRAME_MIN_DURATION_SECONDS (subject to fps).
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner",
      "-nostats",
      "-nostdin",
      "-i",
      outputPath,
      "-map",
      "0:v:0",
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YMAX",
      "-an",
      "-sn",
      "-dn",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: CAPTURE_LIMIT_BYTES },
  );
  const metadata = `${textOf(result?.stdout)}\n${textOf(result?.stderr)}`;
  const samples = parseSignalstatsMetadata(metadata);
  if (result?.error || result?.status !== 0 || samples.length === 0) {
    return {
      ok: false,
      background_ymax: estimateBackgroundYmax(samples),
      intervals: [],
      findings: [],
      error: lastMeaningfulLine(result?.stderr) || messageOf(result?.error) || "signalstats did not report YMAX",
    };
  }
  const backgroundYmax = estimateBackgroundYmax(samples);
  const intervals = annotateBlankIntervals(
    detectBlankIntervals(samples, { fps, backgroundYmax }),
    edit,
  );
  return {
    ok: true,
    background_ymax: backgroundYmax,
    intervals,
    findings: blankFrameFindings(intervals),
    error: null,
  };
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

function overlaps(start, duration, intervalStart, intervalEnd) {
  return Number.isFinite(start) && Number.isFinite(duration) && duration > 0
    && start < intervalEnd && start + duration > intervalStart;
}

function isNonNegativeFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundSeconds(value) {
  return Number(value.toFixed(6));
}

function formatSeconds(value) {
  return Number(value.toFixed(3)).toString();
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return Buffer.from(value).toString("utf8");
}

function lastMeaningfulLine(value) {
  return textOf(value).trim().split(/\r?\n/u).filter(Boolean).at(-1) ?? "";
}

function messageOf(error) {
  return error instanceof Error ? error.message : error ? String(error) : "";
}
